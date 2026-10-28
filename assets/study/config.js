/**
 * 页面配置：只从 DOM dataset 读取，方便在 _config.yml 里统一调整。
 */
const root = document.getElementById('study-app');
const data = root ? root.dataset : {};

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const MB = 1024 * 1024;

export const CONFIG = Object.freeze({
  apiBase: (data.apiBase || '').trim().replace(/\/+$/, ''),
  maxFiles: toPositiveInt(data.maxFiles, 5),
  maxFileBytes: toPositiveInt(data.maxFileMb, 20) * MB,
  maxTotalBytes: toPositiveInt(data.maxTotalMb, 40) * MB,
  docsUrl: data.docsUrl || '',
  requestTimeoutMs: 180000,
  formats: Object.freeze([
    { ext: 'pdf', label: 'PDF', mime: 'application/pdf' },
    { ext: 'pptx', label: 'PPTX', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
    { ext: 'docx', label: 'DOCX', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    { ext: 'txt', label: 'TXT', mime: 'text/plain' },
    { ext: 'md', label: 'MD', mime: 'text/markdown' },
  ]),
});

/** 旧版 Office 格式单独给提示，避免笼统的「不支持」。 */
export const LEGACY_FORMATS = Object.freeze({ ppt: 'PPT（旧版）', doc: 'DOC（旧版）' });
