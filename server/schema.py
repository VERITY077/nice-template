"""校验并规范化模型输出，保证前端拿到稳定结构。

模型偶尔会改字段名、漏字段或引用不存在的文件，这里统一收口：
- 缺关键字段 -> 抛 SchemaError，由 ai.py 触发一次修复重试；
- 非关键问题 -> 尽量修正，并写入 warnings，不编造内容。
"""

ALLOWED_QUIZ_TYPES = {"single", "multiple", "short", "application"}

TYPE_ALIASES = {
    "single": "single", "single_choice": "single", "single-choice": "single",
    "radio": "single", "choice": "single", "单选": "single", "单选题": "single",
    "multiple": "multiple", "multi": "multiple", "multiple_choice": "multiple",
    "multiple-choice": "multiple", "checkbox": "multiple", "多选": "multiple", "多选题": "multiple",
    "short": "short", "short_answer": "short", "open": "short", "text": "short",
    "简答": "short", "简答题": "short", "问答": "short",
    "application": "application", "apply": "application", "scenario": "application",
    "应用": "application", "应用题": "application",
}

MAX_SECTIONS = 15
MAX_GLOSSARY = 60
MAX_QUIZ = 20


class SchemaError(Exception):
    def __init__(self, errors):
        self.errors = list(errors)
        super().__init__("；".join(self.errors))


def _clean(value, limit=6000):
    if value is None:
        return ""
    if not isinstance(value, str):
        value = str(value)
    return " ".join(value.split()).strip()[:limit]


def _pick(mapping, *keys):
    if not isinstance(mapping, dict):
        return None
    for key in keys:
        if key in mapping and mapping[key] not in (None, "", [], {}):
            return mapping[key]
    return None


def _as_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _normalize_type(value):
    key = _clean(value, 40).lower()
    return TYPE_ALIASES.get(key, "short")


def _file_index(files):
    index = {}
    for entry in files:
        name = _clean(entry.get("name"), 260)
        if not name:
            continue
        index[name.split("/")[-1].lower()] = name
    return index


def _normalize_sources(raw, file_index, warnings):
    result = []
    seen = set()
    for item in _as_list(raw):
        if not isinstance(item, dict):
            continue
        raw_file = _clean(_pick(item, "file", "filename", "source", "name"), 260)
        locator = _clean(_pick(item, "locator", "location", "page", "slide", "section"), 80)
        if not raw_file:
            continue
        canonical = file_index.get(raw_file.split("/")[-1].lower())
        if not canonical:
            warnings.append(f"模型引用了未上传的文件「{raw_file}」，这条出处已忽略。")
            continue
        key = (canonical, locator)
        if key in seen:
            continue
        seen.add(key)
        result.append({"file": canonical, "locator": locator})
    return result


def _normalize_key_points(raw, file_index, warnings):
    points = []
    for item in _as_list(raw):
        if isinstance(item, str):
            text = _clean(item, 1200)
            sources = []
        elif isinstance(item, dict):
            text = _clean(_pick(item, "text", "point", "content", "description"), 1200)
            sources = _normalize_sources(_pick(item, "sources", "citations", "source"), file_index, warnings)
        else:
            continue
        if text:
            points.append({"text": text, "sources": sources})
    return points


def _normalize_terms(raw):
    terms = []
    for item in _as_list(raw):
        if not isinstance(item, dict):
            continue
        term = _clean(_pick(item, "term", "name", "word"), 200)
        explanation = _clean(_pick(item, "explanation", "definition", "meaning", "description"), 1500)
        if term and explanation:
            terms.append({"term": term, "explanation": explanation})
    return terms


def _normalize_glossary(raw):
    entries = []
    for item in _as_list(raw):
        if not isinstance(item, dict):
            continue
        original = _clean(_pick(item, "original", "term", "source", "word"), 200)
        translation = _clean(_pick(item, "translation", "meaning", "zh", "chinese", "definition"), 500)
        note = _clean(_pick(item, "note", "notes", "comment", "usage"), 500)
        if original and translation:
            entries.append({"original": original, "translation": translation, "note": note})
    return entries[:MAX_GLOSSARY]


