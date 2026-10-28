import json
import pathlib
import threading
import unittest
import urllib.error
import urllib.request

from server.app import make_server
from server.config import Config

FIXTURES = pathlib.Path(__file__).parent / "fixtures"
ORIGIN = "https://example.test"


def multipart(files, extra_fields=None):
    boundary = "----studytestboundary"
    chunks = []
    for name, data in files:
        chunks.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="{name}"\r\n'
            "Content-Type: application/octet-stream\r\n\r\n".encode("utf-8")
        )
        chunks.append(data)
        chunks.append(b"\r\n")
    for field, value in (extra_fields or {}).items():
        chunks.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"\r\n\r\n{value}\r\n'.encode("utf-8")
        )
    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


class StudyServer:
    def __init__(self, overrides=None):
        env = {
            "PORT": "0",
            "AI_MOCK": "1",
            "ALLOWED_ORIGINS": ORIGIN,
            "RATE_LIMIT_PER_HOUR": "100",
            "MAX_FILE_MB": "5",
            "MAX_TOTAL_MB": "10",
            "MAX_CONCURRENT_JOBS": "2",
        }
        env.update(overrides or {})
        self.config = Config(env)
        self.httpd = make_server(self.config)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)

    def request(self, method, path, body=None, headers=None):
        url = f"http://127.0.0.1:{self.port}{path}"
        request = urllib.request.Request(url, data=body, method=method, headers=headers or {})
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                return response.status, dict(response.headers), response.read()
        except urllib.error.HTTPError as error:
            return error.code, dict(error.headers), error.read()

    def post_files(self, files, origin=ORIGIN, extra_fields=None):
        body, content_type = multipart(files, extra_fields)
        return self.request(
            "POST", "/api/study-pack", body,
            {"Content-Type": content_type, "Origin": origin},
        )


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.server = StudyServer()

    def tearDown(self):
        self.server.close()

    def test_health(self):
        status, _, body = self.server.request("GET", "/healthz")
        self.assertEqual(status, 200)
        payload = json.loads(body)
        self.assertTrue(payload["ok"])
        self.assertTrue(payload["configured"])
        self.assertTrue(payload["mock"])
        self.assertNotIn("key", json.dumps(payload).lower())

    def test_preflight_allowed_origin(self):
        status, headers, body = self.server.request(
            "OPTIONS", "/api/study-pack",
            headers={"Origin": ORIGIN, "Access-Control-Request-Method": "POST"},
        )
        self.assertEqual(status, 204)
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), ORIGIN)
        self.assertIn("POST", headers.get("Access-Control-Allow-Methods", ""))
        self.assertEqual(body, b"")

    def test_preflight_rejects_unknown_origin(self):
        status, headers, _ = self.server.request(
            "OPTIONS", "/api/study-pack",
            headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"},
        )
        self.assertEqual(status, 403)
        self.assertIsNone(headers.get("Access-Control-Allow-Origin"))

    def test_generate_with_docx(self):
        data = (FIXTURES / "lecture.docx").read_bytes()
        status, headers, body = self.server.post_files([("lecture.docx", data)])
        self.assertEqual(status, 200, body[:300])
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), ORIGIN)
        payload = json.loads(body)
        self.assertTrue(payload["ok"])
        self.assertTrue(payload["meta"]["mock"])
        self.assertEqual(payload["meta"]["files"][0]["name"], "lecture.docx")
        pack = payload["pack"]
        for field in ("title", "sections", "glossary", "quiz", "sources"):
            self.assertIn(field, pack)
        self.assertGreaterEqual(len(pack["quiz"]), 1)
        self.assertEqual(pack["sources"][0]["file"], "lecture.docx")

    def test_generate_with_multiple_files(self):
        files = [
            ("lecture.pptx", (FIXTURES / "lecture.pptx").read_bytes()),
            ("lecture.pdf", (FIXTURES / "lecture.pdf").read_bytes()),
        ]
        status, _, body = self.server.post_files(files)
        self.assertEqual(status, 200, body[:300])
        payload = json.loads(body)
        self.assertEqual(len(payload["meta"]["files"]), 2)

    def test_unsupported_type(self):
        status, _, body = self.server.post_files([("virus.exe", b"MZ\x90\x00fake")])
        self.assertEqual(status, 415)
        payload = json.loads(body)
        self.assertEqual(payload["error"]["code"], "UNSUPPORTED_TYPE")

    def test_rejects_disallowed_origin_on_post(self):
        data = (FIXTURES / "lecture.docx").read_bytes()
        status, _, body = self.server.post_files([("lecture.docx", data)], origin="https://evil.example")
        self.assertEqual(status, 403)
        self.assertEqual(json.loads(body)["error"]["code"], "ORIGIN_NOT_ALLOWED")

    def test_missing_files(self):
        status, _, body = self.server.post_files([], extra_fields={"note": "hi"})
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(body)["error"]["code"], "NO_FILES")


class ApiLimitTests(unittest.TestCase):
    def test_file_too_large(self):
        server = StudyServer({"MAX_FILE_MB": "1"})
        try:
            big = b"%PDF-1.4\n" + b"0" * (2 * 1024 * 1024)
            status, _, body = server.post_files([("big.pdf", big)])
            self.assertEqual(status, 413)
            self.assertEqual(json.loads(body)["error"]["code"], "FILE_TOO_LARGE")
        finally:
            server.close()

    def test_rate_limit(self):
        server = StudyServer({"RATE_LIMIT_PER_HOUR": "1"})
        try:
            data = (FIXTURES / "lecture.docx").read_bytes()
            first_status, _, _ = server.post_files([("lecture.docx", data)])
            second_status, _, second_body = server.post_files([("lecture.docx", data)])
            self.assertEqual(first_status, 200)
            self.assertEqual(second_status, 429)
            self.assertEqual(json.loads(second_body)["error"]["code"], "RATE_LIMITED")
        finally:
            server.close()

    def test_unconfigured_backend(self):
        server = StudyServer({"AI_MOCK": "0", "AI_API_KEY": ""})
        try:
            data = (FIXTURES / "lecture.docx").read_bytes()
            status, _, body = server.post_files([("lecture.docx", data)])
            self.assertEqual(status, 503)
            self.assertEqual(json.loads(body)["error"]["code"], "AI_NOT_CONFIGURED")
        finally:
            server.close()


if __name__ == "__main__":
    unittest.main()
