export const QUESTION_UPLOAD_ACCEPT = 'image/*,.pdf,application/pdf';

const PDF_MIME = 'application/pdf';
const MAX_IMAGE_DIM = 1920;
const MAX_PDF_BYTES = 8 * 1024 * 1024;

export function isPdfMime(mime: string): boolean {
  return mime.toLowerCase().includes('pdf');
}

export function isQuestionImageMime(mime: string): boolean {
  return mime.toLowerCase().startsWith('image/');
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

function resizeImageDataUrl(
  dataUrl: string,
  maxDim: number,
  quality: number,
): Promise<{ dataUrl: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('无法处理图片'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve({
        dataUrl: canvas.toDataURL('image/jpeg', quality),
        mimeType: 'image/jpeg',
      });
    };
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = dataUrl;
  });
}

export type ProcessedQuestionUpload = {
  dataUrl: string;
  mimeType: string;
  fileName: string;
};

/** 处理错题上传：图片压缩为 JPEG，PDF 原样保留（供 MinerU / 8080 识别） */
export async function processQuestionUploadFile(file: File): Promise<ProcessedQuestionUpload> {
  const lowerName = file.name.toLowerCase();
  const mime =
    file.type ||
    (lowerName.endsWith('.pdf') ? PDF_MIME : lowerName.match(/\.(png|webp|gif|bmp)$/) ? `image/${lowerName.split('.').pop()}` : 'image/jpeg');

  if (isPdfMime(mime) || lowerName.endsWith('.pdf')) {
    if (file.size > MAX_PDF_BYTES) {
      throw new Error(`PDF 过大（${(file.size / 1024 / 1024).toFixed(1)}MB），请控制在 8MB 以内`);
    }
    const dataUrl = await readFileAsDataUrl(file);
    return { dataUrl, mimeType: PDF_MIME, fileName: file.name };
  }

  if (!isQuestionImageMime(mime)) {
    throw new Error('仅支持图片（JPG/PNG 等）或 PDF 文件');
  }

  const raw = await readFileAsDataUrl(file);
  const resized = await resizeImageDataUrl(raw, MAX_IMAGE_DIM, 0.92);
  return { dataUrl: resized.dataUrl, mimeType: resized.mimeType, fileName: file.name };
}
