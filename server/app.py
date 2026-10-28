"""学习资料生成服务的 HTTP 入口。

    python -m server.app

接口：
    GET  /healthz          健康检查（不返回密钥）
    POST /api/study-pack   multipart/form-data，字段名为 files，可多文件

设计要点：
- 密钥只在环境变量里，响应与日志都不包含密钥。
- 文件只在内存中解析，不落盘、不进公开存储。
- 同时校验扩展名、文件头、数量和大小。
"""
import json
import os
import sys
import threading
import time
from collections import defaultdict, deque
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .ai import AIError, generate_pack
from .config import Config, ConfigError
from .extract import ExtractionError, build_document, extract_document

BODY_SLACK = 2 * 1024 * 1024
MIN_DOCUMENT_CHARS = 200

HINTS = {
    "ORIGIN_NOT_ALLOWED": "后端的 ALLOWED_ORIGINS 需要包含本站地址。",
    "NO_FILES": "请选择至少一个文件。",
    "TOO_MANY_FILES": "减少一次上传的文件数量。",
    "EMPTY_FILE": "去掉空文件后重试。",
    "FILE_TOO_LARGE": "压缩或拆分文件，或调大服务端 MAX_FILE_MB。",
    "TOTAL_TOO_LARGE": "减少文件数量或调大 MAX_TOTAL_MB。",
    "UNSUPPORTED_TYPE": "只支持 PDF、PPTX、DOCX、TXT、MD。",
    "EXTRACTION_FAILED": "确认文件没有损坏或被密码保护。",
    "PDF_TEXT_UNAVAILABLE": "扫描版 PDF 需要先做 OCR。",
    "CONTENT_TOO_SHORT": "换一份内容更完整的材料。",
    "RATE_LIMITED": "稍后再试。",
    "BUSY": "当前并发生成任务已满，稍后重试。",
    "AI_NOT_CONFIGURED": "在服务端设置 AI_API_KEY 后重启。",
    "AI_TIMEOUT": "稍后重试，或减少一次上传的材料量。",
    "AI_UPSTREAM": "这是 AI 服务端的问题，稍后重试。",
    "AI_BAD_RESPONSE": "重试一次通常可以恢复。",
    "BAD_REQUEST": "检查请求格式。",
}


class RequestError(Exception):
    def __init__(self, status, code, message, hint="", details=None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.hint = hint or HINTS.get(code, "")
        self.details = details or []


class RateLimiter:
    def __init__(self, limit, window_seconds=3600):
        self.limit = limit
        self.window = window_seconds
        self._hits = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key):
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and now - hits[0] > self.window:
                hits.popleft()
            if len(hits) >= self.limit:
                return False
            hits.append(now)
            if len(self._hits) > 5000:
                self._hits.clear()
            return True


def _parse_multipart(body, content_type):
    if "boundary=" not in content_type:
        raise RequestError(400, "BAD_REQUEST", "缺少 multipart boundary。")
    header = f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("utf-8")
    message = BytesParser(policy=default).parsebytes(header + body)
    if not message.is_multipart():
        raise RequestError(400, "BAD_REQUEST", "请求不是 multipart/form-data。")

    files = []
    for part in message.iter_parts():
        disposition = part.get("Content-Disposition", "")
        if "form-data" not in disposition:
            continue
        field = part.get_param("name", header="content-disposition")
        filename = part.get_filename()
        if field != "files" or not filename:
            continue
        safe_name = os.path.basename(filename.replace("\\", "/")) or "upload"
        payload = part.get_payload(decode=True) or b""
        files.append((safe_name, payload))
    return files


