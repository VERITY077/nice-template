import pathlib
import unittest

from server.extract import ExtractionError, build_document, extract_document

FIXTURES = pathlib.Path(__file__).parent / "fixtures"


def read(name):
    return (FIXTURES / name).read_bytes()


class ExtractDocxTests(unittest.TestCase):
    def test_docx_text_and_sections(self):
        document = extract_document("lecture.docx", read("lecture.docx"))
        self.assertEqual(document.kind, "docx")
        self.assertIn("[[SECTION 1: C Pointer Basics]]", document.text)
        self.assertIn("A pointer stores the memory address", document.text)
        self.assertIn("address of x", document.text)
        self.assertGreaterEqual(document.units, 2)
        self.assertEqual(document.locator_kind, "section")


class ExtractPptxTests(unittest.TestCase):
    def test_pptx_slides_and_chinese(self):
        document = extract_document("lecture.pptx", read("lecture.pptx"))
        self.assertEqual(document.kind, "pptx")
        self.assertIn("[[SLIDE 1]]", document.text)
        self.assertIn("Lecture 3: Memory in C", document.text)
        self.assertIn("[[SLIDE 3]]", document.text)
        self.assertIn("指针保存地址", document.text)
        self.assertEqual(document.units, 3)
        self.assertEqual(document.locator_kind, "slide")


class ExtractPdfTests(unittest.TestCase):
    def test_pdf_pages(self):
        document = extract_document("lecture.pdf", read("lecture.pdf"))
        self.assertEqual(document.kind, "pdf")
        self.assertIn("[[PAGE 1]]", document.text)
        self.assertIn("Limits and continuity", document.text)
        self.assertIn("[[PAGE 2]]", document.text)
        self.assertEqual(document.units, 2)
        self.assertEqual(document.locator_kind, "page")

    def test_pdf_with_wrong_magic_is_rejected(self):
        with self.assertRaises(ExtractionError) as ctx:
            extract_document("not-a-pdf.pdf", read("not-a-pdf.pdf"))
        self.assertEqual(ctx.exception.code, "EXTRACTION_FAILED")


class ExtractPlainTests(unittest.TestCase):
    def test_text_file(self):
        document = extract_document("notes.txt", read("notes.txt"))
        self.assertIn("二次函数", document.text)
        self.assertEqual(document.locator_kind, "document")


class ExtractValidationTests(unittest.TestCase):
    def test_legacy_powerpoint_gets_helpful_error(self):
        with self.assertRaises(ExtractionError) as ctx:
            extract_document("old.ppt", read("lecture.pptx"))
        self.assertEqual(ctx.exception.code, "UNSUPPORTED_TYPE")
        self.assertIn(".pptx", ctx.exception.message)

    def test_extension_mismatch_is_rejected(self):
        with self.assertRaises(ExtractionError) as ctx:
            extract_document("fake.pdf", read("lecture.pptx"))
        self.assertEqual(ctx.exception.code, "EXTRACTION_FAILED")

    def test_truncation_adds_warning(self):
        document = extract_document("lecture.pptx", read("lecture.pptx"), max_chars=60)
        self.assertLessEqual(len(document.text), 60)
        self.assertTrue(any("只保留了前" in warning for warning in document.warnings))


class BuildDocumentTests(unittest.TestCase):
    def test_marks_file_boundaries(self):
        document = extract_document("lecture.pptx", read("lecture.pptx"))
        text, warnings = build_document([document])
        self.assertIn("[[FILE: lecture.pptx]]", text)
        self.assertIn("类型：PPTX", text)
        self.assertIn("3 张幻灯片", text)
        self.assertEqual(warnings, [])


if __name__ == "__main__":
    unittest.main()
