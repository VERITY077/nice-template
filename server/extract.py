"""把上传的课件解析成带出处标记的纯文本。

支持：
- PDF：pypdf 按页提取，扫描件会明确报错而不是返回空内容。
- PPTX：zipfile + ElementTree 按幻灯片提取。
- DOCX：zipfile + ElementTree 按段落提取，标出章节标题。
- TXT / MD：直接按文本读取。

所有内容只在内存中处理，不写磁盘。
"""
import io
import re
import zipfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
W_P = f"{W}p"
W_T = f"{W}t"
W_TBL = f"{W}tbl"
W_TR = f"{W}tr"
W_TC = f"{W}tc"
W_PPR = f"{W}pPr"
W_PSTYLE = f"{W}pStyle"

SUPPORTED = {
    "pdf": "pdf",
    "pptx": "pptx",
    "docx": "docx",
    "txt": "txt",
    "md": "md",
}

UNIT_LABELS = {
    "pdf": "页",
    "pptx": "张幻灯片",
    "docx": "个章节",
    "txt": "个文档",
    "md": "个文档",
}

MAX_PDF_PAGES = 150


class ExtractionError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class ExtractedDocument:
    name: str
    kind: str
    text: str
    units: int
    locator_kind: str
    warnings: list = field(default_factory=list)

    @property
    def char_count(self):
        return len(self.text)


def extension_of(filename):
    name = (filename or "").strip()
    dot = name.rfind(".")
    return "" if dot <= 0 else name[dot + 1:].lower()


def sniff_kind(data):
    """根据文件头判断类型，用于和扩展名交叉校验。"""
    if data.startswith(b"%PDF-"):
        return "pdf"
    if data.startswith(b"PK\x03\x04"):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                names = archive.namelist()
        except zipfile.BadZipFile:
            return None
        if any(name.startswith("word/") for name in names):
            return "docx"
        if any(name.startswith("ppt/") for name in names):
            return "pptx"
        return None
    return None


def detect_kind(filename, data):
    ext = extension_of(filename)
    if ext not in SUPPORTED:
        if ext in {"ppt", "doc"}:
            raise ExtractionError(
                "UNSUPPORTED_TYPE",
                f"暂不支持旧版 .{ext} 格式，请在 Office 里另存为 .{ext}x 后再上传。",
            )
        raise ExtractionError("UNSUPPORTED_TYPE", "只支持 PDF、PPTX、DOCX、TXT、MD。")

    if ext in {"pdf", "pptx", "docx"}:
        sniffed = sniff_kind(data)
        if sniffed != ext:
            raise ExtractionError(
                "EXTRACTION_FAILED",
                f"文件内容与扩展名 .{ext} 不符，可能已损坏或被改过后缀。",
            )
    elif b"\x00" in data[:4096]:
        raise ExtractionError("EXTRACTION_FAILED", "这看起来不是文本文件。")
    return ext


def _decode_text(data):
    for encoding in ("utf-8-sig", "gb18030", "utf-16"):
        try:
            return data.decode(encoding)
        except (UnicodeDecodeError, LookupError):
            continue
    return data.decode("utf-8", "replace")


def _paragraph_text(paragraph):
    parts = [node.text or "" for node in paragraph.iter(W_T)]
    return "".join(parts).strip()


def _heading_style(paragraph):
    props = paragraph.find(W_PPR)
    if props is None:
        return ""
    style = props.find(W_PSTYLE)
    if style is None:
        return ""
    return (style.get(f"{W}val") or "").strip()


def _is_heading(style):
    lowered = style.lower()
    return lowered.startswith("heading") or style.startswith("标题") or lowered == "title"


def _iter_paragraphs(parent):
    """按文档顺序遍历段落，包括表格单元格内的段落。"""
    for child in parent:
        if child.tag == W_P:
            yield child
        elif child.tag == W_TBL:
            for row in child.findall(W_TR):
                for cell in row.findall(W_TC):
                    yield from _iter_paragraphs(cell)
        else:
            yield from _iter_paragraphs(child)


def _extract_docx(name, data):
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            if "word/document.xml" not in archive.namelist():
                raise ExtractionError("EXTRACTION_FAILED", "DOCX 里找不到正文（word/document.xml）。")
            xml = archive.read("word/document.xml")
    except zipfile.BadZipFile:
        raise ExtractionError("EXTRACTION_FAILED", "DOCX 文件已损坏，无法解压。") from None

    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        raise ExtractionError("EXTRACTION_FAILED", "DOCX 正文 XML 解析失败。") from None

    body = root.find(f"{W}body")
    if body is None:
        raise ExtractionError("EXTRACTION_FAILED", "DOCX 里找不到 body。")

    blocks = []
    section = 0
    for paragraph in _iter_paragraphs(body):
        text = _paragraph_text(paragraph)
        if not text:
            continue
        style = _heading_style(paragraph)
        if _is_heading(style):
            section += 1
            blocks.append(("heading", f"[[SECTION {section}: {text}]]"))
        else:
            blocks.append(("text", text))

    if not any(kind == "text" for kind, _ in blocks):
        raise ExtractionError("EXTRACTION_FAILED", "这个 DOCX 里没有可提取的文字。")

    has_heading = section > 0
    lines = []
    for kind, value in blocks:
        if kind == "heading":
            lines.append("")
            lines.append(value)
        else:
            lines.append(value)
    text = "\n".join(lines).strip()
    return ExtractedDocument(
        name=name,
        kind="docx",
        text=text,
        units=section or 1,
        locator_kind="section" if has_heading else "document",
    )


