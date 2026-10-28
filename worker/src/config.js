const MB = 1024 * 1024;
const DEFAULT_ORIGINS = ['https://verity077.github.io'];

function normalizeSecret(value) {
  let key = String(value || '').trim();
  key = key.replace(/^Bearer\s+/i, '').trim();
  key = key.replace(/^["'`]/, '').replace(/["'`]$/, '').trim();
  return key;
}

function positiveInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function readConfig(env = {}) {
  const origins = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  const mock = String(env.AI_MOCK || '').trim() === '1';

  return {
    apiBase: String(env.DEEPSEEK_API_BASE || 'https://api.deepseek.com').replace(/\/+$/, ''),
    model: String(env.DEEPSEEK_MODEL || 'deepseek-chat').trim(),
    apiKey: normalizeSecret(env.DEEPSEEK_API_KEY),
    mock,
    allowedOrigins: origins.length ? origins : DEFAULT_ORIGINS,
    maxFiles: positiveInt(env.MAX_FILES, 3, 1, 10),
    maxFileBytes: positiveInt(env.MAX_FILE_MB, 5, 1, 50) * MB,
    maxTotalBytes: positiveInt(env.MAX_TOTAL_MB, 10, 1, 100) * MB,
    maxChars: positiveInt(env.MAX_CHARS, 60000, 2000, 200000),
    maxPdfPages: positiveInt(env.MAX_PDF_PAGES, 60, 1, 200),
    rateLimit: positiveInt(env.RATE_LIMIT_PER_HOUR, 20, 1, 1000),
    aiTimeoutMs: positiveInt(env.AI_TIMEOUT_MS, 90000, 10000, 120000),
  };
}

export function publicSummary(config) {
  return {
    model: config.model,
    apiBase: config.apiBase,
    configured: Boolean(config.apiKey) || config.mock,
    mock: config.mock,
    allowedOrigins: config.allowedOrigins,
    limits: {
      maxFiles: config.maxFiles,
      maxFileMb: Math.round(config.maxFileBytes / MB),
      maxTotalMb: Math.round(config.maxTotalBytes / MB),
      maxChars: config.maxChars,
      maxPdfPages: config.maxPdfPages,
    },
  };
}
