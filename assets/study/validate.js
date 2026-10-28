import { CONFIG, LEGACY_FORMATS } from './config.js';

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const rounded = value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1);
  return `${rounded} ${units[index]}`;
}

export function extensionOf(name) {
  const dot = String(name || '').lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

export function labelFor(ext) {
  const format = CONFIG.formats.find((entry) => entry.ext === ext);
  return format ? format.label : ext.toUpperCase();
}

export function fileSignature(file) {
  return `${file.name}::${file.size}::${file.lastModified || 0}`;
}

let counter = 0;

export function makeItem(file) {
  counter += 1;
  const ext = extensionOf(file.name);
  return {
    id: `f${counter}_${Date.now().toString(36)}`,
    file,
    ext,
    label: labelFor(ext),
    size: file.size,
    status: 'ready',
    message: '',
  };
}

/**
 * 校验新选择的文件，返回可接受的 File 列表与逐条错误。
 * existing 是已经在队列里的条目。
 */
export function validateSelection(incoming, existing) {
  const accepted = [];
  const errors = [];
  const seen = new Set(existing.map((item) => fileSignature(item.file)));
  let total = existing.reduce((sum, item) => sum + item.size, 0);

  for (const file of incoming) {
    const ext = extensionOf(file.name);
    const known = CONFIG.formats.some((format) => format.ext === ext);

    if (!known) {
      if (LEGACY_FORMATS[ext]) {
        errors.push({ name: file.name, message: `${LEGACY_FORMATS[ext]} 不受支持，请先在 Office 里另存为 .${ext}x 再上传。` });
      } else {
        errors.push({ name: file.name, message: `.${ext || '未知'} 格式不在支持列表里（PDF / PPTX / DOCX / TXT / MD）。` });
      }
      continue;
    }
    if (file.size === 0) {
      errors.push({ name: file.name, message: '这是空文件，没有可提取的内容。' });
      continue;
    }
    if (file.size > CONFIG.maxFileBytes) {
      errors.push({ name: file.name, message: `大小 ${formatBytes(file.size)}，超过单个文件上限 ${formatBytes(CONFIG.maxFileBytes)}。` });
      continue;
    }
    if (existing.length + accepted.length >= CONFIG.maxFiles) {
      errors.push({ name: file.name, message: `一次最多 ${CONFIG.maxFiles} 个文件。` });
      continue;
    }
    if (seen.has(fileSignature(file))) {
      errors.push({ name: file.name, message: '这个文件已经在列表里了。' });
      continue;
    }
    if (total + file.size > CONFIG.maxTotalBytes) {
      errors.push({ name: file.name, message: `加上它之后合计超过 ${formatBytes(CONFIG.maxTotalBytes)}。` });
      continue;
    }

    seen.add(fileSignature(file));
    total += file.size;
    accepted.push(file);
  }

  return { accepted, errors };
}
