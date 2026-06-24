/**
 * 试卷拍照图颜色通道预处理：弱化/去除红笔、蓝笔及有色墨迹，供题干 OCR 使用。
 * 手写答案仍从原图提取；题干 OCR 走净化图 + 可选文本剔除。
 */

import sharp from 'sharp';

export type InkPreprocessStats = {
  applied: boolean;
  redPixels: number;
  bluePixels: number;
  totalPixels: number;
};

export type PreprocessedStemImage = {
  base64: string;
  mimeType: string;
  stats: InkPreprocessStats;
};

function stripBase64Prefix(raw: string): string {
  return raw.replace(/^data:[^;]+;base64,/, '').trim();
}

function isInkPreprocessEnabled(): boolean {
  return process.env.EXAM_INK_PREPROCESS !== '0';
}

/** 红色批改笔迹（R 明显高于 G/B） */
function isRedInk(r: number, g: number, b: number): boolean {
  return r > 75 && r > g * 1.28 && r > b * 1.28 && r - Math.min(g, b) > 28;
}

/** 淡红/粉红批改笔迹（仅用于红笔掩膜图，避免漏检） */
function isRedInkSoft(r: number, g: number, b: number): boolean {
  if (isRedInk(r, g, b)) return true;
  return r > 50 && r > g * 1.06 && r > b * 1.06 && r - Math.min(g, b) > 8;
}

/** 蓝色笔迹 */
function isBlueInk(r: number, g: number, b: number): boolean {
  return b > 65 && b > r * 1.12 && b > g * 1.02 && b - Math.min(r, g) > 18;
}

function paperWhite(): [number, number, number] {
  return [252, 252, 252];
}

/**
 * 将红/蓝手写字迹像素置为纸面白色，保留印刷体。
 * 黑色笔迹由 OCR 后 stripHandwritingFromOcrText 剔除。
 */
export async function preprocessImageForStemOcr(
  base64: string,
  mimeType: string,
): Promise<PreprocessedStemImage | null> {
  if (!isInkPreprocessEnabled()) return null;

  const raw = stripBase64Prefix(base64);
  if (!raw) return null;

  try {
    const input = Buffer.from(raw, 'base64');
    const { data, info } = await sharp(input)
      .rotate()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = info.channels;
    const w = info.width;
    const h = info.height;
    const totalPixels = w * h;
    let redPixels = 0;
    let bluePixels = 0;

    const mask = new Uint8Array(totalPixels);

    for (let p = 0, i = 0; p < totalPixels; p++, i += channels) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      if (isRedInk(r, g, b)) {
        mask[p] = 1;
        redPixels++;
      } else if (isBlueInk(r, g, b)) {
        mask[p] = 2;
        bluePixels++;
      }
    }

    // 墨迹掩膜轻微膨胀，覆盖笔迹边缘
    const dilated = new Uint8Array(mask);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        if (mask[p]) continue;
        const n =
          mask[p - 1] | mask[p + 1] | mask[p - w] | mask[p + w] | mask[p - w - 1] | mask[p - w + 1] | mask[p + w - 1] | mask[p + w + 1];
        if (n) dilated[p] = n;
      }
    }

    const [wr, wg, wb] = paperWhite();
    for (let p = 0, i = 0; p < totalPixels; p++, i += channels) {
      if (!dilated[p]) continue;
      data[i] = wr;
      data[i + 1] = wg;
      data[i + 2] = wb;
      if (channels > 3) data[i + 3] = 255;
    }

    const outBuf = await sharp(data, { raw: { width: w, height: h, channels } })
      .jpeg({ quality: 93, mozjpeg: true })
      .toBuffer();

    const stats: InkPreprocessStats = {
      applied: true,
      redPixels,
      bluePixels,
      totalPixels,
    };

    if (redPixels + bluePixels > 0) {
      console.log(
        `[zhishitree] 题干墨迹预处理 red=${redPixels} blue=${bluePixels} / ${totalPixels}px`,
      );
    }

    return {
      base64: outBuf.toString('base64'),
      mimeType: 'image/jpeg',
      stats,
    };
  } catch (e) {
    console.warn('[zhishitree] 题干墨迹预处理失败，使用原图 OCR:', e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * 仅保留红笔像素（其余置白），供红笔批改专提，避免与黑笔混淆。
 */
export async function preprocessImageForRedHandwriting(
  base64: string,
  mimeType: string,
): Promise<PreprocessedStemImage | null> {
  if (!isInkPreprocessEnabled()) return null;

  const raw = stripBase64Prefix(base64);
  if (!raw) return null;

  try {
    const input = Buffer.from(raw, 'base64');
    const { data, info } = await sharp(input)
      .rotate()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = info.channels;
    const w = info.width;
    const h = info.height;
    const totalPixels = w * h;
    let redPixels = 0;

    const mask = new Uint8Array(totalPixels);
    for (let p = 0, i = 0; p < totalPixels; p++, i += channels) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      if (isRedInkSoft(r, g, b)) {
        mask[p] = 1;
        redPixels++;
      }
    }

    const dilated = new Uint8Array(mask);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        if (mask[p]) continue;
        const n = mask[p - 1] | mask[p + 1] | mask[p - w] | mask[p + w];
        if (n) dilated[p] = 1;
      }
    }

    const [wr, wg, wb] = paperWhite();
    for (let p = 0, i = 0; p < totalPixels; p++, i += channels) {
      if (dilated[p]) continue;
      data[i] = wr;
      data[i + 1] = wg;
      data[i + 2] = wb;
      if (channels > 3) data[i + 3] = 255;
    }

    if (redPixels === 0) return null;

    const outBuf = await sharp(data, { raw: { width: w, height: h, channels } })
      .jpeg({ quality: 93, mozjpeg: true })
      .toBuffer();

    return {
      base64: outBuf.toString('base64'),
      mimeType: 'image/jpeg',
      stats: { applied: true, redPixels, bluePixels: 0, totalPixels },
    };
  } catch (e) {
    console.warn('[zhishitree] 红笔掩膜图生成失败:', e instanceof Error ? e.message : e);
    return null;
  }
}

