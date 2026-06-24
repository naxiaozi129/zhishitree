/** 题目摘要分条：核心信息 / 作答要求 / 审题要诀 等 */
export type SummaryPoint = {
  label?: string;
  text: string;
  subItems?: string[];
};

export type SummarySection = {
  label: string;
  items: string[];
};

const SUMMARY_LABELS = ['核心信息', '作答要求', '审题要诀', '已知条件', '设问指向'] as const;
type SummaryLabel = (typeof SUMMARY_LABELS)[number];

const INLINE_LABEL_RE = /(核心信息|作答要求|审题要诀|已知条件|设问指向)[：:]/gu;

const SECTION_STYLES: Record<
  string,
  { badge: string; border: string; bg: string; itemBg: string; accent: string }
> = {
  核心信息: {
    badge: 'bg-indigo-600 text-white',
    border: 'border-l-indigo-500',
    bg: 'bg-indigo-50/50',
    itemBg: 'bg-white/80 border-indigo-100',
    accent: 'text-indigo-700',
  },
  已知条件: {
    badge: 'bg-indigo-600 text-white',
    border: 'border-l-indigo-500',
    bg: 'bg-indigo-50/50',
    itemBg: 'bg-white/80 border-indigo-100',
    accent: 'text-indigo-700',
  },
  作答要求: {
    badge: 'bg-violet-600 text-white',
    border: 'border-l-violet-500',
    bg: 'bg-violet-50/45',
    itemBg: 'bg-white/80 border-violet-100',
    accent: 'text-violet-800',
  },
  设问指向: {
    badge: 'bg-violet-600 text-white',
    border: 'border-l-violet-500',
    bg: 'bg-violet-50/45',
    itemBg: 'bg-white/80 border-violet-100',
    accent: 'text-violet-800',
  },
  审题要诀: {
    badge: 'bg-sky-600 text-white',
    border: 'border-l-sky-500',
    bg: 'bg-sky-50/50',
    itemBg: 'bg-white/80 border-sky-100',
    accent: 'text-sky-800',
  },
};

export function summarySectionStyle(label: string) {
  return (
    SECTION_STYLES[label] ?? {
      badge: 'bg-slate-600 text-white',
      border: 'border-l-slate-400',
      bg: 'bg-slate-50/50',
      itemBg: 'bg-white/80 border-slate-100',
      accent: 'text-slate-700',
    }
  );
}

function cleanBulletPrefix(s: string): string {
  return s
    .replace(/^(\d{1,2}|[一二三四五六七八九十]{1,3})[、.．]\s*/u, '')
    .replace(/^\d+\.\s*/, '')
    .replace(/^[•\-*]\s*/, '')
    .replace(/[；;。]+\s*$/u, '')
    .trim();
}

/** 将「1. …；2. …」或「1. … 2. …」拆成多条 */
function splitNumberedItems(body: string): string[] {
  const t = body.trim();
  if (!t) return [];

  const byLookahead = t
    .split(/(?=(?:\d{1,2}|[一二三四五六七八九十])[、.．]\s*)/u)
    .map((s) => cleanBulletPrefix(s.trim()))
    .filter((s) => s.length > 1);

  if (byLookahead.length > 1) return byLookahead;

  const bySemi = t
    .split(/[；;]\s*(?=(?:\d{1,2}|[一二三四五六七八九十])[、.．]\s*|\d{1,2}\.\s*)/u)
    .map((s) => cleanBulletPrefix(s.trim()))
    .filter((s) => s.length > 1);

  if (bySemi.length > 1) return bySemi;

  return [cleanBulletPrefix(t)];
}

function splitDenseClause(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  const bySemi = t.split(/[；;]\s+/u).map((s) => s.trim()).filter((s) => s.length > 1);
  if (bySemi.length > 1) {
    const allNumbered = bySemi.every((p) => /^(?:\d{1,2}|[一二三四五六七八九十])[、.．]/.test(p));
    if (allNumbered) return bySemi.map(cleanBulletPrefix);
  }
  return [t];
}

