import { SchemaError } from './errors.js';

const TYPE_ALIASES = {
  single: 'single', single_choice: 'single', 'single-choice': 'single', radio: 'single', choice: 'single', 单选: 'single', 单选题: 'single',
  multiple: 'multiple', multi: 'multiple', multiple_choice: 'multiple', 'multiple-choice': 'multiple', checkbox: 'multiple', 多选: 'multiple', 多选题: 'multiple',
  short: 'short', short_answer: 'short', open: 'short', text: 'short', 简答: 'short', 简答题: 'short', 问答: 'short',
  application: 'application', apply: 'application', scenario: 'application', 应用: 'application', 应用题: 'application',
};

const MAX_SECTIONS = 15;
const MAX_GLOSSARY = 60;
const MAX_QUIZ = 20;

function clean(value, limit = 6000) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : String(value);
  return text.replace(/\s+/g, ' ').trim().slice(0, limit);
}

function pick(object, ...keys) {
  if (!object || typeof object !== 'object') return undefined;
  for (const key of keys) {
    const value = object[key];
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    return value;
  }
  return undefined;
}

function asList(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeType(value) {
  const key = clean(value, 40).toLowerCase();
  return TYPE_ALIASES[key] || 'short';
}

function fileIndex(files) {
  const index = new Map();
  for (const entry of files || []) {
    const name = clean(entry && entry.name, 260);
    if (!name) continue;
    index.set(name.split('/').pop().toLowerCase(), name);
  }
  return index;
}

function normalizeSources(raw, index, warnings) {
  const result = [];
  const seen = new Set();
  for (const item of asList(raw)) {
    if (!item || typeof item !== 'object') continue;
    const rawFile = clean(pick(item, 'file', 'filename', 'source', 'name'), 260);
    const locator = clean(pick(item, 'locator', 'location', 'page', 'slide', 'section'), 80);
    if (!rawFile) continue;
    const canonical = index.get(rawFile.split('/').pop().toLowerCase());
    if (!canonical) {
      warnings.push(`模型引用了未上传的文件「${rawFile}」，这条出处已忽略。`);
      continue;
    }
    const key = `${canonical}\u0000${locator}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ file: canonical, locator });
  }
  return result;
}

function normalizeKeyPoints(raw, index, warnings) {
  const points = [];
  for (const item of asList(raw)) {
    let text = '';
    let sources = [];
    if (typeof item === 'string') {
      text = clean(item, 1200);
    } else if (item && typeof item === 'object') {
      text = clean(pick(item, 'text', 'point', 'content', 'description'), 1200);
      sources = normalizeSources(pick(item, 'sources', 'citations', 'source'), index, warnings);
    }
    if (text) points.push({ text, sources });
  }
  return points;
}

function normalizeTerms(raw) {
  const terms = [];
  for (const item of asList(raw)) {
    if (!item || typeof item !== 'object') continue;
    const term = clean(pick(item, 'term', 'name', 'word'), 200);
    const explanation = clean(pick(item, 'explanation', 'definition', 'meaning', 'description'), 1500);
    if (term && explanation) terms.push({ term, explanation });
  }
  return terms;
}

function normalizeGlossary(raw) {
  const entries = [];
  for (const item of asList(raw)) {
    if (!item || typeof item !== 'object') continue;
    const original = clean(pick(item, 'original', 'term', 'source', 'word'), 200);
    const translation = clean(pick(item, 'translation', 'meaning', 'zh', 'chinese', 'definition'), 500);
    const note = clean(pick(item, 'note', 'notes', 'comment', 'usage'), 500);
    if (original && translation) entries.push({ original, translation, note });
  }
  return entries.slice(0, MAX_GLOSSARY);
}

function normalizeQuiz(raw, index, warnings) {
  const questions = [];
  for (const [position, item] of asList(raw).entries()) {
    if (!item || typeof item !== 'object') continue;
    const question = clean(pick(item, 'question', 'prompt', 'stem'), 2500);
    const answer = clean(pick(item, 'answer', 'solution', 'correct'), 1500);
    const explanation = clean(pick(item, 'explanation', 'rationale', 'analysis'), 2500);
    let type = normalizeType(pick(item, 'type', 'kind', 'format'));

    const options = [];
    for (const option of asList(pick(item, 'options', 'choices'))) {
      const text = clean(option, 500);
      if (text) options.push(text);
    }

    if (!question) {
      warnings.push(`第 ${position + 1} 道练习题缺少题干，已跳过。`);
      continue;
    }
    if (!answer) {
      warnings.push(`第 ${position + 1} 道练习题缺少答案，已跳过。`);
      continue;
    }
    if ((type === 'single' || type === 'multiple') && options.length < 2) {
      warnings.push(`第 ${position + 1} 道选择题选项不足，已按简答题显示。`);
      type = 'short';
      options.length = 0;
    }

    questions.push({
      id: `q${questions.length + 1}`,
      type,
      question,
      options,
      answer,
      explanation,
      sources: normalizeSources(pick(item, 'sources', 'citations'), index, warnings),
    });
  }
  return questions.slice(0, MAX_QUIZ);
}

export function normalizePack(raw, files, extraWarnings = []) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SchemaError(['模型返回的不是 JSON 对象。']);
  }

  const warnings = [];
  const errors = [];
  const index = fileIndex(files);

  const title = clean(pick(raw, 'title', 'name', 'heading'), 300);
  if (!title) errors.push('缺少 title（材料标题）。');

  const sourceLanguage = clean(pick(raw, 'sourceLanguage', 'source_language', 'language', 'originalLanguage'), 80);

  const sections = [];
  for (const [position, item] of asList(pick(raw, 'sections', 'chapters', 'topics')).entries()) {
    const section = typeof item === 'string' ? { title: item } : item;
    if (!section || typeof section !== 'object') continue;

    const sectionTitle = clean(pick(section, 'title', 'heading', 'name'), 300) || `第 ${position + 1} 节`;
    const summary = clean(pick(section, 'summary', 'overview', 'introduction', 'description'), 4000);
    const keyPoints = normalizeKeyPoints(pick(section, 'keyPoints', 'key_points', 'points'), index, warnings);
    const terms = normalizeTerms(pick(section, 'terms', 'keyTerms', 'key_terms'));
    const sources = normalizeSources(pick(section, 'sources', 'citations'), index, warnings);

    if (summary || keyPoints.length || terms.length) {
      sections.push({
        id: `s${sections.length + 1}`,
        title: sectionTitle,
        summary,
        keyPoints,
        terms,
        sources,
      });
    }
  }
  if (!sections.length) errors.push('缺少 sections（知识总结章节）。');

  let glossary = normalizeGlossary(pick(raw, 'glossary', 'vocabulary', 'terms', 'keyTerms'));
  if (!glossary.length) {
    const seen = new Set();
    for (const section of sections) {
      for (const term of section.terms) {
        if (!term.term || seen.has(term.term)) continue;
        seen.add(term.term);
        glossary.push({ original: term.term, translation: term.explanation, note: '' });
      }
    }
    glossary = glossary.slice(0, MAX_GLOSSARY);
  }
  if (!glossary.length) errors.push('缺少 glossary（重点词汇对照）。');

  const quiz = normalizeQuiz(pick(raw, 'quiz', 'exercises', 'questions'), index, warnings);
  if (!quiz.length) errors.push('缺少 quiz（自测练习）。');

  if (errors.length) throw new SchemaError(errors);

  let sources = normalizeSources(pick(raw, 'sources', 'references'), index, warnings);
  if (!sources.length) {
    sources = (files || [])
      .filter((entry) => entry && entry.name)
      .map((entry) => ({ file: entry.name, locator: '' }));
  }

  const learningGoals = [];
  for (const goal of asList(pick(raw, 'learningGoals', 'learning_goals', 'goals', 'objectives'))) {
    const text = clean(goal, 300);
    if (text) learningGoals.push(text);
  }

  for (const message of asList(pick(raw, 'warnings', 'notes', 'limitations'))) {
    const text = clean(message, 500);
    if (text) warnings.push(text);
  }
  for (const message of extraWarnings) {
    const text = clean(message, 500);
    if (text) warnings.push(text);
  }

  const seenWarnings = new Set();
  const deduped = [];
  for (const message of warnings) {
    if (seenWarnings.has(message)) continue;
    seenWarnings.add(message);
    deduped.push(message);
  }

  return {
    title,
    course: clean(pick(raw, 'course', 'subject', 'topic'), 200),
    sourceLanguage: sourceLanguage || '未识别',
    overview: clean(pick(raw, 'overview', 'summary', 'description'), 4000),
    learningGoals: learningGoals.slice(0, 8),
    sections: sections.slice(0, MAX_SECTIONS),
    glossary,
    quiz,
    sources,
    warnings: deduped.slice(0, 20),
  };
}

export { MAX_SECTIONS, MAX_GLOSSARY, MAX_QUIZ };
