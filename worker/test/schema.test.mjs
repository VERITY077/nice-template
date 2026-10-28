import assert from 'node:assert/strict';
import test from 'node:test';

import { SchemaError } from '../src/errors.js';
import { normalizePack } from '../src/schema.js';

const FILES = [{ name: 'lecture.pptx', kind: 'pptx', units: 3 }];

function validRaw() {
  return {
    title: 'Memory in C',
    course: 'Computer Science',
    sourceLanguage: 'English',
    overview: 'Pointers and arrays.',
    learningGoals: ['解释指针与地址的关系'],
    sections: [{
      title: 'Pointers',
      summary: '指针保存地址。',
      keyPoints: [
        '指针保存地址。',
        {
          text: '解引用可以读写值。',
          sources: [
            { file: 'lecture.pptx', locator: 'slide 2' },
            { file: 'ghost.pdf', locator: 'page 9' },
          ],
        },
      ],
      terms: [{ term: 'pointer', explanation: '指针' }],
      sources: [{ file: 'lecture.pptx', locator: 'slide 1' }],
    }],
    glossary: [{ original: 'pointer', translation: '指针', note: '保存地址的变量' }],
    quiz: [{
      type: 'multiple_choice',
      question: '哪些操作会读取地址？',
      options: ['&x', '*p', 'x + 1'],
      answer: '&x',
      explanation: '& 取地址。',
      sources: [{ file: 'lecture.pptx', locator: 'slide 2' }],
    }],
    sources: [{ file: 'lecture.pptx', locator: 'slide 1' }],
    warnings: ['示例材料只有一组幻灯片'],
  };
}

test('规范化字段、题型别名与未知来源', () => {
  const pack = normalizePack(validRaw(), FILES);
  assert.equal(pack.title, 'Memory in C');
  assert.equal(pack.sections[0].id, 's1');
  assert.equal(pack.quiz[0].type, 'multiple');
  assert.equal(pack.quiz[0].id, 'q1');
  assert.equal(pack.sections[0].keyPoints[1].sources.length, 1);
  assert.ok(pack.warnings.some((warning) => warning.includes('ghost.pdf')));
});

test('缺少 title 抛 SchemaError', () => {
  const raw = validRaw();
  delete raw.title;
  assert.throws(() => normalizePack(raw, FILES), SchemaError);
});

test('缺少 quiz 抛 SchemaError', () => {
  const raw = validRaw();
  raw.quiz = [];
  assert.throws(() => normalizePack(raw, FILES), (error) => error instanceof SchemaError && error.errors.some((item) => item.includes('quiz')));
});

test('无答案的题被跳过并记录警告', () => {
  const raw = validRaw();
  raw.quiz = [
    { type: 'short', question: '无答案的题' },
    { type: 'short', question: '有答案的题', answer: '答案' },
  ];
  const pack = normalizePack(raw, FILES);
  assert.equal(pack.quiz.length, 1);
  assert.equal(pack.quiz[0].question, '有答案的题');
  assert.ok(pack.warnings.some((warning) => warning.includes('缺少答案')));
});

test('选择题选项不足时降级为简答', () => {
  const raw = validRaw();
  raw.quiz = [{ type: 'single', question: 'q', options: [], answer: 'a' }];
  const pack = normalizePack(raw, FILES);
  assert.equal(pack.quiz[0].type, 'short');
  assert.deepEqual(pack.quiz[0].options, []);
});

test('缺少语言时回退为未识别', () => {
  const raw = validRaw();
  delete raw.sourceLanguage;
  assert.equal(normalizePack(raw, FILES).sourceLanguage, '未识别');
});

test('sources 为空时回退到上传文件列表', () => {
  const raw = validRaw();
  raw.sources = [];
  assert.deepEqual(normalizePack(raw, FILES).sources, [{ file: 'lecture.pptx', locator: '' }]);
});

test('glossary 为空时从章节 terms 回收', () => {
  const raw = validRaw();
  raw.glossary = [];
  raw.quiz = validRaw().quiz;
  const pack = normalizePack(raw, FILES);
  assert.equal(pack.glossary[0].original, 'pointer');
});

test('额外警告会合并', () => {
  const pack = normalizePack(validRaw(), FILES, ['PDF 共 200 页，只处理了前 60 页。']);
  assert.ok(pack.warnings.some((warning) => warning.includes('200')));
});
