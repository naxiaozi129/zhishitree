import { formatMcqOptionsPerLine } from './formatExamDisplay';
import type { QuestionAnalysis, QuestionFigure } from '../services/geminiService';
import {
  figureDataUriIfValid,
  isValidFigureData,
  resolveAnalysisImageUri,
} from '../services/geminiService';

export function isCircuitOrInlineFigure(fig: QuestionFigure): boolean {
  if (fig.id === 'fig-circuit' || fig.id === 'fig-main') return true;
  return /电路|题图|插图|示意图|配图|fig/i.test(fig.label);
}

export type ExamPanelLayout = {
  leftColPx: number;
  imageDisplayHeightPx: number;
  previewScrollMaxPx: number;
};

export function computeExamPanelLayout(
  natural: { w: number; h: number } | null,
  viewportHeight: number,
): ExamPanelLayout {
  const vhCap = Math.round(Math.max(280, viewportHeight * 0.58));
  const minCol = 128;
  const maxCol = 360;

  if (!natural || natural.w <= 0 || natural.h <= 0) {
    const h = Math.min(380, vhCap);
    return { leftColPx: 200, imageDisplayHeightPx: h, previewScrollMaxPx: h };
  }

  const aspect = natural.w / natural.h;
  let leftColPx: number;

  if (aspect < 0.55) {
    leftColPx = Math.round(Math.min(maxCol, Math.max(minCol, vhCap * aspect)));
  } else if (aspect > 1.15) {
    leftColPx = maxCol;
  } else {
    leftColPx = Math.round(Math.min(maxCol, Math.max(minCol, 200 + (aspect - 0.55) * 120)));
  }

  let imageDisplayHeightPx = Math.round(leftColPx / aspect);
  if (imageDisplayHeightPx > vhCap) {
    imageDisplayHeightPx = vhCap;
    leftColPx = Math.round(Math.min(maxCol, Math.max(minCol, imageDisplayHeightPx * aspect)));
    imageDisplayHeightPx = Math.round(leftColPx / aspect);
  }

  const previewScrollMaxPx = Math.max(200, imageDisplayHeightPx);
  return { leftColPx, imageDisplayHeightPx, previewScrollMaxPx };
}

/** 题目内嵌配图 URI：优先裁剪题图，不因与左侧原图相同而省略 */
export function resolveInlineFigureUri(
  analysis: QuestionAnalysis | null,
  fallbackDataUrl?: string | null,
): string | null {
  const figures = analysis?.figures ?? [];
  const preferred =
    figures.find((f) => f.id === 'fig-circuit') ??
    figures.find((f) => /题图|插图|示意图|配图|电路/i.test(f.label)) ??
    figures[0];

  if (preferred) {
    const uri = figureDataUriIfValid(preferred);
    if (uri) return uri;
  }

  for (const fig of figures) {
    const uri = figureDataUriIfValid(fig);
    if (uri) return uri;
  }

  if (analysis?.sourceImage && isValidFigureData(analysis.sourceImage.data)) {
    const uri = figureDataUriIfValid(analysis.sourceImage);
    if (uri) return uri;
  }

  return fallbackDataUrl ?? null;
}

function hasMarkdownImage(md: string): boolean {
  return /!\[[^\]]*\]\([^)]+\)/.test(md);
}

/** 将 OCR 正文中的配图占位符解析为可显示的内嵌图 */
export function prepareOcrMarkdown(
  content: string,
  analysis: QuestionAnalysis | null,
  fallbackImage?: string | null,
): string {
  let md = formatMcqOptionsPerLine(content);
  const inlineSrc = resolveInlineFigureUri(analysis, fallbackImage);
  const fullUri = resolveAnalysisImageUri(analysis, fallbackImage);
  const embedSrc = inlineSrc ?? fullUri;

  if (!embedSrc) {
    return md.replace(/\n{3,}/g, '\n\n').trim();
  }

  const toImg = (alt: string) => `![${alt || '配图'}](${embedSrc})`;

  md = md.replace(/!\[([^\]]*)\]\(fig-circuit\)/g, (_f, alt) => toImg(alt));
  md = md.replace(/!\[([^\]]*)\]\(fig-main\)/g, (_f, alt) => toImg(alt));
  md = md.replace(/\[电路图见原题配图\]/g, () => toImg('配图'));
  md = md.replace(/<!--\s*image\s*-->/gi, () => toImg('配图'));
  md = md.replace(/!\[([^\]]*)\]\((?!data:|https?:|blob:|fig-)([^)]+)\)/g, (_f, alt) => toImg(alt));

  md = md.replace(/!\[([^\]]*)\]\(data:[^)]*\)/g, (full, alt) => {
    const m = full.match(/base64,([^)]+)/);
    if (!m || m[1].trim().length < 64) return toImg(alt);
    return full;
  });

  if (/如图|如图所示|见图/.test(md) && !hasMarkdownImage(md)) {
    md = md.replace(
      /(如图[所示]*[^。\n]*[。\n]?)/,
      (m) => `${m.trim()}\n\n${toImg('配图')}\n\n`,
    );
  }

  return md.replace(/\n{3,}/g, '\n\n').trim();
}