def _extract_pptx(name, data):
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            slide_names = [
                entry for entry in archive.namelist()
                if re.fullmatch(r"ppt/slides/slide\d+\.xml", entry)
            ]
            if not slide_names:
                raise ExtractionError("EXTRACTION_FAILED", "PPTX 里找不到幻灯片内容。")
            slide_names.sort(key=lambda entry: int(re.search(r"(\d+)\.xml$", entry).group(1)))

            chunks = []
            empty_slides = 0
            for index, entry in enumerate(slide_names, start=1):
                try:
                    root = ET.fromstring(archive.read(entry))
                except ET.ParseError:
                    continue
                lines = []
                for paragraph in root.iter(f"{A}p"):
                    text = "".join(node.text or "" for node in paragraph.iter(f"{A}t")).strip()
                    if text:
                        lines.append(text)
                if not lines:
                    empty_slides += 1
                    continue
                chunks.append(f"[[SLIDE {index}]]\n" + "\n".join(lines))
    except zipfile.BadZipFile:
        raise ExtractionError("EXTRACTION_FAILED", "PPTX 文件已损坏，无法解压。") from None

    if not chunks:
        raise ExtractionError(
            "EXTRACTION_FAILED",
            "幻灯片里没有可提取的文字（可能是纯图片版幻灯片）。",
        )

    warnings = []
    if empty_slides:
        warnings.append(f"有 {empty_slides} 张幻灯片没有可提取的文字，已跳过。")

    return ExtractedDocument(
        name=name,
        kind="pptx",
        text="\n\n".join(chunks),
        units=len(slide_names),
        locator_kind="slide",
        warnings=warnings,
    )


def _extract_pdf(name, data):
    try:
        from pypdf import PdfReader
    except ImportError:
        raise ExtractionError(
            "PDF_UNSUPPORTED",
            "服务器没有安装 pypdf，暂时无法解析 PDF。请让管理员安装 requirements.txt。",
        ) from None

    try:
        reader = PdfReader(io.BytesIO(data))
    except Exception:
        raise ExtractionError("EXTRACTION_FAILED", "PDF 无法打开，文件可能已损坏。") from None

    if reader.is_encrypted:
        try:
            reader.decrypt("")
        except Exception:
            raise ExtractionError("EXTRACTION_FAILED", "这个 PDF 有密码保护，请先解除密码。") from None
        if reader.is_encrypted:
            raise ExtractionError("EXTRACTION_FAILED", "这个 PDF 有密码保护，请先解除密码。")

    total_pages = len(reader.pages)
    if total_pages == 0:
        raise ExtractionError("EXTRACTION_FAILED", "这个 PDF 没有任何页面。")

    chunks = []
    warnings = []
    failed_pages = 0
    for index, page in enumerate(reader.pages[:MAX_PDF_PAGES], start=1):
        try:
            text = (page.extract_text() or "").strip()
        except Exception:
            failed_pages += 1
            continue
        if text:
            chunks.append(f"[[PAGE {index}]]\n{text}")

    if total_pages > MAX_PDF_PAGES:
        warnings.append(f"PDF 共 {total_pages} 页，只处理了前 {MAX_PDF_PAGES} 页。")
    if failed_pages:
        warnings.append(f"有 {failed_pages} 页解析失败，已跳过。")

    body = "\n\n".join(chunks)
    if len(body) < 40:
        raise ExtractionError(
            "PDF_TEXT_UNAVAILABLE",
            "这个 PDF 没有可提取的文字，可能是扫描图片版；需要先做 OCR。",
        )

    return ExtractedDocument(
        name=name,
        kind="pdf",
        text=body,
        units=total_pages,
        locator_kind="page",
        warnings=warnings,
    )


def _extract_plain(name, data):
    text = _decode_text(data).strip()
    if not text:
        raise ExtractionError("EXTRACTION_FAILED", "文本文件是空的。")
    return ExtractedDocument(
        name=name,
        kind=extension_of(name),
        text=text,
        units=1,
        locator_kind="document",
    )


def extract_document(name, data, max_chars=120000):
    if not data:
        raise ExtractionError("EXTRACTION_FAILED", "文件是空的。")
    kind = detect_kind(name, data)

    if kind == "docx":
        document = _extract_docx(name, data)
    elif kind == "pptx":
        document = _extract_pptx(name, data)
    elif kind == "pdf":
        document = _extract_pdf(name, data)
    else:
        document = _extract_plain(name, data)

    if len(document.text) > max_chars:
        document.warnings.append(
            f"材料较长，只保留了前 {max_chars} 个字符用于生成。"
        )
        document.text = document.text[:max_chars]
    return document


def describe_units(document):
    label = UNIT_LABELS.get(document.kind, "个单元")
    return f"{document.units} {label}"


def build_document(documents, max_chars=120000):
    """把所有文件拼成一段带 [[FILE: ...]] 标记的文本。"""
    blocks = []
    warnings = []
    for document in documents:
        header = f"[[FILE: {document.name}]]\n（类型：{document.kind.upper()}；共 {describe_units(document)}）"
        blocks.append(header)
        blocks.append(document.text)
        warnings.extend(f"{document.name}：{message}" for message in document.warnings)

    text = "\n\n".join(blocks).strip()
    if len(text) > max_chars:
        text = text[:max_chars]
        warnings.append(f"全部材料合计过长，只保留了前 {max_chars} 个字符。")
    return text, warnings
