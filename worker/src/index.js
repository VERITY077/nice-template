import { generatePack } from './ai.js';
import { publicSummary, readConfig } from './config.js';
import { AppError, AIError, ExtractError } from './errors.js';
import { buildDocument, extractDocument } from './extract.js';

const MIN_DOCUMENT_CHARS = 200;
const BODY_SLACK = 1024 * 1024;

// 进程内、尽力而为的限流；Workers 多实例下不共享，重启即清零。
const requestHits = new Map();

function normalizeOrigin(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function rateLimited(key, limit) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const hits = (requestHits.get(key) || []).filter((stamp) => now - stamp < windowMs);
  if (hits.length >= limit) {
    requestHits.set(key, hits);
    return true;
  }
  hits.push(now);
  requestHits.set(key, hits);
  if (requestHits.size > 5000) requestHits.clear();
  return false;
}

function baseHeaders(origin, config) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (origin && config.allowedOrigins.includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.append('Vary', 'Origin');
  }
  return headers;
}

function json(data, status, origin, config) {
  return new Response(JSON.stringify(data), {
    status,
    headers: baseHeaders(origin, config),
  });
}

function errorBody(error) {
  if (error instanceof AppError) {
    return {
      status: error.status,
      payload: {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          hint: error.hint || '',
          details: error.details || [],
        },
      },
    };
  }
  return {
    status: 500,
    payload: {
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: '服务内部错误。', hint: '', details: [] },
    },
  };
}

function preflight(origin, config) {
  if (!origin || !config.allowedOrigins.includes(origin)) {
    return new Response(null, { status: 403 });
  }
  const headers = new Headers({
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  });
  return new Response(null, { status: 204, headers });
}

async function readUploads(request, config) {
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw new AppError(400, 'BAD_REQUEST', '请使用 multipart/form-data 上传文件。');
  }

  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (declaredLength > config.maxTotalBytes + BODY_SLACK) {
    throw new AppError(413, 'TOTAL_TOO_LARGE', `上传合计超过 ${Math.round(config.maxTotalBytes / 1024 / 1024)} MB。`);
  }

  let form;
  try {
    form = await request.formData();
  } catch (error) {
    throw new AppError(400, 'BAD_REQUEST', '无法解析上传内容。');
  }

  const files = form.getAll('files').filter(
    (file) => file && typeof file.arrayBuffer === 'function' && typeof file.name === 'string',
  );

  if (!files.length) throw new AppError(400, 'NO_FILES', '没有收到文件。');
  if (files.length > config.maxFiles) {
    throw new AppError(400, 'TOO_MANY_FILES', `一次最多 ${config.maxFiles} 个文件。`);
  }

  let total = 0;
  for (const file of files) {
    if (!file.size) throw new AppError(400, 'EMPTY_FILE', `「${file.name}」是空文件。`);
    if (file.size > config.maxFileBytes) {
      throw new AppError(413, 'FILE_TOO_LARGE', `「${file.name}」超过单个文件上限 ${Math.round(config.maxFileBytes / 1024 / 1024)} MB。`);
    }
    total += file.size;
  }
  if (total > config.maxTotalBytes) {
    throw new AppError(413, 'TOTAL_TOO_LARGE', `上传合计超过 ${Math.round(config.maxTotalBytes / 1024 / 1024)} MB。`);
  }

  return files;
}

async function handleStudyPack(request, config, origin) {
  if (rateLimited(request.headers.get('cf-connecting-ip') || 'unknown', config.rateLimit)) {
    throw new AppError(429, 'RATE_LIMITED', '请求过于频繁，请稍后再试。');
  }

  const files = await readUploads(request, config);
  const documents = [];
  const failures = [];

  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      documents.push(await extractDocument(file.name, bytes, config));
    } catch (error) {
      if (error instanceof ExtractError) {
        failures.push({ file: file.name, code: error.code, message: error.message });
      } else {
        throw error;
      }
    }
  }

  if (!documents.length) {
    const first = failures[0];
    throw new AppError(
      first.code === 'UNSUPPORTED_TYPE' ? 415 : 422,
      first.code,
      first.message,
      '',
      failures,
    );
  }

  const { text, warnings } = buildDocument(documents, config.maxChars);
  for (const failure of failures) warnings.push(`「${failure.file}」未能解析：${failure.message}`);

  if (text.trim().length < MIN_DOCUMENT_CHARS) {
    throw new AppError(422, 'CONTENT_TOO_SHORT', '提取到的文字太少，无法生成可靠课件。', '', failures);
  }

  const filesMeta = documents.map((document) => ({
    name: document.name,
    kind: document.kind,
    units: document.units,
    locatorKind: document.locatorKind,
  }));

  const { pack, meta } = await generatePack(config, text, filesMeta, warnings);

  return json({
    ok: true,
    pack,
    meta: { ...meta, files: filesMeta, warnings },
  }, 200, origin, config);
}

export default {
  async fetch(request, env) {
    const config = readConfig(env);
    const url = new URL(request.url);
    const origin = normalizeOrigin(request.headers.get('Origin'));
    const originAllowed = !origin || config.allowedOrigins.includes(origin);

    if (request.method === 'OPTIONS') {
      return preflight(origin, config);
    }

    if (request.method === 'GET' && url.pathname === '/healthz') {
      return json({
        ok: true,
        service: 'verity-study',
        ...publicSummary(config),
      }, 200, origin, config);
    }

    if (url.pathname !== '/api/study-pack') {
      return json({
        ok: false,
        error: { code: 'NOT_FOUND', message: '没有这个接口。', hint: '', details: [] },
      }, 404, origin, config);
    }

    if (request.method !== 'POST') {
      return json({
        ok: false,
        error: { code: 'BAD_REQUEST', message: '请使用 POST。', hint: '', details: [] },
      }, 405, origin, config);
    }

    if (!originAllowed) {
      return json({
        ok: false,
        error: { code: 'ORIGIN_NOT_ALLOWED', message: '这个来源不允许调用本服务。', hint: '检查 Worker 的 ALLOWED_ORIGINS。', details: [] },
      }, 403, origin, config);
    }

    try {
      return await handleStudyPack(request, config, origin);
    } catch (error) {
      const { status, payload } = errorBody(error);
      if (!(error instanceof AppError) && !(error instanceof AIError)) {
        // 只记录错误类型，不记录文件内容或请求体。
        console.error('study-pack unhandled', error && error.name ? error.name : 'Error');
      }
      return json(payload, status, origin, config);
    }
  },
};
