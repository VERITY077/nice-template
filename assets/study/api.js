import { CONFIG } from './config.js';

export class ApiError extends Error {
  constructor(code, message, hint = '') {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.hint = hint;
  }
}

const HINTS = {
  AI_NOT_CONFIGURED: 'Worker 还没有配置 DEEPSEEK_API_KEY；请在 Cloudflare 控制台为该 Worker 添加 Secret。',
  AI_AUTH: 'Worker 的 DEEPSEEK_API_KEY 无效或已过期，请更新 Secret 后重试。',
  UNSUPPORTED_TYPE: '请改用 PDF、PPTX、DOCX、TXT 或 MD。旧版 .ppt/.doc 请先另存为新格式。',
  FILE_TOO_LARGE: '压缩或拆分文件；当前上限由 Worker 的环境变量决定。',
  TOTAL_TOO_LARGE: '减少一次上传的文件数量，或压缩文件。',
  EXTRACTION_FAILED: '确认文件没有损坏、没有密码保护；扫描版 PDF 需要先做 OCR。',
  PDF_TEXT_UNAVAILABLE: '这是图片型 PDF，Worker 暂不支持 OCR，请先转成文字版。',
  CONTENT_TOO_SHORT: '换一份内容更完整的课件，或一次多选几个文件。',
  RATE_LIMITED: '触发了限流，稍后再试。',
  AI_TIMEOUT: '材料较大时会更慢，可以稍后重试或减少文件数量。',
  AI_UPSTREAM: 'DeepSeek 或网络暂时不可用，稍后重试通常能恢复。',
  AI_BAD_RESPONSE: '模型输出格式不符合要求，重试一次通常可以解决。',
  NETWORK_ERROR: '检查 study_api_base 是否为 Worker 的 HTTPS 地址、Worker 是否已部署，以及 ALLOWED_ORIGINS 是否包含本站。',
  TIMEOUT: '请求超时，可以稍后重试或减少文件数量。',
  NOT_FOUND: 'API 路径不存在，确认 study_api_base 只填 Worker 的域名、不要带路径。',
};

export function describeError(error) {
  if (!error) return { message: '发生了未知错误。', hint: '' };
  if (error.name === 'AbortError') return { message: '已取消本次生成。', hint: '' };
  if (error instanceof ApiError) {
    return { message: error.message, hint: error.hint || HINTS[error.code] || '' };
  }
  return { message: error.message || '发生了未知错误。', hint: '' };
}

/**
 * 上传文件并请求后端生成课件。
 * 用 XHR 是为了拿到上传进度；返回值是 { pack, meta }。
 */
export function generateStudyPack({ files, onProgress, signal }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${CONFIG.apiBase}/api/study-pack`, true);
    xhr.timeout = CONFIG.requestTimeoutMs;

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || typeof onProgress !== 'function') return;
      onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };

    xhr.onload = () => {
      let body = null;
      try {
        body = JSON.parse(xhr.responseText || '{}');
      } catch (error) {
        body = null;
      }

      if (xhr.status >= 200 && xhr.status < 300 && body && body.ok && body.pack) {
        resolve({ pack: body.pack, meta: body.meta || {} });
        return;
      }

      const detail = (body && body.error) || {};
      reject(new ApiError(
        detail.code || `HTTP_${xhr.status}`,
        detail.message || `服务返回了 HTTP ${xhr.status}。`,
        detail.hint || '',
      ));
    };

    xhr.onerror = () => reject(new ApiError('NETWORK_ERROR', '无法连接生成服务。'));
    xhr.ontimeout = () => reject(new ApiError('TIMEOUT', '请求超时，服务没有在限定时间内返回。'));
    xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'));

    if (signal) {
      if (signal.aborted) {
        reject(new DOMException('aborted', 'AbortError'));
        return;
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    const form = new FormData();
    for (const item of files) form.append('files', item.file, item.file.name);
    xhr.send(form);
  });
}
