/**
 * 把后端返回的结构化课件渲染成 DOM。
 * 只使用 createElement + textContent，避免把模型输出当成 HTML 执行。
 */

const TYPE_LABELS = {
  single: '单选',
  multiple: '多选',
  short: '简答',
  application: '应用题',
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function formatSources(sources, className = 'pack-sources') {
  if (!Array.isArray(sources) || sources.length === 0) return null;
  const list = el('ul', className);
  for (const source of sources) {
    if (!source || !source.file) continue;
    const locator = source.locator ? ` · ${source.locator}` : '';
    list.append(el('li', null, `${source.file}${locator}`));
  }
  return list.children.length ? list : null;
}

function formatMeta(pack, meta) {
  const parts = [];
  if (pack.course) parts.push(pack.course);
  if (pack.sourceLanguage) parts.push(`原文语言：${pack.sourceLanguage}`);
  if (meta && meta.model) parts.push(`模型：${meta.model}`);
  if (meta && Number.isFinite(meta.elapsedMs)) parts.push(`用时 ${Math.max(1, Math.round(meta.elapsedMs / 1000))} 秒`);
  if (Array.isArray(meta && meta.files) && meta.files.length) {
    parts.push(`材料：${meta.files.map((file) => file.name).join('、')}`);
  }
  return parts.join(' · ');
}

function renderGlossary(pack) {
  if (!Array.isArray(pack.glossary) || pack.glossary.length === 0) return null;
  const section = el('section', 'pack-block');
  section.append(el('h3', 'pack-h3', '重点词汇对照'));
  const table = el('table', 'glossary-table');
  const head = el('thead');
  const headRow = el('tr');
  for (const label of ['原文词汇', '中文释义', '备注']) headRow.append(el('th', null, label));
  head.append(headRow);
  const body = el('tbody');
  for (const entry of pack.glossary) {
    const row = el('tr');
    row.append(el('td', 'term-original', entry.original || ''));
    row.append(el('td', 'term-translation', entry.translation || ''));
    row.append(el('td', 'term-note', entry.note || ''));
    body.append(row);
  }
  table.append(head, body);
  section.append(table);
  return section;
}

function renderQuiz(pack) {
  if (!Array.isArray(pack.quiz) || pack.quiz.length === 0) return null;
  const section = el('section', 'pack-block');
  section.append(el('h3', 'pack-h3', '自测练习'));

  const list = el('ol', 'quiz-list');
  pack.quiz.forEach((item, index) => {
    const card = el('li', 'quiz-card');
    const head = el('div', 'quiz-head');
    head.append(el('span', 'quiz-index', `第 ${index + 1} 题`));
    head.append(el('span', 'quiz-type', TYPE_LABELS[item.type] || item.type || '练习'));
    card.append(head);
    card.append(el('p', 'quiz-question', item.question || ''));

    if (Array.isArray(item.options) && item.options.length) {
      const options = el('ol', 'quiz-options');
      for (const option of item.options) options.append(el('li', null, option));
      card.append(options);
    }

    const details = el('details', 'quiz-answer');
    details.append(el('summary', null, '答案与解析'));
    if (item.answer) details.append(el('p', 'quiz-answer-text', `答案：${item.answer}`));
    if (item.explanation) details.append(el('p', 'quiz-explanation', item.explanation));
    const sources = formatSources(item.sources, 'quiz-sources');
    if (sources) details.append(sources);
    card.append(details);
    list.append(card);
  });

  section.append(list);
  return section;
}

export function renderPack(container, pack, meta) {
  container.replaceChildren();

  const header = el('div', 'pack-header');
  header.append(el('h2', 'pack-title', pack.title || '生成的课件'));
  const metaLine = formatMeta(pack, meta);
  if (metaLine) header.append(el('p', 'pack-meta', metaLine));
  if (meta && meta.mock) header.append(el('span', 'badge badge-mock', '模拟数据（未调用真实模型）'));
  container.append(header);

  if (pack.overview) {
    const overview = el('section', 'pack-block');
    overview.append(el('h3', 'pack-h3', '概览'));
    overview.append(el('p', 'pack-overview', pack.overview));
    container.append(overview);
  }

  if (Array.isArray(pack.learningGoals) && pack.learningGoals.length) {
    const goals = el('section', 'pack-block');
    goals.append(el('h3', 'pack-h3', '学习目标'));
    const list = el('ul', 'pack-goals');
    for (const goal of pack.learningGoals) list.append(el('li', null, goal));
    goals.append(list);
    container.append(goals);
  }

  const sections = Array.isArray(pack.sections) ? pack.sections : [];
  if (sections.length) {
    const toc = el('nav', 'pack-toc');
    toc.setAttribute('aria-label', '课件目录');
    toc.append(el('h3', 'pack-h3', '目录'));
    const list = el('ol');
    sections.forEach((section, index) => {
      const item = el('li');
      const link = el('a', null, section.title || `第 ${index + 1} 节`);
      link.href = `#pack-section-${index + 1}`;
      item.append(link);
      list.append(item);
    });
    toc.append(list);
    container.append(toc);
  }

  sections.forEach((section, index) => {
    const block = el('section', 'pack-block pack-section');
    block.id = `pack-section-${index + 1}`;
    block.append(el('h3', 'pack-h3', `${index + 1}. ${section.title || '未命名章节'}`));
    if (section.summary) block.append(el('p', 'pack-summary', section.summary));

    if (Array.isArray(section.keyPoints) && section.keyPoints.length) {
      const points = el('ul', 'pack-points');
      for (const point of section.keyPoints) {
        const text = typeof point === 'string' ? point : point.text;
        if (!text) continue;
        const item = el('li');
        item.append(el('span', null, text));
        const sources = formatSources(typeof point === 'object' ? point.sources : null, 'cite-list');
        if (sources) item.append(sources);
        points.append(item);
      }
      if (points.children.length) block.append(points);
    }

    if (Array.isArray(section.terms) && section.terms.length) {
      const terms = el('dl', 'pack-terms');
      for (const term of section.terms) {
        terms.append(el('dt', null, term.term || ''));
        terms.append(el('dd', null, term.explanation || ''));
      }
      block.append(terms);
    }

    const sources = formatSources(section.sources);
    if (sources) block.append(sources);
    container.append(block);
  });

  const glossary = renderGlossary(pack);
  if (glossary) container.append(glossary);

  const quiz = renderQuiz(pack);
  if (quiz) container.append(quiz);

  if (Array.isArray(pack.sources) && pack.sources.length) {
    const block = el('section', 'pack-block');
    block.append(el('h3', 'pack-h3', '来源说明'));
    const list = el('ul', 'pack-sources');
    for (const source of pack.sources) {
      if (!source || !source.file) continue;
      list.append(el('li', null, `${source.file}${source.locator ? ` · ${source.locator}` : ''}`));
    }
    if (list.children.length) {
      block.append(list);
      container.append(block);
    }
  }

  if (Array.isArray(pack.warnings) && pack.warnings.length) {
    const block = el('section', 'pack-block pack-warnings');
    block.append(el('h3', 'pack-h3', '需要注意'));
    const list = el('ul', 'warn-list');
    for (const warning of pack.warnings) list.append(el('li', null, warning));
    block.append(list);
    container.append(block);
  }
}

function mdEscapeCell(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\n+/g, ' ');
}

