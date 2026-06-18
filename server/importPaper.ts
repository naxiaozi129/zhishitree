/** 试卷文本拆题：以每道大题题号（题干首行）为唯一分界，一题一块 */

import { stripExamBoilerplate, stripSectionHeaderLines } from './examBoilerplate.js';

export type SplitPaperItem = {
  title: string | null;
  stem: string;
  body: Record<string, unknown>;
};

const SECTION_LINE =
  /^[一二三四五六七八九十百]+[、．.]\s*(?:选择题|填空题|解答题|综合题|实验探究题|简答题|非选择题|阅读题|计算题)/u;

function normalizeNewlines(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\u3000/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 大题题号：1． / 1 ． / 1. 下列；不含小数 3.2 */
const Q_NUM_CORE = '[1-9]\\d?';
const Q_NUM_FW = `${Q_NUM_CORE}\\s*．(?!\\d)`;
const Q_NUM_HW = `${Q_NUM_CORE}\\s*[\\.、](?!\\d)`;

const MAIN_QUESTION_HEAD = new RegExp(
  `^\\s*(?:(?:${Q_NUM_FW})|(?:${Q_NUM_HW})\\s*|(?:第\\s*${Q_NUM_CORE}\\s*题\\s*[\\.、：:]?\\s*))`,
);

function ensureQuestionLineBreaks(text: string): string {
  return text
    .replace(/([^\n\r])([ \t]*)([1-9]\d?\s*．(?!\d))/g, '$1\n$3')
    .replace(
      /([^\n\r\d.])([ \t]*)([1-9]\d?\s*[、．](?!\d)(?=[（(【「]|[^\d\s）)]))/g,
      '$1\n$3',
    );
}

function isMainQuestionLine(line: string): boolean {
  return MAIN_QUESTION_HEAD.test(line.trim());
}

function extractTitleFromStem(stem: string): string | null {
  const firstLine = stem.split('\n')[0]?.trim() ?? '';
  if (!firstLine) return null;
  const m = firstLine.match(new RegExp(`^(?:\\s*)((?:第\\s*)?${Q_NUM_CORE}\\s*[．\\.、]?)`));
  return m?.[1]?.replace(/\s+/g, '') || firstLine.slice(0, 80) || null;
}

function prepareExamBody(text: string): string {
  return ensureQuestionLineBreaks(stripSectionHeaderLines(stripExamBoilerplate(text)));
}

/** 统计正文中独立大题题号行数 */
export function countQuestionMarkers(text: string): number {
  let n = 0;
  for (const line of prepareExamBody(text).split('\n')) {
    if (isMainQuestionLine(line)) n++;
  }
  return n;
}

/** 逐行扫描：每遇到新题号行开启一道题（板块标题不入题干） */
function splitAtQuestionBoundaries(text: string): SplitPaperItem[] {
  const lines = prepareExamBody(text).split('\n');
  const items: SplitPaperItem[] = [];

  let sectionLabel = '';
  let buf: string[] = [];

  const flush = () => {
    const stem = buf.join('\n').trim();
    buf = [];
    if (!stem || !isMainQuestionLine(stem.split('\n')[0] ?? '')) return;
    items.push({
      title: extractTitleFromStem(stem),
      stem,
      body: {
        splitMethod: 'heuristic',
        ...(sectionLabel ? { sectionLabel } : {}),
      },
    });
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (buf.length > 0) buf.push('');
      continue;
    }

    if (SECTION_LINE.test(trimmed)) {
      flush();
      sectionLabel = trimmed;
      continue;
    }

    if (isMainQuestionLine(trimmed)) {
      flush();
      buf.push(line);
      continue;
    }

    if (buf.length > 0) buf.push(line);
  }

  flush();
  return items;
}

/** 单个 stem 内若含多道题号，拆成多道 */
function splitStemIntoQuestions(stem: string, body: Record<string, unknown>): SplitPaperItem[] {
  const lines = stem.split('\n');
  const parts: string[] = [];
  let buf: string[] = [];

  const flush = () => {
    const s = buf.join('\n').trim();
    buf = [];
    if (s && isMainQuestionLine(s.split('\n')[0] ?? '')) parts.push(s);
  };

  for (const line of lines) {
    if (isMainQuestionLine(line.trim())) {
      flush();
      buf.push(line);
    } else if (buf.length > 0) {
      buf.push(line);
    }
  }
  flush();

  if (parts.length <= 1) return [];

  return parts.map((s) => ({
    title: extractTitleFromStem(s),
    stem: s,
    body: { ...body, splitFromMerged: true, splitMethod: body.splitMethod ?? 'heuristic' },
  }));
}

export function explodeMultiQuestionStems(items: SplitPaperItem[]): SplitPaperItem[] {
  const out: SplitPaperItem[] = [];
  for (const item of items) {
    const exploded = splitStemIntoQuestions(item.stem, item.body);
    out.push(...(exploded.length > 0 ? exploded : [item]));
  }
  return out;
}

/**
 * 防止整段「选择题/填空题」被合成一题。
 * 题号数量明显多于块数时，强制按题号重拆。
 */
export function refineQuestionSplit(fullText: string, items: SplitPaperItem[]): SplitPaperItem[] {
  const markers = countQuestionMarkers(fullText);
  let result = explodeMultiQuestionStems(items);

  if (markers >= 2 && result.length < Math.max(2, Math.floor(markers * 0.55))) {
    const byLine = splitAtQuestionBoundaries(fullText);
    if (byLine.length > result.length) result = byLine;
  }

  return result.map((it, i) => ({
    ...it,
    body: { ...it.body, splitIndex: i },
  }));
}

export function splitExamPaperHeuristic(raw: string): SplitPaperItem[] {
  const normalized = normalizeNewlines(raw);
  if (!normalized) return [];

  const text = stripExamBoilerplate(normalized);
  let items = splitAtQuestionBoundaries(text);
  items = items.filter((x) => x.stem.length > 0);

  if (items.length === 0) {
    return [
      {
        title: null,
        stem: text || normalized,
        body: { splitMethod: 'heuristic', note: '未检测到题号，整段作为一题' },
      },
    ];
  }

  return refineQuestionSplit(text, items);
}

/** 启发式结果异常时建议改用 AI 拆题 */
export function heuristicSplitLooksBroken(items: SplitPaperItem[], raw: string): boolean {
  if (items.length === 0) return true;

  const markers = countQuestionMarkers(raw);
  if (markers >= 3 && items.length < Math.max(2, Math.floor(markers * 0.5))) return true;

  const len = raw.length;
  const avg = items.reduce((s, x) => s + x.stem.length, 0) / items.length;
  const tooManyShort = items.filter((x) => x.stem.length < 55).length;
  const noQuestionHead = items.filter((x) => !isMainQuestionLine(x.stem.split('\n')[0] ?? '')).length;

  if (len > 1500 && items.length === 1) return true;
  if (items.length >= 8 && avg < 100) return true;
  if (items.length >= 5 && tooManyShort / items.length > 0.45) return true;
  if (noQuestionHead > 0) return true;
  if (items.length >= 10 && avg < 150) return true;
  return false;
}
