import { extractText, getDocumentProxy } from 'unpdf';
import { ExtractError } from './errors.js';

/**
 * 用 unpdf（pdf.js 的无 DOM 包装）按页提取文字。
 * 扫描件没有文字层，会明确报错而不是返回空内容。
 */
export async function extractPdf(name, bytes, maxPages) {
  let pdf;
  try {
    pdf = await getDocumentProxy(bytes);
  } catch (error) {
    throw new ExtractError('EXTRACTION_FAILED', 'PDF 无法打开，文件可能已损坏或设置了密码。');
  }

  let pages;
  try {
    const result = await extractText(pdf, { mergePages: false });
    pages = Array.isArray(result.text) ? result.text : [result.text];
  } catch (error) {
    throw new ExtractError('EXTRACTION_FAILED', 'PDF 文字提取失败，文件可能使用了不支持的编码。');
  }

  const totalPages = Number(pdf.numPages) || pages.length;
  const usedPages = Math.min(pages.length, maxPages);
  const chunks = [];
  for (let index = 0; index < usedPages; index += 1) {
    const text = String(pages[index] || '').trim();
    if (text) chunks.push(`[[PAGE ${index + 1}]]\n${text}`);
  }

  const body = chunks.join('\n\n');
  const warnings = [];
  if (totalPages > maxPages) {
    warnings.push(`PDF 共 ${totalPages} 页，只处理了前 ${maxPages} 页。`);
  }

  const plain = body.replace(/\[\[PAGE \d+\]\]/g, '').replace(/\s+/g, '');
  if (plain.length < 40) {
    throw new ExtractError(
      'PDF_TEXT_UNAVAILABLE',
      '这份 PDF 没有可提取的文字，可能是扫描图片版；暂不支持 OCR。',
    );
  }

  return {
    name,
    kind: 'pdf',
    text: body,
    units: totalPages,
    locatorKind: 'page',
    warnings,
  };
}