def _normalize_quiz(raw, file_index, warnings):
    questions = []
    for index, item in enumerate(_as_list(raw), start=1):
        if not isinstance(item, dict):
            continue
        question = _clean(_pick(item, "question", "prompt", "stem"), 2500)
        answer = _clean(_pick(item, "answer", "solution", "correct"), 1500)
        explanation = _clean(_pick(item, "explanation", "rationale", "analysis"), 2500)
        quiz_type = _normalize_type(_pick(item, "type", "kind", "format"))

        options = []
        for option in _as_list(_pick(item, "options", "choices")):
            text = _clean(option, 500)
            if text:
                options.append(text)

        if not question:
            warnings.append(f"第 {index} 道练习题缺少题干，已跳过。")
            continue
        if not answer:
            warnings.append(f"第 {index} 道练习题缺少答案，已跳过。")
            continue
        if quiz_type in {"single", "multiple"} and len(options) < 2:
            warnings.append(f"第 {index} 道选择题选项不足，已按简答题显示。")
            quiz_type = "short"
            options = []

        questions.append({
            "id": f"q{len(questions) + 1}",
            "type": quiz_type,
            "question": question,
            "options": options,
            "answer": answer,
            "explanation": explanation,
            "sources": _normalize_sources(_pick(item, "sources", "citations"), file_index, warnings),
        })
    return questions[:MAX_QUIZ]


def normalize_pack(raw, files, extra_warnings=None):
    """把模型 JSON 规范化为前端使用的结构；关键字段缺失时抛 SchemaError。"""
    if not isinstance(raw, dict):
        raise SchemaError(["模型返回的不是 JSON 对象。"])

    warnings = []
    errors = []
    file_index = _file_index(files or [])

    title = _clean(_pick(raw, "title", "name", "heading"), 300)
    if not title:
        errors.append("缺少 title（材料标题）。")

    source_language = _clean(_pick(raw, "sourceLanguage", "source_language", "language", "originalLanguage"), 80)

    sections_raw = _as_list(_pick(raw, "sections", "chapters", "topics"))
    sections = []
    for index, item in enumerate(sections_raw, start=1):
        if isinstance(item, str):
            item = {"title": item, "summary": ""}
        if not isinstance(item, dict):
            continue
        section_title = _clean(_pick(item, "title", "heading", "name"), 300) or f"第 {index} 节"
        summary = _clean(_pick(item, "summary", "overview", "introduction", "description"), 4000)
        key_points = _normalize_key_points(_pick(item, "keyPoints", "key_points", "points"), file_index, warnings)
        terms = _normalize_terms(_pick(item, "terms", "keyTerms", "key_terms"))
        sources = _normalize_sources(_pick(item, "sources", "citations"), file_index, warnings)
        if summary or key_points or terms:
            sections.append({
                "id": f"s{len(sections) + 1}",
                "title": section_title,
                "summary": summary,
                "keyPoints": key_points,
                "terms": terms,
                "sources": sources,
            })
    sections = sections[:MAX_SECTIONS]
    if not sections:
        errors.append("缺少 sections（知识总结章节）。")

    glossary = _normalize_glossary(_pick(raw, "glossary", "vocabulary", "terms", "keyTerms"))
    if not glossary:
        # 模型偶尔只在章节 terms 里给术语；用这些回收，不算编造。
        seen_terms = set()
        for section in sections:
            for term in section.get("terms", []):
                key = term.get("term")
                if key and key not in seen_terms:
                    seen_terms.add(key)
                    glossary.append({"original": key, "translation": term.get("explanation", ""), "note": ""})
        glossary = glossary[:MAX_GLOSSARY]
    if not glossary:
        errors.append("缺少 glossary（重点词汇对照）。")

    quiz = _normalize_quiz(_pick(raw, "quiz", "exercises", "questions"), file_index, warnings)
    if not quiz:
        errors.append("缺少 quiz（自测练习）。")

    if errors:
        raise SchemaError(errors)

    sources = _normalize_sources(_pick(raw, "sources", "references"), file_index, warnings)
    if not sources:
        sources = [{"file": entry.get("name"), "locator": ""} for entry in files or [] if entry.get("name")]

    goals = []
    for goal in _as_list(_pick(raw, "learningGoals", "learning_goals", "goals", "objectives")):
        text = _clean(goal, 300)
        if text:
            goals.append(text)

    for message in _as_list(_pick(raw, "warnings", "notes", "limitations")):
        text = _clean(message, 500)
        if text:
            warnings.append(text)

    for message in extra_warnings or []:
        if message:
            warnings.append(_clean(message, 500))

    # 去重并截断，避免把模型的长篇解释塞进警告区
    deduped = []
    seen = set()
    for message in warnings:
        if message in seen:
            continue
        seen.add(message)
        deduped.append(message)

    return {
        "title": title,
        "course": _clean(_pick(raw, "course", "subject", "topic"), 200),
        "sourceLanguage": source_language or "未识别",
        "overview": _clean(_pick(raw, "overview", "summary", "description"), 4000),
        "learningGoals": goals[:8],
        "sections": sections,
        "glossary": glossary,
        "quiz": quiz,
        "sources": sources,
        "warnings": deduped[:20],
    }