class Handler(BaseHTTPRequestHandler):
    server_version = "StudyPack/1.0"
    protocol_version = "HTTP/1.1"

    config = None
    rate_limiter = None
    job_slots = None

    # —— 基础响应 ——
    def log_message(self, fmt, *args):
        sys.stderr.write("[study] %s - %s\n" % (self.address_string(), fmt % args))

    def _apply_cors(self):
        if self._origin and self._origin_allowed:
            self.send_header("Access-Control-Allow-Origin", self._origin)
            self.send_header("Vary", "Origin")

    def _send(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self._apply_cors()
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _send_error(self, status, code, message, hint="", details=None):
        self._send(status, {
            "ok": False,
            "error": {
                "code": code,
                "message": message,
                "hint": hint or HINTS.get(code, ""),
                "details": details or [],
            },
        })

    def _init_cors(self):
        self._origin = (self.headers.get("Origin") or "").strip().rstrip("/")
        self._origin_allowed = (not self._origin) or self._origin in self.config.allowed_origins

    def _client_key(self):
        forwarded = self.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return self.client_address[0]

    def _guard_origin(self):
        if not self._origin_allowed:
            raise RequestError(403, "ORIGIN_NOT_ALLOWED", "这个来源不允许调用本服务。")

    # —— 路由 ——
    def do_OPTIONS(self):
        self._init_cors()
        try:
            if self.path.split("?")[0] != "/api/study-pack":
                raise RequestError(404, "BAD_REQUEST", "没有这个接口。")
            self._guard_origin()
        except RequestError as error:
            self._send_error(error.status, error.code, error.message, error.hint)
            return
        self.send_response(204)
        self._apply_cors()
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        self._init_cors()
        path = self.path.split("?")[0]
        if path == "/healthz":
            summary = self.config.public_summary()
            self._send(200, {
                "ok": True,
                "service": "study-pack",
                "configured": summary["configured"],
                "mock": summary["mock"],
                "model": summary["model"],
                "limits": {
                    "maxFiles": self.config.max_files,
                    "maxFileMb": self.config.max_file_mb,
                    "maxTotalMb": self.config.max_total_mb,
                },
            })
            return
        self._send_error(404, "BAD_REQUEST", "没有这个接口。")

    def do_POST(self):
        self._init_cors()
        if self.path.split("?")[0] != "/api/study-pack":
            self._send_error(404, "BAD_REQUEST", "没有这个接口。")
            return
        try:
            self._handle_study_pack()
        except RequestError as error:
            self._send_error(error.status, error.code, error.message, error.hint, error.details)
        except AIError as error:
            status = {"AI_TIMEOUT": 504, "AI_NOT_CONFIGURED": 503}.get(error.code, 502)
            self._send_error(status, error.code, error.message, error.hint)
        except Exception as error:  # noqa: BLE001 - 兜底，不回显内部细节
            sys.stderr.write(f"[study] unhandled {type(error).__name__}\n")
            self._send_error(500, "INTERNAL_ERROR", "服务内部错误。")

    # —— 主流程 ——
    def _handle_study_pack(self):
        self._guard_origin()

        if not self.rate_limiter.allow(self._client_key()):
            raise RequestError(429, "RATE_LIMITED", "请求过于频繁。")

        content_type = self.headers.get("Content-Type", "")
        if not content_type.lower().startswith("multipart/form-data"):
            raise RequestError(400, "BAD_REQUEST", "请使用 multipart/form-data 上传。")

        raw_length = self.headers.get("Content-Length")
        if not raw_length:
            self.close_connection = True
            raise RequestError(411, "BAD_REQUEST", "缺少 Content-Length。")
        try:
            length = int(raw_length)
        except ValueError:
            raise RequestError(400, "BAD_REQUEST", "Content-Length 不合法。") from None
        if length <= 0:
            raise RequestError(400, "BAD_REQUEST", "请求体为空。")

        limit = self.config.max_total_bytes + BODY_SLACK
        if length > limit:
            self.close_connection = True
            raise RequestError(
                413, "TOTAL_TOO_LARGE",
                f"上传合计超过 {self.config.max_total_mb} MB。",
            )

        body = self.rfile.read(length)
        files = _parse_multipart(body, content_type)

        if not files:
            raise RequestError(400, "NO_FILES", "没有收到文件。")
        if len(files) > self.config.max_files:
            raise RequestError(400, "TOO_MANY_FILES", f"一次最多 {self.config.max_files} 个文件。")

        total = 0
        for name, data in files:
            if not data:
                raise RequestError(400, "EMPTY_FILE", f"「{name}」是空文件。")
            if len(data) > self.config.max_file_bytes:
                raise RequestError(
                    413, "FILE_TOO_LARGE",
                    f"「{name}」超过单个文件上限 {self.config.max_file_mb} MB。",
                )
            total += len(data)
        if total > self.config.max_total_bytes:
            raise RequestError(413, "TOTAL_TOO_LARGE", f"上传合计超过 {self.config.max_total_mb} MB。")

        documents = []
        failures = []
        for name, data in files:
            try:
                documents.append(extract_document(name, data, self.config.max_chars))
            except ExtractionError as error:
                failures.append({"file": name, "code": error.code, "message": error.message})

        if not documents:
            first = failures[0]
            status = 415 if first["code"] == "UNSUPPORTED_TYPE" else 422
            raise RequestError(status, first["code"], first["message"], details=failures)

        document_text, warnings = build_document(documents, self.config.max_chars)
        warnings.extend(f"「{item['file']}」未能解析：{item['message']}" for item in failures)

        if len(document_text.strip()) < MIN_DOCUMENT_CHARS:
            raise RequestError(
                422, "CONTENT_TOO_SHORT",
                "提取到的文字太少，无法生成可靠课件。",
                details=failures,
            )

        files_meta = [
            {
                "name": document.name,
                "kind": document.kind,
                "units": document.units,
                "locatorKind": document.locator_kind,
            }
            for document in documents
        ]

        if not self.job_slots.acquire(timeout=2.0):
            raise RequestError(429, "BUSY", "并发生成任务已满。")
        try:
            pack, meta = generate_pack(self.config, document_text, files_meta, warnings)
        finally:
            self.job_slots.release()

        self._send(200, {
            "ok": True,
            "pack": pack,
            "meta": {
                **meta,
                "files": files_meta,
                "warnings": warnings,
            },
        })


def make_server(config):
    handler = type(
        "ConfiguredHandler",
        (Handler,),
        {
            "config": config,
            "rate_limiter": RateLimiter(config.rate_limit_per_hour),
            "job_slots": threading.BoundedSemaphore(config.max_concurrent),
        },
    )
    return ThreadingHTTPServer(("0.0.0.0", config.port), handler)


def main():
    import logging

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    try:
        config = Config()
    except ConfigError as error:
        print(f"配置错误：{error}", file=sys.stderr)
        return 2

    summary = config.public_summary()
    print(
        "study-pack 启动："
        f"port={config.port} model={summary['model']} mock={summary['mock']} "
        f"configured={summary['configured']} origins={summary['allowed_origins']}",
        file=sys.stderr,
    )
    if not summary["configured"]:
        print("警告：没有 AI_API_KEY，生成接口会返回 503。", file=sys.stderr)

    httpd = make_server(config)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
