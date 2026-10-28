import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import worker from '../src/index.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const read = (name) => new Uint8Array(readFileSync(path.join(FIXTURES, name)));

function env(overrides = {}) {
  return {
    AI_MOCK: '1',
    ALLOWED_ORIGINS: 'https://blog.test,http://localhost:8000',
    MAX_FILES: '3',
    MAX_FILE_MB: '5',
    MAX_TOTAL_MB: '10',
    MAX_CHARS: '60000',
    MAX_PDF_PAGES: '60',
    RATE_LIMIT_PER_HOUR: '100',
    DEEPSEEK_MODEL: 'deepseek-chat',
    DEEPSEEK_API_BASE: 'https://api.deepseek.com',
    ...overrides,
  };
}

async function call(pathname, init = {}, overrides = {}) {
  const response = await worker.fetch(
    new Request(`https://worker.test${pathname}`, init),
    env(overrides),
    {},
  );
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, headers: response.headers, body };
}

function upload(name, bytes, origin = 'https://blog.test', ip = '10.0.0.1') {
  const form = new FormData();
  form.append('files', new File([bytes], name, { type: 'application/octet-stream' }));
  return {
    method: 'POST',
    headers: { Origin: origin, 'CF-Connecting-IP': ip },
    body: form,
  };
}

test('GET /healthz 不含密钥', async () => {
  const { status, body } = await call('/healthz');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.configured, true);
  assert.equal(body.mock, true);
  assert.equal(body.model, 'deepseek-chat');
  assert.ok(!JSON.stringify(body).includes('DEEPSEEK_API_KEY'));
});

test('预检只放行允许的来源', async () => {
  const allowed = await call('/api/study-pack', {
    method: 'OPTIONS',
    headers: { Origin: 'https://blog.test', 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), 'https://blog.test');

  const denied = await call('/api/study-pack', {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.test', 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
});

test('DOCX 上传返回结构化模拟课件', async () => {
  const { status, headers, body } = await call('/api/study-pack', upload('lecture.docx', read('lecture.docx')));
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(headers.get('Access-Control-Allow-Origin'), 'https://blog.test');
  assert.equal(body.ok, true);
  assert.equal(body.meta.mock, true);
  assert.equal(body.meta.files[0].name, 'lecture.docx');
  assert.ok(body.pack.title);
  assert.ok(body.pack.sections.length >= 1);
  assert.ok(body.pack.quiz.length >= 1);
  assert.equal(body.pack.sources[0].file, 'lecture.docx');
});

test('PPTX + PDF 多文件上传', async () => {
  const form = new FormData();
  form.append('files', new File([read('lecture.pptx')], 'lecture.pptx'));
  form.append('files', new File([read('lecture.pdf')], 'lecture.pdf'));
  const { status, body } = await call('/api/study-pack', {
    method: 'POST',
    headers: { Origin: 'https://blog.test', 'CF-Connecting-IP': '10.0.0.2' },
    body: form,
  });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.meta.files.length, 2);
  assert.deepEqual(body.meta.files.map((file) => file.name), ['lecture.pptx', 'lecture.pdf']);
});

test('不支持的格式返回 415', async () => {
  const { status, body } = await call('/api/study-pack', upload('virus.exe', new Uint8Array([77, 90, 0, 1]), 'https://blog.test', '10.0.0.3'));
  assert.equal(status, 415);
  assert.equal(body.error.code, 'UNSUPPORTED_TYPE');
});

test('不在白名单的来源返回 403', async () => {
  const { status, body } = await call('/api/study-pack', upload('lecture.docx', read('lecture.docx'), 'https://evil.test', '10.0.0.4'));
  assert.equal(status, 403);
  assert.equal(body.error.code, 'ORIGIN_NOT_ALLOWED');
});

test('没有文件返回 400', async () => {
  const form = new FormData();
  form.append('note', 'hi');
  const { status, body } = await call('/api/study-pack', {
    method: 'POST',
    headers: { Origin: 'https://blog.test', 'CF-Connecting-IP': '10.0.0.5' },
    body: form,
  });
  assert.equal(status, 400);
  assert.equal(body.error.code, 'NO_FILES');
});

test('超过单文件上限返回 413', async () => {
  const big = new Uint8Array(2 * 1024 * 1024 + 8);
  big.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
  const { status, body } = await call(
    '/api/study-pack',
    upload('big.pdf', big, 'https://blog.test', '10.0.0.6'),
    { MAX_FILE_MB: '1' },
  );
  assert.equal(status, 413);
  assert.equal(body.error.code, 'FILE_TOO_LARGE');
});

test('限流生效', async () => {
  const init = upload('lecture.docx', read('lecture.docx'), 'https://blog.test', '10.9.9.9');
  const first = await call('/api/study-pack', init, { RATE_LIMIT_PER_HOUR: '1' });
  const second = await call('/api/study-pack', upload('lecture.docx', read('lecture.docx'), 'https://blog.test', '10.9.9.9'), { RATE_LIMIT_PER_HOUR: '1' });
  assert.equal(first.status, 200);
  assert.equal(second.status, 429);
  assert.equal(second.body.error.code, 'RATE_LIMITED');
});

test('未配置密钥且非模拟模式返回 503', async () => {
  const { status, body } = await call(
    '/api/study-pack',
    upload('lecture.docx', read('lecture.docx'), 'https://blog.test', '10.0.0.7'),
    { AI_MOCK: '0', DEEPSEEK_API_KEY: '' },
  );
  assert.equal(status, 503);
  assert.equal(body.error.code, 'AI_NOT_CONFIGURED');
});
