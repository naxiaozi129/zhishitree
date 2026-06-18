import path from 'node:path';
import mammoth from 'mammoth';
import { stripExamBoilerplate } from './examBoilerplate.js';
import { htmlToExamText } from './questionImages.js';
import type { QuestionImageRef } from './questionYaml.js';

const DOC_EXT = new Set(['.docx', '.doc']);
const PDF_EXT = new Set(['.pdf']);
const TEXT_EXT = new Set(['.txt', '.md', '.yaml', '.yml']);

export type ExamExtractResult = {
  text: string;
  format: string;
  charCount: number;
  /** docx 内嵌图片，键为 img0/img1…，题干中用 {{image:id}} 引用 */
  images?: Record<string, QuestionImageRef>;
};

export function getExamFileExt(fileName: string): string {
  return path.extname(fileName).toLowerCase();
}

export function isIngestibleExamFileName(fileName: string): boolean {
  const ext = getExamFileExt(fileName);
  return DOC_EXT.has(ext) || PDF_EXT.has(ext) || TEXT_EXT.has(ext);
}

/** multer 常将 UTF-8 文件名误读为 latin1，需转回 utf8 */
export function decodeUploadFileName(name: string): string {
  if (!name) return name;
  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    if (decoded && decoded !== name && !decoded.includes('\uFFFD')) return decoded;
  } catch {
    /* keep original */
  }
  return name;
}

/** 优先使用前端 FormData 传来的 UTF-8 文件名 */
export function resolveUploadFileName(multerName: string, bodyName?: unknown): string {
  const fromBody = typeof bodyName === 'string' ? bodyName.trim() : '';
  if (fromBody) return fromBody;
  return decodeUploadFileName(multerName);
}

export function examFileBaseName(fileName: string): string {
  return fileName.replace(/\.(docx|doc|pdf|txt|md|yaml|yml)$/i, '');
}

/** docx/pdf 抽文本后的轻量规范化，利于拆题 */
export function postProcessExamText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\u3000/g, ' ')
    .replace(/([^\n])\s+(?=[A-DＡ-Ｄ][\.、．、)）]\s*)/g, '$1\n')
    .replace(/([^\n])\s+(?=[（(]\s*[1-9]\d{0,2}\s*[）)])/g, '$1\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractPdfFromBuffer(buf: Buffer): Promise<string> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buf });
  try {
    const result = await parser.getText();
    return String(result.text || '').trim();
  } finally {
    await parser.destroy();
  }
}

async function extractDocxWithImages(
  buffer: Buffer,
): Promise<{ text: string; images: Record<string, QuestionImageRef> }> {
  const images: Record<string, QuestionImageRef> = {};
  let seq = 0;

  const result = await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.imgElement((image) =>
        image.read('base64').then((imageBuffer) => {
          const id = `img${seq++}`;
          const mime = image.contentType || 'image/png';
          images[id] = { id, alt: id, mime, data: imageBuffer };
          return { src: `{{image:${id}}}` };
        }),
      ),
    },
  );

  const text = htmlToExamText(String(result.value || ''));
  return { text, images };
}

export async function extractExamTextFromBuffer(
  buffer: Buffer,
  fileNameOrExt: string,
): Promise<ExamExtractResult> {
  const ext = fileNameOrExt.startsWith('.')
    ? fileNameOrExt.toLowerCase()
    : getExamFileExt(fileNameOrExt);

  let text = '';
  let images: Record<string, QuestionImageRef> | undefined;

  if (DOC_EXT.has(ext)) {
    const docx = await extractDocxWithImages(buffer);
    text = docx.text;
    if (Object.keys(docx.images).length > 0) images = docx.images;
  } else if (PDF_EXT.has(ext)) {
    text = await extractPdfFromBuffer(buffer);
  } else if (TEXT_EXT.has(ext)) {
    text = buffer.toString('utf8').trim();
  } else {
    throw new Error(`暂不支持提取 ${ext || '该'} 格式，请使用 docx / pdf / txt`);
  }

  if (!text) throw new Error('未能从文件中提取到文本（可能为扫描件或空文档）');

  text = postProcessExamText(text);
  text = stripExamBoilerplate(text);

  const max = 500_000;
  if (text.length > max) text = `${text.slice(0, max)}\n…（已截断）`;

  return {
    text,
    format: ext.replace('.', '') || 'unknown',
    charCount: text.length,
    images,
  };
}
