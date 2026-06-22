/**
 * 题目配图处理：MinerU 图片嵌入、HTML 表格转 Markdown、电路图占位符替换
 */

import type { QuestionFigure } from './questionImageAnalyze.js';

export type ParsedMineruImage = {
  name: string;
  mime: string;
  /** base64 正文，不含 data: 前缀 */
  data: string;
};

function stripDataUrlPrefix(raw: string): string {
  return raw.replace(/^data:[^;]+;base64,/, '').trim();
}

function mimeFromName(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.webp')) return 'image/webp';
  if (n.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

/** 解析 MinerU API 返回的 images 字典 */
export function parseMineruImagesDict(
  images: Record<string, string> | undefined,
): ParsedMineruImage[] {
  if (!images || typeof images !== 'object') return [];
  const out: ParsedMineruImage[] = [];
  for (const [name, value] of Object.entries(images)) {
    if (!value || typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    const mimeMatch = trimmed.match(/^data:([^;]+);base64,/i);
    const mime = mimeMatch?.[1] || mimeFromName(name);
    const data = stripDataUrlPrefix(trimmed);
    if (!data) continue;
    out.push({ name, mime, data });
  }
  return out;
}

/** 从 ZIP 二进制条目提取 images/ 下的文件 */
export function parseMineruImagesFromZipEntries(
  files: Record<string, Uint8Array>,
): ParsedMineruImage[] {
  const out: ParsedMineruImage[] = [];
  for (const [path, data] of Object.entries(files)) {
    if (!path.includes('images/') && !path.startsWith('images/')) continue;
    const name = path.split('/').pop() || path;
    if (!/\.(jpg|jpeg|png|webp|gif)$/i.test(name)) continue;
    out.push({
      name,
      mime: mimeFromName(name),
      data: Buffer.from(data).toString('base64'),
    });
  }
  return out;
}

function figuresFromParsedImages(images: ParsedMineruImage[]): QuestionFigure[] {
  return images.map((img, i) => ({
    id: `fig-mineru-${i + 1}`,
    label: images.length === 1 ? '电路图' : `配图 ${i + 1}`,
    mime: img.mime,
    data: img.data,
    name: img.name,
    note: 'MinerU 从原题中裁剪的配图',
  }));
}

/** 简单 HTML 表格 → Markdown（MinerU 云端常返回 HTML table） */
export function htmlTablesToMarkdown(text: string): string {
  return text.replace(/<table>[\s\S]*?<\/table>/gi, (tableHtml) => {
    const rows: string[][] = [];
    const rowMatches = tableHtml.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
    for (const rowHtml of rowMatches) {
      const cells: string[] = [];
      const cellMatches = rowHtml.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) ?? [];
      for (const cellHtml of cellMatches) {
        const inner = cellHtml.replace(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/i, '$1');
        const plain = inner
          .replace(/<br\s*\/?>/gi, ' ')
          .replace(/<[^>]+>/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        cells.push(plain);
      }
      if (cells.length) rows.push(cells);
    }
    if (!rows.length) return tableHtml;
    const header = rows[0];
    const body = rows.slice(1);
    const sep = `| ${header.map(() => '---').join(' | ')} |`;
    const lines = [
      `| ${header.join(' | ')} |`,
      sep,
      ...body.map((r) => `| ${r.join(' | ')} |`),
    ];
    return lines.join('\n');
  });
}

function figureDataUri(fig: { mime: string; data: string }): string {
  const d = stripDataUrlPrefix(fig.data);
  return `data:${fig.mime || 'image/jpeg'};base64,${d}`;
}

/** 将 MinerU markdown 中的图片引用替换为可渲染的 data URL */
export function embedFiguresInMarkdown(
  markdown: string,
  figures: QuestionFigure[],
): string {
  let md = markdown;
  const byName = new Map<string, QuestionFigure>();
  for (const fig of figures) {
    byName.set(fig.id, fig);
  }

  // ![](images/xxx.jpg) 或 ![...](xxx.jpg) 或 ![...](/api/results/rid/images/xxx.jpg)
  md = md.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (full, alt, src) => {
    const s = String(src).trim();
    if (s.startsWith('data:')) return full;
    if (s.startsWith('http')) return full;
    const baseName = s.split('/').pop()?.split('?')[0] || s;
    const fig =
      figures.find((f) => f.id === s) ??
      figures.find((f) => f.name === baseName) ??
      figures.find((f) => (f as QuestionFigure & { name?: string }).name === baseName);
    if (!fig) {
      const idx = figures.length === 1 ? 0 : figures.findIndex((_, i) => s.includes(String(i)));
      if (idx >= 0) return `![${alt || figures[idx].label}](${figureDataUri(figures[idx])})`;
      return full;
    }
    return `![${alt || fig.label}](${figureDataUri(fig)})`;
  });

  md = md.replace(/<!--\s*image\s*-->/gi, () => {
    const circuit = figures.find((f) => f.id === 'fig-circuit') ?? figures[0];
    if (!circuit) return '[电路图见原题配图]';
    return `![${circuit.label}](${figureDataUri(circuit)})`;
  });

  return md;
}

export type PostprocessMineruOptions = {
  markdown: string;
  parsedImages: ParsedMineruImage[];
  /** 无 MinerU 裁剪图时，用原题截图作为电路图占位 */
  fallbackCircuit?: { mime: string; data: string };
};

/** 规范化 MinerU 输出并生成配图列表 */
export function postprocessMineruMarkdown(opts: PostprocessMineruOptions): {
  markdown: string;
  figures: QuestionFigure[];
} {
  let md = opts.markdown.trim();
  md = htmlTablesToMarkdown(md);

  const mineruFigures = figuresFromParsedImages(opts.parsedImages);
  const figures: QuestionFigure[] = [];

  if (mineruFigures.length > 0) {
    // 单张配图视为电路图
    const circuit: QuestionFigure = {
      ...mineruFigures[0],
      id: 'fig-circuit',
      label: '电路图',
      note: 'MinerU 从原题裁剪',
    };
    figures.push(circuit);
    for (let i = 1; i < mineruFigures.length; i++) {
      figures.push(mineruFigures[i]);
    }
  } else if (opts.fallbackCircuit?.data) {
    figures.push({
      id: 'fig-circuit',
      label: '电路图（原题截图）',
      mime: opts.fallbackCircuit.mime || 'image/jpeg',
      data: stripDataUrlPrefix(opts.fallbackCircuit.data),
      note: '未从 MinerU 获得独立裁剪图，展示原题截图供对照',
    });
  }

  if (figures.length) {
    md = embedFiguresInMarkdown(md, figures);
  }

  return { markdown: md, figures };
}

/** 将 fig-main 等占位符替换为真实 data URL（写入 API 响应，前端无需再 resolve） */
export function embedAnalysisFigurePlaceholders(
  rawOcrText: string,
  figures: QuestionFigure[],
  sourceImage?: { mime: string; data: string },
): string {
  let text = rawOcrText;
  const circuit =
    figures.find((f) => f.id === 'fig-circuit') ??
    figures.find((f) => /电路/.test(f.label)) ??
    figures[0];
  const fallback = sourceImage
    ? { mime: sourceImage.mime, data: stripDataUrlPrefix(sourceImage.data) }
    : null;

  const uriFor = (fig?: QuestionFigure) => {
    if (fig) return figureDataUri(fig);
    if (fallback) return figureDataUri(fallback);
    return null;
  };

  const embedCircuit = (alt = '电路图') => {
    const uri = uriFor(circuit);
    return uri ? `![${alt}](fig-circuit)` : '[电路图见原题配图]';
  };

  text = text.replace(/\[电路图见原题配图\]/g, () => embedCircuit('电路图'));

  text = text.replace(/!\[([^\]]*)\]\((fig-circuit|fig-main)\)/g, (_m, alt) => {
    return `![${alt || '电路图'}](fig-circuit)`;
  });

  text = text.replace(/<!--\s*image\s*-->/gi, () => embedCircuit('电路图'));

  // 避免 rawOcrText 内嵌超大 data URL（localStorage 易截断导致裂图）
  text = text.replace(/!\[([^\]]*)\]\(data:[^)]+\)/g, (_m, alt) => {
    return `![${alt || '电路图'}](fig-circuit)`;
  });

  if (/如图|电路/.test(text) && !/!\[.*?\]\(fig-(?:circuit|main)\)/.test(text)) {
    text = `${text.trim()}\n\n![电路图](fig-circuit)`;
  }

  return text;
}
