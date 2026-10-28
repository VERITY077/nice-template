/**
 * 极简 ZIP 读取器：只依赖 Web 标准的 DecompressionStream。
 * 用于在 Worker 里解压 DOCX / PPTX，不引入额外解压库。
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

export class ZipError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ZipError';
  }
}

async function inflateRaw(data) {
  if (typeof DecompressionStream !== 'function') {
    throw new ZipError('当前运行环境不支持 deflate 解压。');
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder('utf-8');

  let eocd = -1;
  const minPosition = Math.max(0, bytes.length - 22 - 65535);
  for (let position = bytes.length - 22; position >= minPosition; position -= 1) {
    if (view.getUint32(position, true) === EOCD_SIGNATURE) {
      eocd = position;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('不是有效的 ZIP 容器。');

  const entryCount = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (entryCount === 0xffff || centralOffset === 0xffffffff) {
    throw new ZipError('暂不支持 ZIP64 格式。');
  }

  const entries = new Map();
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) {
      throw new ZipError('ZIP 中央目录损坏。');
    }
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));

    if (uncompressedSize > MAX_ENTRY_BYTES) {
      throw new ZipError(`条目 ${name} 解压后超过 64 MB，已拒绝。`);
    }
    entries.set(name, { method, compressedSize, uncompressedSize, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  async function read(name) {
    const entry = entries.get(name);
    if (!entry) throw new ZipError(`压缩包中缺少 ${name}。`);

    const header = entry.localOffset;
    if (view.getUint32(header, true) !== LOCAL_SIGNATURE) {
      throw new ZipError(`ZIP 本地头损坏：${name}`);
    }
    const nameLength = view.getUint16(header + 26, true);
    const extraLength = view.getUint16(header + 28, true);
    const start = header + 30 + nameLength + extraLength;
    const end = start + entry.compressedSize;
    if (end > bytes.length) throw new ZipError(`ZIP 数据越界：${name}`);

    const data = bytes.subarray(start, end);
    if (entry.method === 0) return data;
    if (entry.method === 8) return inflateRaw(data);
    throw new ZipError(`不支持的压缩方式 ${entry.method}：${name}`);
  }

  async function text(name) {
    return decoder.decode(await read(name));
  }

  return {
    names: () => [...entries.keys()],
    has: (name) => entries.has(name),
    read,
    text,
  };
}
