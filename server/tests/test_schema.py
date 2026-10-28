import unittest

from server.schema import SchemaError, normalize_pack

FILES = [{"name": "lecture.pptx", "kind": "pptx", "units": 3}]


def valid_raw():
    return {
        "title": "Memory in C",
        "course": "Computer Science",
        "sourceLanguage": "English",
        "overview": "Pointers and arrays.",
        "learningGoals": ["解释指针与地址的关系"],
        "sections": [
            {
                "title": "Pointers",
                "summary": "指针保存地址。",
                "keyPoints": [
                    "指针保存地址。",
                    {
                        "text": "解引用可以读写值。",
                        "sources": [
                            {"file": "lecture.pptx", "locator": "slide 2"},
                            {"file": "ghost.pdf", "locator": "page 9"},
                        ],
                    },
                ],
                "terms": [{"term": "pointer", "explanation": "指针"}],
                "sources": [{"file": "lecture.pptx", "locator": "slide 1"}],
            }
        ],
        "glossary": [{"original": "pointer", "translation": "指针", "note": "保存地址的变量"}],
        "quiz": [
            {
                "type": "multiple_choice",
                "question": "哪些操作会读取地址？",
                "options": ["&x", "*p", "x + 1"],
                "answer": "&x",
                "explanation": "& 取地址。",
                "sources": [{"file": "lecture.pptx", "locator": "slide 2"}],
            }
        ],
        "sources": [{"file": "lecture.pptx", "locator": "slide 1"}],
        "warnings": ["示例材料只有一张幻灯片"],
    }


class NormalizeTests(unittest.TestCase):
    def test_normalizes_and_filters_unknown_sources(self):
        pack = normalize_pack(valid_raw(), FILES)
        self.assertEqual(pack["title"], "Memory in C")
        self.assertEqual(pack["sections"][0]["id"], "s1")
        self.assertEqual(pack["quiz"][0]["type"], "multiple")
        self.assertEqual(pack["quiz"][0]["id"], "q1")
        self.assertEqual(len(pack["sections"][0]["keyPoints"][1]["sources"]), 1)
        self.assertTrue(any("ghost.pdf" in message for message in pack["warnings"]))

    def test_missing_title_raises(self):
        raw = valid_raw()
        raw.pop("title")
        with self.assertRaises(SchemaError):
            normalize_pack(raw, FILES)

    def test_missing_quiz_raises(self):
        raw = valid_raw()
        raw["quiz"] = []
        with self.assertRaises(SchemaError) as ctx:
            normalize_pack(raw, FILES)
        self.assertTrue(any("quiz" in error for error in ctx.exception.errors))

    def test_question_without_answer_is_skipped_with_warning(self):
        raw = valid_raw()
        raw["quiz"] = [
            {"type": "short", "question": "无答案的题"},
            {"type": "short", "question": "有答案的题", "answer": "答案"},
        ]
        pack = normalize_pack(raw, FILES)
        self.assertEqual(len(pack["quiz"]), 1)
        self.assertEqual(pack["quiz"][0]["question"], "有答案的题")
        self.assertTrue(any("缺少答案" in message for message in pack["warnings"]))

    def test_choice_without_options_becomes_short(self):
        raw = valid_raw()
        raw["quiz"] = [{"type": "single", "question": "q", "options": [], "answer": "a"}]
        pack = normalize_pack(raw, FILES)
        self.assertEqual(pack["quiz"][0]["type"], "short")
        self.assertEqual(pack["quiz"][0]["options"], [])

    def test_missing_language_falls_back(self):
        raw = valid_raw()
        raw.pop("sourceLanguage")
        pack = normalize_pack(raw, FILES)
        self.assertEqual(pack["sourceLanguage"], "未识别")

    def test_sources_default_to_uploaded_files(self):
        raw = valid_raw()
        raw["sources"] = []
        pack = normalize_pack(raw, FILES)
        self.assertEqual(pack["sources"], [{"file": "lecture.pptx", "locator": ""}])

    def test_extra_warnings_are_included(self):
        pack = normalize_pack(valid_raw(), FILES, ["PDF 共 200 页，只处理了前 150 页。"])
        self.assertTrue(any("150" in message for message in pack["warnings"]))


if __name__ == "__main__":
    unittest.main()