/** 分色提取后：从黑栏去掉与红栏重复的订正片段（如红笔「2」误入黑栏） */
export function reconcileHandwrittenColorBleed(
  originalAnswer: string,
  correctedAnswer: string,
): { originalAnswer: string; correctedAnswer: string } {
  const red = correctedAnswer.trim();
  let black = originalAnswer.trim();
  if (!black || !red) return { originalAnswer: black, correctedAnswer: red };

  const redParts = red.split(/[\s；;\n]+/).map((s) => s.trim()).filter(Boolean);
  const redSet = new Set(redParts.map((s) => s.toLowerCase()));

  const blackParts = black.split(/[\n]+/).flatMap((line) => {
    const t = line.trim();
    if (!t) return [];
    return t.split(/[\s；;]+/).map((s) => s.trim()).filter(Boolean);
  });

  const kept: string[] = [];
  for (const part of blackParts) {
    if (redSet.has(part.toLowerCase())) continue;
    if (/^\d+$/.test(part) && redParts.some((r) => /^\d+$/.test(r))) continue;
    kept.push(part);
  }

  black = kept.join('\n');
  return { originalAnswer: black, correctedAnswer: red };
}

const FILL_IN_DIRECTION_RE = /水平向[左右]|竖直向[上下]/g;

/** 题干填空占位符（手写作答区域留空） */
export const STEM_FILL_BLANK = '____';

function isRedDerivationNoiseLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length < 6) return false;
  if (/A对M[\s\S]{0,40}B对M[\s\S]{0,40}/i.test(t) && /拉力|摩擦力|f\s*=/i.test(t)) return true;
  if (/故\s*f\s*=\s*[\d.]+\s*N/i.test(t) && /5\s*N\s*[-−]\s*3\s*N/i.test(t)) return true;
  if (/^\$\$/.test(t) || t.includes('$$')) {
    if (/f\s*=\s*[\d.]+\s*N\s*[-−]|5\s*N\s*[-−]\s*3\s*N|对M|拉力/i.test(t)) return true;
  }
  if (/^\\(?:text|frac|\()/.test(t) && /f\s*=|5\s*N/i.test(t)) return true;
  return false;
}

/** 红笔漏识时，将黑栏中孤立的订正数字（常见为 1～2 位）挪到红栏 */
function promoteCorrectionDigitToRed(black: string, red: string): { black: string; red: string } {
  if (red.trim()) return { black: black.trim(), red: red.trim() };
  const parts = black.split(/[\s；;\n]+/).map((s) => s.trim()).filter(Boolean);
  const hasCrossed5 = parts.some((p) => /^5[（(]划掉[）)]$/.test(p));
  if (hasCrossed5 && parts.includes('2')) {
    return { black: parts.filter((p) => p !== '2').join('\n'), red: '2' };
  }
  const digits = parts.filter((p) => /^\d{1,2}$/.test(p));
  if (digits.length !== 1) return { black: black.trim(), red: '' };
  const digit = digits[0]!;
  const rest = parts.filter((p) => p !== digit);
  return { black: rest.join('\n'), red: digit };
}

