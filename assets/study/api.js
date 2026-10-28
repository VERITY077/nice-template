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
  AI_NOT_CONFIGURED: '后端还没有配置 AI 密钥，需要管理员在服务端设置 AI_API_KEY。',
  UNSUPPORTED_TYPE: '请改用 PDF、PPTX、DOCX、TXT 或 MD。旧版 .ppt/.doc 请先另存为新格式。',
  FILE_TOO_LARGE: '压缩文件、拆分课件，或减少一次上传的数量。',
  EXTRACTION_FAILED: '确认文件没有损坏、没有密码保护；扫描版 PDF 需要先做 OCR。',
  PDF_TEXT_UNAVAILABLE: '这是图片型 PDF，文字无法直接提取，需要先 OCR 成文字。',
  CONTENT_TOO_SHORT: '换一份内容更完整的课件，或一次多选几个文件。',
  RATE_LIMITED: '稍等一会儿再试。',
  AI_TIMEOUT: '材料较大时会更慢，可以稍后重试或减少文件数量。',
  AI_UPSTREAM: '这是 AI 服务端的临时问题，稍后重试通常能恢复。',
  AI_BAD_RESPONSE: '模型输出格式不符合要求，重试一次通常可以解决。',
  NETWORK_ERROR: '检查 study_api_base 是否填写正确、后端是否在运行，以及后端是否允许本站跨域。',
  TIMEOUT: '请求超过三分钟仍未返回，可以稍后重试。',
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
