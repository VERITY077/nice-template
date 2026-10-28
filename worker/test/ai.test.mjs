import assert from 'node:assert/strict';
import test from 'node:test';

import { generatePack } from '../src/ai.js';

const FILES = [{ name: 'lecture.pdf', kind: 'pdf', units: 2 }];

function config(overrides = {}) {
  return {
    apiBase: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    apiKey: 'test-key',
    mock: false,
    aiTimeoutMs: 5000,
    ...overrides,
  };
}

function validPack() {
  return {
    title: '极限与连续',
    course: '微积分',
    sourceLanguage: 'English',
    overview: '概览',
    learningGoals: ['理解极限'],
    sections: [{
      title: '极限',
      summary: '趋近过程',
      keyPoints: [{ text: '极限不一定等于函数值。', sources: [{ file: 'lecture.pdf', locator: 'page 1' }] }],
      terms: [{ term: 'limit', explanation: '极限' }],
      sources: [{ file: 'lecture.pdf', locator: 'page 1' }],
    }],
    glossary: [{ original: 'limit', translation: '极限', note: '' }],
    quiz: [{
      type: 'single',
      question: '极限存在需要函数有定义吗？',
      options: ['需要', '不需要'],
      answer: '不需要',
      explanation: '只看趋近过程。',
      sources: [],
    }],
    sources: [{ file: 'lecture.pdf', locator: 'page 1' }],
    warnings: [],
  };
}

function stubFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => {
    globalThis.fetch = original;
  };
}

test('成功的模型响应被规范化，且携带 Bearer 鉴权', async () => {
  let seenInit = null;
  const restore = stubFetch(async (url, init) => {
    seenInit = init;
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(validPack()) }, finish_reason: 'stop' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });

  try {
    const { pack, meta } = await generatePack(config(), '材料正文', FILES, []);
    assert.equal(meta.mock, false);
    assert.equal(meta.model, 'deepseek-chat');
    assert.equal(pack.title, '极限与连续');
    assert.equal(seenInit.headers.Authorization, 'Bearer test-key');
    const body = JSON.parse(seenInit.body);
    assert.equal(body.response_format.type, 'json_object');
    assert.match(body.messages[1].content, /lecture\.pdf/);
  } finally {
    restore();
  }
});

test('401 映射为 AI_AUTH，且不包含密钥', async () => {
  const restore = stubFetch(async () => new Response('unauthorized', { status: 401 }));
  try {
    await assert.rejects(
      () => generatePack(config(), '材料正文', FILES, []),
      (error) => error.code === 'AI_AUTH' && !String(error.message).includes('test-key'),
    );
  } finally {
    restore();
  }
});

test('坏 JSON 会重试一次，然后返回 AI_BAD_RESPONSE', async () => {
  let calls = 0;
  const restore = stubFetch(async () => {
    calls += 1;
    return new Response(JSON.stringify({
      choices: [{ message: { content: '这不是 JSON' }, finish_reason: 'stop' }],
    }), { status: 200 });
  });
  try {
    await assert.rejects(
      () => generatePack(config(), '材料正文', FILES, []),
      (error) => error.code === 'AI_BAD_RESPONSE',
    );
    assert.equal(calls, 2);
  } finally {
    restore();
  }
});

test('结构缺字段会触发修复请求', async () => {
  let calls = 0;
  const restore = stubFetch(async () => {
    calls += 1;
    const payload = calls === 1 ? { title: '只有标题' } : validPack();
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: 'stop' }],
    }), { status: 200 });
  });
  try {
    const { pack } = await generatePack(config(), '材料正文', FILES, []);
    assert.equal(pack.title, '极限与连续');
    assert.equal(calls, 2);
  } finally {
    restore();
  }
});

test('网络中断映射为 AI_UPSTREAM', async () => {
  const restore = stubFetch(async () => {
    throw new TypeError('network down');
  });
  try {
    await assert.rejects(
      () => generatePack(config(), '材料正文', FILES, []),
      (error) => error.code === 'AI_UPSTREAM',
    );
  } finally {
    restore();
  }
});

test('模拟模式不发起任何网络请求', async () => {
  let called = false;
  const restore = stubFetch(async () => {
    called = true;
    return new Response('{}');
  });
  try {
    const { pack, meta } = await generatePack(config({ mock: true, apiKey: '' }), '材料正文', FILES, []);
    assert.equal(called, false);
    assert.equal(meta.mock, true);
    assert.ok(pack.sections.length >= 1);
  } finally {
    restore();
  }
});
