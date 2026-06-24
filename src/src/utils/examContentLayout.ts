import { splitExamContentSegments } from './formatExamDisplay';

export type ParsedExamBlock =
  | { id: string; kind: 'text'; content: string }
  | { id: string; kind: 'image'; alt: string; src: string; raw: string };

export function parseExamMarkdownBlocks(markdown: string): ParsedExamBlock[] {
  const segments = splitExamContentSegments(markdown.trim());
  const blocks: ParsedExamBlock[] = [];
  let textIdx = 0;
  let imageIdx = 0;
  for (const seg of segments) {
    const m = seg.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (m) {
      blocks.push({
        id: `image-${imageIdx++}`,
        kind: 'image',
        alt: m[1],
        src: m[2],
        raw: seg,
      });
    } else if (seg.trim()) {
      blocks.push({
        id: `text-${textIdx++}`,
        kind: 'text',
        content: seg,
      });
    }
  }
  return blocks;
}

export type OcrBlockStyle = {
  widthPct?: number;
  /** 用户手动改过宽度后为 true，不再自动按比例重算 */
  widthPctManual?: boolean;
  fontScale?: number;
  marginTop?: number;
  offsetXPct?: number;
  align?: 'left' | 'center' | 'right';
};

export type OcrContentLayout = {
  v: 1;
  order?: string[];
  styles: Record<string, OcrBlockStyle>;
};

const BASE_FONT_PX = 14;
const LINE_HEIGHT = 1.45;

export function defaultStyleForBlock(block: ParsedExamBlock): OcrBlockStyle {
  if (block.kind === 'image') {
    return { align: 'center', marginTop: 6, offsetXPct: 0 };
  }
  return { fontScale: 1, marginTop: 0, align: 'left', offsetXPct: 0 };
}

type Size = { w: number; h: number };

/**
 * 按「题图在原图中的宽度占比」与「相对字号行高」综合估算内嵌图宽度。
 * 窄长图（如斜塔）以行高上限为主，宽图以版心占比为主。
 */
export function computeProportionalImageStyle(
  fig: Size,
  source: Size | null,
  containerW: number,
  fontPx = BASE_FONT_PX,
): Pick<OcrBlockStyle, 'widthPct' | 'align' | 'marginTop'> {
  if (fig.w <= 0 || fig.h <= 0 || containerW <= 0) {
    return { widthPct: 50, align: 'center', marginTop: 6 };
  }

  const aspect = fig.w / fig.h;
  const linePx = fontPx * LINE_HEIGHT;
  const maxFigLines = aspect < 0.75 ? 4.2 : 3.6;
  const maxH = linePx * maxFigLines;

  let fromFontPct = ((maxH * aspect) / containerW) * 100;

  let fromPagePct = fromFontPct;
  if (source && source.w > 0) {
    const widthOnPage = fig.w / source.w;
    fromPagePct = widthOnPage * 100 * 1.45;
    const wPx = (containerW * fromPagePct) / 100;
    if (wPx / aspect > maxH) {
      fromPagePct = ((maxH * aspect) / containerW) * 100;
    }
  }

  const widthPct = Math.round(
    Math.min(88, Math.max(20, (fromPagePct + fromFontPct) / 2)),
  );

  const align: OcrBlockStyle['align'] = aspect < 0.9 ? 'center' : 'left';

  return { widthPct, align, marginTop: 6 };
}

export function mergeOcrLayout(
  layout: OcrContentLayout | undefined | null,
  blocks: ParsedExamBlock[],
): OcrContentLayout {
  const styles: Record<string, OcrBlockStyle> = {};
  for (const b of blocks) {
    styles[b.id] = {
      ...defaultStyleForBlock(b),
      ...(layout?.styles?.[b.id] ?? {}),
    };
  }
  const order: string[] = [];
  if (layout?.order?.length) {
    for (const id of layout.order) {
      if (blocks.some((b) => b.id === id) && !order.includes(id)) order.push(id);
    }
  }
  for (const b of blocks) {
    if (!order.includes(b.id)) order.push(b.id);
  }
  return { v: 1, order, styles };
}

export function reorderBlockIds(order: string[], dragId: string, targetId: string): string[] {
  if (dragId === targetId) return order;
  const next = order.filter((id) => id !== dragId);
  const idx = next.indexOf(targetId);
  if (idx < 0) return [...next, dragId];
  next.splice(idx, 0, dragId);
  return next;
}

export { BASE_FONT_PX, LINE_HEIGHT };
