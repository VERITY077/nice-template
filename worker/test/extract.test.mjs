import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildDocument, extractDocument } from '../src/extract.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const config = { maxPdfPages: 60, maxChars: 60000 };
const read = (name) => new Uint8Array(readFileSync(path.join(FIXTURES, name)));

test('DOCX：提取章节标记、正文与表格', async () => {
  const document = await extractDocument('lecture.docx', read('lecture.docx'), config);
  assert.equal(document.kind, 'docx');
  assert.match(document.text, /\[\[SECTION 1: C Pointer Basics\]\]/);
  assert.match(document.text, /A pointer stores the memory address/);
  assert.match(document.text, /address of x/);
  assert.equal(document.locatorKind, 'section');
});

test('PPTX：按幻灯片提取，保留中文', async () => {
  const document = await extractDocument('lecture.pptx', read('lecture.pptx'), config);
  assert.equal(document.kind, 'pptx');
  assert.match(document.text, /\[\[SLIDE 1\]\]/);
  assert.match(document.text, /Lecture 3: Memory in C/);
  assert.match(document.text, /\[\[SLIDE 3\]\]/);
  assert.match(document.text, /指针保存地址/);
  assert.equal(document.units, 3);
  assert.equal(document.locatorKind, 'slide');
});

test('PDF：按页提取并记录页码', async () => {
  const document = await extractDocument('lecture.pdf', read('lecture.pdf'), config);
  assert.equal(document.kind, 'pdf');
  assert.match(document.text, /\[\[PAGE 1\]\]/);
  assert.match(document.text, /Limits and continuity/);
  assert.match(document.text, /\[\[PAGE 2\]\]/);
  assert.equal(document.units, 2);
  assert.equal(document.locatorKind, 'page');
});

test('PDF 页数超过上限时截断并给出警告', async () => {
  const document = await extractDocument('lecture.pdf', read('lecture.pdf'), { ...config, maxPdfPages: 1 });
  assert.match(document.text, /\[\[PAGE 1\]\]/);
  assert.doesNotMatch(document.text, /\[\[PAGE 2\]\]/);
  assert.ok(document.warnings.some((warning) => warning.includes('只处理了前 1 页')));
});

test('伪造的 PDF 被拒绝', async () => {
  await assert.rejects(
    () => extractDocument('not-a-pdf.pdf', read('not-a-pdf.pdf'), config),
    (error) => error.code === 'EXTRACTION_FAILED',
  );
});

test('旧版 .ppt 给出另存为提示', async () => {
  await assert.rejects(
    () => extractDocument('old.ppt', read('lecture.pptx'), config),
    (error) => error.code === 'UNSUPPORTED_TYPE' && /\.pptx/.test(error.message),
  );
});

test('扩展名与内容不符被拒绝', async () => {
  await assert.rejects(
    () => extractDocument('fake.pdf', read('lecture.pptx'), config),
    (error) => error.code === 'EXTRACTION_FAILED',
  );
});

test('TXT 按 UTF-8 读取', async () => {
  const document = await extractDocument('notes.txt', read('notes.txt'), config);
  assert.match(document.text, /二次函数/);
  assert.equal(document.locatorKind, 'document');
});

test('buildDocument 带文件名与类型头，并截断', async () => {
  const document = await extractDocument('lecture.pptx', read('lecture.pptx'), config);
  const { text, warnings } = buildDocument([document], 60);
  assert.match(text, /\[\[FILE: lecture\.pptx\]\]/);
  assert.match(text, /类型：PPTX/);
  assert.ok(text.length <= 60);
  assert.ok(warnings.some((warning) => warning.includes('只保留了前 60 个字符')));
});