function sourceText(source) {
  if (!source || !source.file) return '';
  return `${source.file}${source.locator ? ` · ${source.locator}` : ''}`;
}

export function packToMarkdown(pack) {
  const lines = [];
  lines.push(`# ${pack.title || '学习资料'}`);
  const metaLine = [pack.course, pack.sourceLanguage ? `原文语言：${pack.sourceLanguage}` : ''].filter(Boolean).join(' · ');
  if (metaLine) lines.push('', `> ${metaLine}`);

  if (pack.overview) lines.push('', '## 概览', '', pack.overview);

  if (Array.isArray(pack.learningGoals) && pack.learningGoals.length) {
    lines.push('', '## 学习目标', '');
    for (const goal of pack.learningGoals) lines.push(`- ${goal}`);
  }

  const sections = Array.isArray(pack.sections) ? pack.sections : [];
  if (sections.length) {
    lines.push('', '## 知识总结');
    sections.forEach((section, index) => {
      lines.push('', `### ${index + 1}. ${section.title || ''}`);
      if (section.summary) lines.push('', section.summary);
      if (Array.isArray(section.keyPoints) && section.keyPoints.length) {
        lines.push('');
        for (const point of section.keyPoints) {
          const text = typeof point === 'string' ? point : point.text;
          if (!text) continue;
          const sources = typeof point === 'object' && Array.isArray(point.sources)
            ? point.sources.map(sourceText).filter(Boolean)
            : [];
          lines.push(`- ${text}${sources.length ? `（来源：${sources.join('；')}）` : ''}`);
        }
      }
      if (Array.isArray(section.terms) && section.terms.length) {
        lines.push('');
        for (const term of section.terms) lines.push(`- **${term.term}**：${term.explanation}`);
      }
      if (Array.isArray(section.sources) && section.sources.length) {
        lines.push('');
        for (const source of section.sources) lines.push(`  - 出处：${sourceText(source)}`);
      }
    });
  }

  const glossary = Array.isArray(pack.glossary) ? pack.glossary : [];
  if (glossary.length) {
    lines.push('', '## 重点词汇对照', '', '| 原文词汇 | 中文释义 | 备注 |', '| --- | --- | --- |');
    for (const entry of glossary) {
      lines.push(`| ${mdEscapeCell(entry.original)} | ${mdEscapeCell(entry.translation)} | ${mdEscapeCell(entry.note)} |`);
    }
  }

  const quiz = Array.isArray(pack.quiz) ? pack.quiz : [];
  if (quiz.length) {
    lines.push('', '## 自测练习');
    quiz.forEach((item, index) => {
      lines.push('', `### 第 ${index + 1} 题（${TYPE_LABELS[item.type] || item.type || '练习'}）`, '', item.question || '');
      if (Array.isArray(item.options) && item.options.length) {
        item.options.forEach((option, optionIndex) => {
          lines.push(`${String.fromCharCode(65 + optionIndex)}. ${option}`);
        });
      }
      if (item.answer) lines.push('', `**答案**：${item.answer}`);
      if (item.explanation) lines.push('', `**解析**：${item.explanation}`);
    });
  }

  if (Array.isArray(pack.sources) && pack.sources.length) {
    lines.push('', '## 来源说明', '');
    for (const source of pack.sources) lines.push(`- ${sourceText(source)}`);
  }

  if (Array.isArray(pack.warnings) && pack.warnings.length) {
    lines.push('', '## 需要注意', '');
    for (const warning of pack.warnings) lines.push(`- ${warning}`);
  }

  return `${lines.join('\n')}\n`;
}

export { TYPE_LABELS };