/** 按行内「作答要求：」等标签切段（支持同一行多个标签） */
function splitByInlineLabels(text: string): { label?: SummaryLabel; body: string }[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const markers: { label: SummaryLabel; start: number; contentStart: number }[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(INLINE_LABEL_RE.source, 'gu');
  while ((m = re.exec(trimmed)) !== null) {
    markers.push({
      label: m[1] as SummaryLabel,
      start: m.index,
      contentStart: m.index + m[0].length,
    });
  }

  if (markers.length === 0) {
    return [{ body: trimmed }];
  }

  const segments: { label?: SummaryLabel; body: string }[] = [];

  const prefix = trimmed.slice(0, markers[0].start).replace(/^[；;\s]+|[；;\s]+$/gu, '').trim();
  if (prefix) {
    segments.push({ label: '核心信息', body: prefix });
  }

  for (let i = 0; i < markers.length; i++) {
    const end = i + 1 < markers.length ? markers[i + 1].start : trimmed.length;
    const body = trimmed.slice(markers[i].contentStart, end).replace(/^[；;\s]+|[；;\s]+$/gu, '').trim();
    if (body) segments.push({ label: markers[i].label, body });
  }

  return segments;
}

function bodyToItems(label: string | undefined, body: string): string[] {
  const isTips = label === '审题要诀';
  if (isTips || /\d{1,2}[、.．]\s*.+[；;]\s*\d{1,2}[、.．]/u.test(body)) {
    const numbered = splitNumberedItems(body);
    if (numbered.length > 1) return numbered;
  }
  const dense = splitDenseClause(body);
  if (dense.length > 1) return dense.map(cleanBulletPrefix);
  return [cleanBulletPrefix(body)];
}

/**
 * 解析为分组区块（核心信息 / 作答要求 / 审题要诀），
 * 支持模型把多段写在同一行、审题要诀带 1.2.3. 编号的情况。
 */
export function parseSummarySections(summary: string): SummarySection[] {
  const raw = summary.trim();
  if (!raw) return [];

  const lines = raw.split(/\r?\n+/).map((s) => s.trim()).filter(Boolean);
  const sectionMap = new Map<string, string[]>();
  const sectionOrder: string[] = [];

  const pushItems = (label: string, items: string[]) => {
    const valid = items.map((x) => x.trim()).filter((x) => x.length > 0);
    if (!valid.length) return;
    if (!sectionMap.has(label)) {
      sectionMap.set(label, []);
      sectionOrder.push(label);
    }
    sectionMap.get(label)!.push(...valid);
  };

  for (const line of lines) {
    for (const seg of splitByInlineLabels(line)) {
      const label = seg.label ?? '要点';
      pushItems(label, bodyToItems(seg.label, seg.body));
    }
  }

  if (sectionOrder.length === 0) {
    pushItems('要点', bodyToItems(undefined, raw));
  }

  return sectionOrder.map((label) => ({
    label,
    items: sectionMap.get(label)!,
  }));
}

/** 扁平要点列表（兼容导出等场景） */
export function parseSummaryPoints(summary: string): SummaryPoint[] {
  return parseSummarySections(summary).flatMap((sec) =>
    sec.items.map((text, i) => ({
      label: sec.label,
      text,
      subItems: sec.items.length > 1 && sec.label === '审题要诀' ? undefined : undefined,
    })),
  );
}

export type ParsedMistakeDiagnosis = {
  answerComparison?: string;
  causes: string[];
};

function normalizeCauseLine(raw: string): string {
  let cause = raw.trim();
  const arrowParts = cause.split(/\s*(?:→|->|=>|—>)\s*/u);
  if (arrowParts.length >= 2) {
    cause = arrowParts.slice(1).join(' — ').trim();
  }
  cause = cause
    .replace(/^(错答表现|可能原因|错因|答错表现)[：:]\s*/iu, '')
    .replace(/^\*\*|\*\*$/g, '')
    .trim();
  return cause;
}

/** 从 specificMistake Markdown 提取作答对比与可能错因列表 */
export function parseMistakeCauses(specificMistake: string): ParsedMistakeDiagnosis {
  const text = specificMistake.trim();
  if (!text) return { causes: [] };

  let remainder = text;
  let answerComparison: string | undefined;

  const compPatterns = [
    /\*\*作答对比\*\*[：:]*\s*([\s\S]*?)(?=\n\s*[-*•]|\n\s*\*\*|$)/u,
    /作答对比[：:]\s*([^\n]+)/u,
  ];
  for (const re of compPatterns) {
    const m = remainder.match(re);
    if (m?.[1]?.trim()) {
      answerComparison = m[1].replace(/\s+/g, ' ').trim();
      remainder = remainder.replace(re, '').trim();
      break;
    }
  }

  const causes: string[] = [];
  for (const line of remainder.split(/\r?\n/)) {
    const bullet = line.match(/^\s*[-*•]\s+(.+)$/u);
    if (bullet?.[1]) {
      const cause = normalizeCauseLine(bullet[1]);
      if (cause && !/^作答对比/u.test(cause)) causes.push(cause);
    }
  }

  if (causes.length === 0) {
    const stripped = remainder
      .replace(/\*\*可能的原因\*\*[：:]?/gu, '')
      .replace(/可能的原因[：:]?/gu, '')
      .trim();
    for (const part of stripped.split(/\r?\n+/)) {
      const cause = normalizeCauseLine(part);
      if (cause.length > 4) causes.push(cause);
    }
  }

  return { answerComparison, causes };
}

export const SUMMARY_LABEL_STYLES: Record<string, string> = {
  核心信息: 'bg-indigo-600 text-white',
  已知条件: 'bg-indigo-600 text-white',
  作答要求: 'bg-violet-600 text-white',
  设问指向: 'bg-violet-600 text-white',
  审题要诀: 'bg-sky-600 text-white',
};