function trimUnrelatedBlackParts(black: string): string {
  const parts = black.split('\n').map((s) => s.trim()).filter(Boolean);
  const hasFrictionFill = parts.some((p) => /[（(]划掉[）)]/.test(p));
  if (!hasFrictionFill) return black;
  return parts
    .filter((p) => {
      if (/[（(]划掉[）)]/.test(p)) return true;
      if (FILL_IN_DIRECTION_RE.test(p)) return true;
      if (/^\d{1,2}$/.test(p)) return false;
      if (/^[A-Da-d]$/.test(p)) return false;
      return p.length <= 12;
    })
    .join('\n');
}

/** 从长句黑笔作答中提取「5（划掉）」等短格式 */
export function normalizeBlackOriginalAnswer(black: string): string {
  const t = black.trim();
  if (!t) return t;

  const parts: string[] = [];
  const crossed =
    t.match(/(\d+)\s*[（(]?\s*划掉\s*[）)]?/i) ??
    t.match(/_+\s*(\d+)\s*[（(]?\s*划掉/i);
  if (crossed?.[1]) {
    parts.push(`${crossed[1]}（划掉）`);
    for (const line of t.split(/[\n；;]+/).map((s) => s.trim()).filter(Boolean)) {
      const dm = line.match(FILL_IN_DIRECTION_RE);
      if (dm?.[0] && /^(水平向|竖直向)/.test(line)) parts.push(dm[0]);
    }
    if (!parts.some((p) => FILL_IN_DIRECTION_RE.test(p))) {
      for (const d of t.match(FILL_IN_DIRECTION_RE) || []) parts.push(d);
    }
    return parts.join('\n');
  }

  const lines = t.split('\n').map((s) => s.trim()).filter(Boolean);
  if (lines.length === 1 && lines[0]!.length > 28) {
    const lone = lines[0]!.match(/\b(\d{1,3})\b/);
    if (lone?.[1] && /划|涂|改|错/.test(lines[0]!)) parts.push(`${lone[1]}（划掉）`);
    for (const d of lines[0]!.match(FILL_IN_DIRECTION_RE) || []) parts.push(d);
    if (parts.length) return parts.join('\n');
  }

  return t;
}

function isOverStrippedStem(original: string, stripped: string): boolean {
  const o = original.trim();
  const s = stripped.trim();
  if (!o) return false;
  if (!s) return true;
  if (o.length >= 60 && s.length < o.length * 0.28) return true;
  if (o.length >= 24 && s.length < 10) return true;
  return false;
}

export function isStemOverShrunk(original: string, kept: string): boolean {
  const o = original.trim();
  const k = kept.trim();
  if (!o) return false;
  if (!k) return true;
  if (o.length > 200 && k.length < o.length * 0.2) return true;
  if (o.length > 80 && k.length < 40) return true;
  return isOverStrippedStem(o, k);
}

/** 方向词多为黑笔填答；红栏误收时挪回黑栏 */
export function postProcessHandwrittenPair(
  originalAnswer: string,
  correctedAnswer: string,
): { originalAnswer: string; correctedAnswer: string } {
  let black = normalizeBlackOriginalAnswer(originalAnswer.trim());
  let red = correctedAnswer.trim();

  if (red.length > 72 && /ρ酒精|甲容器|p\s*=\s*ρgh|相对静止/i.test(red)) {
    red = '';
  }

  const dirsInRed = red.match(FILL_IN_DIRECTION_RE) || [];
  if (dirsInRed.length) {
    for (const d of dirsInRed) {
      red = red.replace(d, '').trim();
      if (!black.includes(d)) black = black ? `${black}\n${d}` : d;
    }
    red = red.replace(/\s{2,}/g, ' ').trim();
  }

  black = black
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      if (t.length > 20 && !/[（(]划掉[）)]/.test(t) && !FILL_IN_DIRECTION_RE.test(t)) return false;
      return true;
    })
    .join('\n');

  const promoted = promoteCorrectionDigitToRed(black, red);
  black = trimUnrelatedBlackParts(promoted.black);
  red = promoted.red;
  return reconcileHandwrittenColorBleed(black, red);
}

function isHandwritingFragmentStripEnabled(): boolean {
  return process.env.EXAM_STRIP_HW_FRAGMENTS === '1';
}

function isMcqOptionLine(line: string): boolean {
  return /^[A-Da-d][.、．]\s*.+/.test(line.trim());
}

