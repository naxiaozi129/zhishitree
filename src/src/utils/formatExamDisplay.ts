/** 试卷正文展示用排版（与导入/拆题后的文本结构一致） */

import { formatMcqOptionsPerLine, isMcqOptionLine } from '../../../shared/formatMcq.js';

const SUBQ_LINE = /^[（(]\s*[1-9]\d{0,1}\s*[）)]\s*/;
const QNO_LINE = /^[1-9]\d{0,2}[\.．、]\s*/;

export { formatMcqOptionsPerLine };

export function formatExamDisplayText(raw: string): string {
  return formatMcqOptionsPerLine(raw);
}

export type ExamLineKind = 'default' | 'option' | 'subq' | 'qno';

export function classifyExamLine(line: string): ExamLineKind {
  const t = line.trim();
  if (!t) return 'default';
  if (isMcqOptionLine(t)) return 'option';
  if (SUBQ_LINE.test(t)) return 'subq';
  if (QNO_LINE.test(t) && t.length < 80) return 'qno';
  return 'default';
}

export const IMAGE_INLINE_RE =
  /(\{\{image:[a-zA-Z0-9_-]+\}\}|!\[[^\]]*\]\([^)]+\))/g;

export function splitExamContentSegments(content: string): string[] {
  return content.split(IMAGE_INLINE_RE).filter((s) => s.length > 0);
}
