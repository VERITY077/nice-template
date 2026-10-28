import { ExtractError } from './errors.js';
import { extractPdf } from './pdf.js';
import { unzip, ZipError } from './zip.js';

export const SUPPORTED_EXTENSIONS = ['pdf', 'pptx', 'docx', 'txt', 'md'];

const UNIT_LABELS = {
  pdf: '页',
  pptx: '张幻灯片',
  docx: '个章节',
  txt: '个文档',
  md: '个文档',
};

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(value) {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (match, code) => {
    if (code[0] === '#') {
      const numeric = code[1].toLowerCase() === 'x'
        ? Number.parseInt(code.slice(2), 16)
        : Number.parseInt(code.slice(1), 10);
      if (!Number.isFinite(numeric)) return match;
      try {
        return String.fromCodePoint(numeric);
      } catch {
        return match;
      }
    }
    return XML_ENTITIES[code] ?? match;
  });
}

export function extensionOf(name) {
  const value = String(name || '').trim();
  const dot = value.lastIndexOf('.');
  return dot <= 0 ? '' : value.slice(dot + 1).toLowerCase();
}

function textRuns(fragment, tag) {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g');
  let output = '';
  for (const match of fragment.matchAll(pattern)) output += decodeXml(match[1]);
  return output.trim();
}

async function extractDocx(name, archive) {
  if (!archive.has('word/document.xml')) {
    throw new ExtractError('EXTRACTION_FAILED', 'DOCX 里找不到正文（word/document.xml）。');
  }
  const xml = await archive.text('word/document.xml');
  const paragraphs = [...xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)].map((match) => match[1]);

  const blocks = [];
  let section = 0;
  for (const paragraph of paragraphs) {
    const text = textRuns(paragraph, 'w:t');
    if (!text) continue;

    const styleMatch = paragraph.match(/<w:pStyle\b[^>]*w:val="([^"]*)"/);
    const style = styleMatch ? styleMatch[1].trim() : '';
    const lowered = style.toLowerCase();
    const isHeading = lowered.startsWith('heading') || style.startsWith('标题') || lowered === 'title';

    if (isHeading) {
      section += 1;
      blocks.push(`\n[[SECTION ${section}: ${text}]]`);
    } else {
      blocks.push(text);
    }
  }

  const body = blocks.join('\n').trim();
  if (!body) throw new ExtractError('EXTRACTION_FAILED', '这个 DOCX 里没有可提取的文字。');

  return {
    name,
    kind: 'docx',
    text: body,
    units: section || 1,
    locatorKind: section ? 'section' : 'document',
    warnings: [],
  };
}

async function extractPptx(name, archive) {
  const slides = archive.names()
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]));

  if (!slides.length) {
    throw new ExtractError('EXTRACTION_FAILED', 'PPTX 里找不到幻灯片内容。');
  }

  const chunks = [];
  let emptySlides = 0;
  for (let index = 0; index < slides.length; index += 1) {
    const xml = await archive.text(slides[index]);
    const paragraphs = [...xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)].map((match) => match[1]);
    const lines = paragraphs.map((paragraph) => textRuns(paragraph, 'a:t')).filter(Boolean);
    if (!lines.length) {
      emptySlides += 1;
      continue;
    }
    chunks.push(`[[SLIDE ${index + 1}]]\n${lines.join('\n')}`);
  }

  if (!chunks.length) {
    throw new ExtractError('EXTRACTION_FAILED', '幻灯片里没有可提取的文字（可能是纯图片版幻灯片）。');
  }

  const warnings = [];
  if (emptySlides) warnings.push(`有 ${emptySlides} 张幻灯片没有可提取的文字，已跳过。`);

  return {
    name,
    kind: 'pptx',
    text: chunks.join('\n\n'),
    units: slides.length,
    locatorKind: 'slide',
    warnings,
  };
}

function extractPlain(name, bytes) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ExtractError('EXTRACTION_FAILED', '文本文件不是 UTF-8 编码，请转码后再上传。');
  }
  if (text.includes('\u0000')) {
    throw new ExtractError('EXTRACTION_FAILED', '这看起来不是文本文件。');
  }
  text = text.trim();
  if (!text) throw new ExtractError('EXTRACTION_FAILED', '文本文件是空的。');

  return {
    name,
    kind: extensionOf(name),
    text,
    units: 1,
    locatorKind: 'document',
    warnings: [],
  };
}

async function extractOffice(name, ext, bytes) {
  let archive;
  try {
    archive = await unzip(bytes);
  } catch (error) {
    const message = error instanceof ZipError ? error.message : 'Office 文件解压失败。';
    throw new ExtractError('EXTRACTION_FAILED', `无法解压这个 ${ext.toUpperCase()}：${message}`);
  }

  const hasDocument = archive.has('word/document.xml');
  const hasSlides = archive.names().some((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry));

  if (ext === 'docx' && !hasDocument) {
    throw new ExtractError(
      'EXTRACTION_FAILED',
      hasSlides ? '扩展名是 .docx，但内容实际是 PPTX，请检查文件。' : '文件内容与 .docx 扩展名不符。',
    );
  }
  if (ext === 'pptx' && !hasSlides) {
    throw new ExtractError(
      'EXTRACTION_FAILED',
      hasDocument ? '扩展名是 .pptx，但内容实际是 DOCX，请检查文件。' : '文件内容与 .pptx 扩展名不符。',
    );
  }

  return ext === 'docx' ? extractDocx(name, archive) : extractPptx(name, archive);
}

export async function extractDocument(name, bytes, config) {
  const ext = extensionOf(name);
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    if (ext === 'ppt' || ext === 'doc') {
      throw new ExtractError(
        'UNSUPPORTED_TYPE',
        `暂不支持旧版 .${ext} 格式，请先另存为 .${ext}x 再上传。`,
      );
    }
    throw new ExtractError('UNSUPPORTED_TYPE', '只支持 PDF、PPTX、DOCX、TXT、MD。');
  }

  if (ext === 'pdf') {
    const isPdf = bytes.length >= 5
      && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
    if (!isPdf) {
      throw new ExtractError('EXTRACTION_FAILED', '文件内容与 .pdf 扩展名不符，可能已损坏。');
    }
    return extractPdf(name, bytes, config.maxPdfPages);
  }

  if (ext === 'docx' || ext === 'pptx') {
    if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      throw new ExtractError('EXTRACTION_FAILED', `文件内容与 .${ext} 扩展名不符，可能已损坏。`);
    }
    return extractOffice(name, ext, bytes);
  }

  return extractPlain(name, bytes);
}

export function describeUnits(document) {
  const label = UNIT_LABELS[document.kind] || '个单元';
  return `${document.units} ${label}`;
}

export function buildDocument(documents, maxChars) {
  const warnings = [];
  const blocks = [];

  for (const document of documents) {
    blocks.push(`[[FILE: ${document.name}]]\n（类型：${document.kind.toUpperCase()}；共 ${describeUnits(document)}）`);
    blocks.push(document.text);
    for (const message of document.warnings) warnings.push(`${document.name}：${message}`);
  }

  let text = blocks.join('\n\n').trim();
  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
    warnings.push(`全部材料合计过长，只保留了前 ${maxChars} 个字符。`);
  }
  return { text, warnings };
}