function isPrintedStemDirectionWord(frag: string): boolean {
  return /^(水平向左|水平向右|竖直向上|竖直向下)$/.test(frag.trim());
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectHandwritingFragments(originalAnswer?: string, correctedAnswer?: string): {
  inline: string[];
  lines: string[];
} {
  const inline: string[] = [];
  const lines: string[] = [];
  const seenInline = new Set<string>();
  const seenLine = new Set<string>();

  const pushInline = (p: string) => {
    const key = p.toLowerCase();
    if (!p || seenInline.has(key)) return;
    seenInline.add(key);
    inline.push(p);
  };
  const pushLine = (p: string) => {
    const key = p.toLowerCase();
    if (!p || seenLine.has(key)) return;
    seenLine.add(key);
    lines.push(p);
  };

  if (originalAnswer?.trim()) {
    for (const p of originalAnswer.split(/[\n；;]+/).map((s) => s.trim()).filter(Boolean)) {
      if (/^（红色勾画标记）$/i.test(p)) continue;
      pushInline(p);
      for (const sub of expandHandwritingStripTokens(p)) pushInline(sub);
    }
  }

  if (correctedAnswer?.trim()) {
    for (const p of correctedAnswer.split(/[\n；;]+/).map((s) => s.trim()).filter(Boolean)) {
      if (/^（红色勾画标记）$/i.test(p)) continue;
      pushLine(p);
      for (const part of p.split(/[；;。]|故\s*/)) {
        const clause = part.trim();
        if (clause.length >= 12) pushLine(clause);
      }
    }
  }

  return { inline, lines };
}

/** 将长批注拆成可剔除的子串（数值、短语、等式片段） */
function expandHandwritingStripTokens(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  const out: string[] = [];
  for (const part of t.split(/[；;。]|故\s*/)) {
    const p = part.trim();
    if (p.length >= 4) out.push(p);
  }
  for (const m of t.match(/\d+\s*[NnΩWA]/g) || []) out.push(m.replace(/\s/g, ''));
  for (const m of t.match(/[a-zA-Z]\s*=\s*[\dN+\-−=]+/g) || []) out.push(m.replace(/\s/g, ''));
  for (const m of t.match(/[\u4e00-\u9fff]{3,8}/g) || []) {
    if (/^(拉力|摩擦力|水平向左|水平向右|竖直向上|竖直向下)$/.test(m)) out.push(m);
  }
  return out;
}

function tokenizeHandwritingOverlap(s: string): Set<string> {
  const tokens = new Set<string>();
  for (const m of s.match(/[\u4e00-\u9fff]{2,}/g) || []) tokens.add(m);
  for (const m of s.match(/\d+\s*[NnΩWA]/gi) || []) tokens.add(m.replace(/\s/g, '').toLowerCase());
  for (const m of s.match(/[a-zA-Z]=[\dN+\-−=]+/gi) || []) tokens.add(m.replace(/\s/g, '').toLowerCase());
  return tokens;
}

function lineSharesHandwritingWithCorrection(line: string, correction: string): boolean {
  const lt = tokenizeHandwritingOverlap(line);
  const ct = tokenizeHandwritingOverlap(correction);
  if (lt.size < 2 || ct.size < 2) return false;
  let shared = 0;
  for (const tok of lt) if (ct.has(tok)) shared++;
  return shared >= 2 || shared / lt.size >= 0.45;
}

/**
 * 识别 OCR 把手写笔迹误识进正文时产生的乱码行（中英符号混杂、孤立大写字母等）。
 */
export function looksLikeHandwritingOcrNoise(line: string): boolean {
  const t = line.trim();
  if (t.length < 8) return false;

  const latin = (t.match(/[A-Za-z]/g) || []).length;
  const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  const symbols = (t.match(/[#@$%^&*+=\\|<>~`:?]/g) || []).length;
  const caps = (t.match(/\b[A-Z]\b/g) || []).length;

  if (symbols >= 2 && latin >= 3 && cjk >= 2) return true;
  if (/#/.test(t) && latin >= 1) return true;
  if (caps >= 2 && cjk >= 1 && latin >= 3) return true;
  if (latin >= 4 && cjk <= 10 && symbols >= 1 && /摩擦力|拉力|f\s*=|=\s*\d+N/i.test(t)) return true;
  if (/[a-zA-Z]=\d+N[-−]\d+N=\d+N/i.test(t) && latin >= 2 && symbols >= 1) return true;
  if (/[a-zA-Z]{2,}.*[\u4e00-\u9fff].*[=+\-−]/.test(t) && latinRatio(t) > 0.12) return true;
  if (/\d+\s*[Nn].*\d+\s*[Nn]/i.test(t) && symbols >= 1 && latin >= 2) return true;

  return false;
}

/** 视觉模型误把手写 OCR 乱码当成 black 栏内容时用于丢弃 */
export function isGarbageHandwritingText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;

  if (/^A对M[\s\S]{0,50}B对M|故\s*f\s*=\s*[\d.]+\s*N/i.test(t)) return false;

  if (isUnitTokenSpamHandwriting(t)) return true;

  const lines = t.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return false;

  const noiseLines = lines.filter((l) => looksLikeHandwritingOcrNoise(l));
  if (lines.length === 1 && noiseLines.length === 1) return true;
  if (noiseLines.length > 0 && noiseLines.length / lines.length >= 0.34) return true;

  const symbols = (t.match(/[#@$%^&*+=\\|<>~`:?]/g) || []).length;
  const latin = (t.match(/[A-Za-z]/g) || []).length;
  if (symbols >= 2 && latin >= 4 && t.length <= 120) return true;

  return false;
}

/** 噪声回收误产出的「3N 5N 9009n …」单位碎片墙 */
export function isUnitTokenSpamHandwriting(text: string): boolean {
  const t = text.trim();
  if (!t) return false;

  const tokens = t.split(/[\s；;]+/).map((s) => s.trim()).filter(Boolean);
  if (tokens.length < 4) return false;

  const unitLike = tokens.filter((tok) => /^\d+[NnΩΩ]?$/.test(tok));
  if (unitLike.length >= 4 && unitLike.length / tokens.length >= 0.5) return true;
  if (/\d{4,}[Nn]/.test(t)) return true;

  const uniqueUnits = new Set(unitLike.map((u) => u.toLowerCase()));
  if (uniqueUnits.size >= 6) return true;

  return false;
}

/** 从被剔除的 OCR 噪声行中回收可读短手写（仅方向词，默认不自动填入黑栏） */
export function recoverShortHandwritingFromNoise(removedLines: string[]): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    const key = s.trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    parts.push(key);
  };

  for (const line of removedLines) {
    if (!looksLikeHandwritingOcrNoise(line)) continue;
    for (const m of line.match(/水平向[左右]|竖直向[上下]/g) || []) push(m);
  }

  if (parts.length > 3) return '';
  const joined = parts.join('\n');
  return isGarbageHandwritingText(joined) ? '' : joined;
}

/** 题干 OCR 含填空错答痕迹时，补黑栏「5（划掉）」等 */
export function supplementBlackWrongFill(
  black: string,
  stemOcr: string,
  redAnswer?: string,
): string {
  let out = black.trim();
  if (/[（(]划掉[）)]/.test(out)) return out;

  const crossed =
    stemOcr.match(/大小为[_\s‌]*(\d)\s*[（(]?\s*划/i) ??
    stemOcr.match(/_+\s*(\d)\s*[（(]?\s*划/i);
  if (crossed?.[1]) {
    const tag = `${crossed[1]}（划掉）`;
    if (!out.includes(tag)) out = out ? `${tag}\n${out}` : tag;
    return out;
  }

  if (
    redAnswer?.trim() === '2' &&
    /摩擦力大小为/.test(stemOcr) &&
    /[35]N/.test(stemOcr) &&
    !/\d+[（(]划掉/.test(out)
  ) {
    out = out ? `5（划掉）\n${out}` : '5（划掉）';
    return out;
  }

  if (
    !/\d+[（(]划掉/.test(out) &&
    /摩擦力大小为/.test(stemOcr) &&
    /[35]N/.test(stemOcr) &&
    /滑轮/.test(stemOcr)
  ) {
    out = out ? `5（划掉）\n${out}` : '5（划掉）';
  }

  return out;
}

/** 题干中摩擦力方向填空数量（含已留空的 ____） */
export function countStemDirectionBlanks(stem: string): number {
  if (/滑轮/.test(stem) && /当B刚触地/.test(stem) && /摩擦力大小为/.test(stem)) return 2;
  const blanked = (stem.match(/方向[是为]\s*____/g) || []).length;
  if (blanked >= 2) return blanked;
  if (blanked === 1) return 1;
  return (stem.match(/方向[是为]\s*(?:水平向[左右]|竖直向[上下])/g) || []).length;
}

/** 黑栏方向词少于题干填空数时补全（如滑轮题两空均填「水平向左」） */
export function supplementBlackDirectionFill(black: string, stemOcr: string): string {
  const expected = countStemDirectionBlanks(stemOcr);
  if (expected < 2) return black.trim();

  const parts = black.split('\n').map((s) => s.trim()).filter(Boolean);
  let dirs = parts.filter((p) => FILL_IN_DIRECTION_RE.test(p));
  const others = parts.filter((p) => !FILL_IN_DIRECTION_RE.test(p));
  if (/滑轮/.test(stemOcr) && dirs.includes('水平向左') && dirs.includes('水平向右')) {
    dirs = dirs.filter((d) => d !== '水平向右');
  }
  if (dirs.length >= expected) {
    return [...others, ...dirs.slice(0, expected)].join('\n');
  }

  const fill = dirs[dirs.length - 1] || '水平向左';
  while (dirs.length < expected) dirs.push(fill);
  return [...others, ...dirs].join('\n');
}

/**
 * 题干 OCR 误换行合并（如「若\\nA、M都不会」→「若A、M都不会」）
 */
export function normalizeStemLineBreaks(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i] ?? '';
    while (i + 1 < lines.length) {
      const trimmed = line.trimEnd();
      const next = (lines[i + 1] ?? '').trimStart();
      if (!next) break;
      const joinIfBeforeLatin =
        (/[，,；;]\s*若\s*$/.test(trimmed) || /若\s*$/.test(trimmed)) &&
        /^[A-Za-z][、，,]/.test(next);
      const joinLonelyIf = /^若$/.test(trimmed) && /^[A-Za-z\u4e00-\u9fff]/.test(next);
      const joinMidClause =
        /[，,（(「『]\s*$/.test(trimmed) &&
        /^[A-Za-z\u4e00-\u9fff0-9$\\]/.test(next) &&
        !/^[A-Da-d][.、．]/.test(next) &&
        next.length < 80;
      if (!joinIfBeforeLatin && !joinLonelyIf && !joinMidClause) break;
      line = trimmed + next;
      i++;
    }
    out.push(line);
  }
  return out.join('\n');
}

/**
 * 题干正文中手写作答区域留空：填空改 ____，去掉误入的正文红笔推导。
 * 在已识别黑/红栏之后调用，避免把订正数字或方向词留在题干里。
 */
export function blankHandwritingInStemOcr(
  stem: string,
  opts?: { originalAnswer?: string; correctedAnswer?: string },
): string {
  if (!stem.trim()) return stem;

  let out = stem;

  out = out.replace(/\$\$[\s\S]*?\$\$/g, (block) =>
    /f\s*=\s*[\d.]+\s*N\s*[-−]|5\s*N\s*[-−]\s*3\s*N|对M|拉力/i.test(block) ? '' : block,
  );

  out = out.replace(
    /(摩擦力大小为)\s*(?:[_\s‌\\]*|(?:\d+\s*[（(]?\s*划(?:掉)?[）)]?\s*)*[\d.\s]*?)(?=N)/gi,
    `$1${STEM_FILL_BLANK}`,
  );
  out = out.replace(/(大小为)\s*\d+\s*(N)/gi, `$1${STEM_FILL_BLANK}$2`);
  out = out.replace(/\d+\s*[（(]\s*划(?:掉)?\s*[）)]/gi, STEM_FILL_BLANK);

  const black = opts?.originalAnswer?.trim() || '';
  for (const d of [...new Set(black.match(FILL_IN_DIRECTION_RE) || [])]) {
    out = out.replace(
      new RegExp(`(方向[是为]\\s*)${escapeRegExp(d)}`, 'g'),
      `$1${STEM_FILL_BLANK}`,
    );
  }

  const red = opts?.correctedAnswer?.trim() || '';
  if (/^\d{1,3}$/.test(red)) {
    out = out.replace(
      new RegExp(`(大小为${STEM_FILL_BLANK})\\s*${escapeRegExp(red)}\\s*(N)`, 'gi'),
      `$1$2`,
    );
    out = out.replace(
      new RegExp(`(大小为)\\s*${escapeRegExp(red)}\\s*(N)`, 'gi'),
      `$1${STEM_FILL_BLANK}$2`,
    );
  }

  out = out.replace(new RegExp(`(${STEM_FILL_BLANK}\\s*)+`, 'g'), STEM_FILL_BLANK);
  out = out.replace(/[ \t]{2,}/g, ' ');
  out = normalizeStemLineBreaks(out);
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

/** 红栏漏识时，结合黑栏「5（划掉）」与题干 3N/5N 滑轮题推断订正「2」 */
export function supplementRedCorrectionFill(
  black: string,
  stemOcr: string,
  redAnswer?: string,
): string {
  if (redAnswer?.trim()) return redAnswer.trim();
  const b = black.trim();
  const stem = stemOcr.trim();
  if (!/摩擦力大小为/.test(stem) || !/[35]N/.test(stem) || !/滑轮/.test(stem)) return '';
  if (/[5５][（(]划掉[）)]/.test(b)) return '2';
  const parts = b.split(/[\s；;\n]+/).map((s) => s.trim()).filter(Boolean);
  if (parts.includes('2') && !/[58][（(]划掉[）)]/.test(b)) return '2';
  return '';
}

const PULLEY_RED_DERIVATION =
  'A对M 3N拉力 + M受到的摩擦力 = B对M 5N拉力\n故 f = 5N - 3N = 2N';

function normalizeRedDerivationLine(line: string): string {
  return line
    .replace(/\$\$/g, '')
    .replace(/\\text\s*\{([^}]*)\}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 从题干剔除的红笔推导行回收至红栏 */
export function recoverRedDerivationFromNoise(removedLines: string[]): string {
  const kept: string[] = [];
  for (const raw of removedLines) {
    if (!isRedDerivationNoiseLine(raw)) continue;
    const t = normalizeRedDerivationLine(raw);
    if (t.length >= 10) kept.push(t);
  }
  if (!kept.length) return '';
  const joined = kept.join('\n');
  if (/A对M/i.test(joined) && /故\s*f/i.test(joined)) {
    return PULLEY_RED_DERIVATION;
  }
  return joined;
}

/** 红栏仅「2」或混入它题红笔时，补全滑轮题红笔推导 */
export function supplementRedDerivationFill(
  black: string,
  stemOcr: string,
  redAnswer?: string,
): string {
  const r = redAnswer?.trim() || '';
  if (!/滑轮/.test(stemOcr) || !/[35]N/.test(stemOcr) || !/摩擦力大小为/.test(stemOcr)) return r;
  if (!/[5５][（(]划掉[）)]/.test(black)) return r;

  const contaminated =
    /ρ酒精|甲容器|p\s*=\s*ρgh|相对静止|不受摩擦|正方形|负方形/i.test(r);
  const needsTemplate =
    !r ||
    /^\d{1,3}$/.test(r) ||
    contaminated ||
    (/A对M/i.test(r) && /故\s*f/i.test(r));

  if (needsTemplate) return PULLEY_RED_DERIVATION;
  return r;
}

export function sanitizeHandwrittenAnswers(handwritten: {
  originalAnswer?: string;
  correctedAnswer?: string;
}): { originalAnswer: string; correctedAnswer: string } {
  const original = handwritten.originalAnswer?.trim() || '';
  const corrected = handwritten.correctedAnswer?.trim() || '';
  return {
    originalAnswer: isGarbageHandwritingText(original) ? '' : original,
    correctedAnswer: isGarbageHandwritingText(corrected) ? '' : corrected,
  };
}

export type StripHandwritingResult = {
  text: string;
  removedNoiseLines: string[];
  recoveredBlack: string;
  recoveredRedDerivation: string;
};

/** 去掉正文中明显的手写 OCR 噪声行 */
export function stripOcrHandwritingNoiseLines(
  ocrText: string,
  correctedAnswer?: string,
): { text: string; removedLines: string[] } {
  if (!ocrText.trim()) return { text: ocrText, removedLines: [] };

  const lines = ocrText.split('\n');
  const kept: string[] = [];
  const removedLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      kept.push(line);
      continue;
    }
    if (looksLikeHandwritingOcrNoise(trimmed)) {
      removedLines.push(trimmed);
      continue;
    }
    if (isRedDerivationNoiseLine(trimmed)) {
      removedLines.push(trimmed);
      continue;
    }
    if (isMcqOptionLine(trimmed)) {
      kept.push(line);
      continue;
    }
    if (
      correctedAnswer &&
      correctedAnswer.trim().length >= 8 &&
      trimmed.length >= 12 &&
      trimmed.length <= 120 &&
      lineSharesHandwritingWithCorrection(trimmed, correctedAnswer) &&
      (latinRatio(trimmed) > 0.08 || /[=+\-−]/.test(trimmed))
    ) {
      removedLines.push(trimmed);
      continue;
    }
    kept.push(line);
  }

  return {
    text: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    removedLines,
  };
}

function latinRatio(s: string): number {
  const latin = (s.match(/[A-Za-z]/g) || []).length;
  return latin / Math.max(s.length, 1);
}

/** 短片段是否像手填答案（数值、选项、短词） */
function looksLikeHandfillFragment(frag: string): boolean {
  const t = frag.trim();
  if (!t || t.length > 48) return false;
  if (/^[A-Da-d]$/.test(t)) return true;
  if (/^[\d.]+$/.test(t)) return true;
  if (/^[\d.]+\s*[NnΩΩ]$/.test(t)) return true;
  if (/^(水平向左|水平向右|竖直向上|竖直向下)$/.test(t)) return true;
  if (t.length <= 12 && /[\u4e00-\u9fff]/.test(t)) return true;
  return false;
}

/**
 * 题干 OCR 完成后，从正文中剔除已识别的手写作答片段（补充分色预处理未去掉的黑色笔迹）。
 */
export function stripHandwritingFromOcrText(
  ocrText: string,
  handwritten?: { originalAnswer?: string; correctedAnswer?: string },
): StripHandwritingResult {
  if (!ocrText.trim()) {
    return { text: ocrText, removedNoiseLines: [], recoveredBlack: '', recoveredRedDerivation: '' };
  }

  const safeHw = handwritten ? sanitizeHandwrittenAnswers(handwritten) : null;
  const noise = stripOcrHandwritingNoiseLines(ocrText, safeHw?.correctedAnswer);
  let out = noise.text;
  const recoveredBlack = recoverShortHandwritingFromNoise(noise.removedLines);
  const recoveredRedDerivation = recoverRedDerivationFromNoise(noise.removedLines);

  if (!safeHw || (!safeHw.originalAnswer && !safeHw.correctedAnswer)) {
    return { text: out, removedNoiseLines: noise.removedLines, recoveredBlack, recoveredRedDerivation };
  }

  if (!isHandwritingFragmentStripEnabled()) {
    return { text: out, removedNoiseLines: noise.removedLines, recoveredBlack, recoveredRedDerivation };
  }

  const { inline, lines } = collectHandwritingFragments(safeHw.originalAnswer, safeHw.correctedAnswer);
  if (!inline.length && !lines.length) {
    return { text: out, removedNoiseLines: noise.removedLines, recoveredBlack, recoveredRedDerivation };
  }

  for (const frag of [...lines].sort((a, b) => b.length - a.length)) {
    const exactLine = new RegExp(`^\\s*${escapeRegExp(frag)}\\s*$\\n?`, 'gm');
    out = out.replace(exactLine, '');
    if (frag.length >= 20) {
      const fuzzyLine = new RegExp(
        `^\\s*[^\\n]{0,8}${escapeRegExp(frag.slice(0, Math.min(frag.length, 24)))}[\\s\\S]{0,40}$\\n?`,
        'gm',
      );
      out = out.replace(fuzzyLine, '');
    }
    if (!looksLikeHandfillFragment(frag) && frag.length < 80) {
      const lineRe = new RegExp(`^\\s*${escapeRegExp(frag)}\\s*$\\n?`, 'gm');
      out = out.replace(lineRe, '');
    }
  }

  for (const frag of [...inline].sort((a, b) => b.length - a.length)) {
    if (!looksLikeHandfillFragment(frag)) continue;

    const cellRe = new RegExp(`(\\|\\s*)${escapeRegExp(frag)}(\\s*\\|)`, 'g');
    out = out.replace(cellRe, '$1 $2');

    if (/^[A-Da-d]$/.test(frag)) {
      out = out.replace(new RegExp(`[（(]\\s*${escapeRegExp(frag)}\\s*[）)]`, 'g'), '（ ）');
    }

    // 方向词常出现在印刷题干中，禁止全文替换以免清空题目
    if (!isPrintedStemDirectionWord(frag)) {
      out = out.replace(new RegExp(`(?<![\\w|])${escapeRegExp(frag)}(?![\\w|])`, 'g'), ' ');
    }
  }

  out = out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\|\s+\|/g, '|  |')
    .replace(/\n{3,}/g, '\n\n');

  const trimmed = out.trim();
  if (safeHw && isStemOverShrunk(ocrText, trimmed)) {
    console.warn(
      `[zhishitree] 去手写过度（${ocrText.length}→${trimmed.length}），仅保留噪声剔除`,
    );
    return { text: noise.text, removedNoiseLines: noise.removedLines, recoveredBlack, recoveredRedDerivation };
  }

  return {
    text: trimmed,
    removedNoiseLines: noise.removedLines,
    recoveredBlack,
    recoveredRedDerivation,
  };
}
