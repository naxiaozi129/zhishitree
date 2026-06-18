/** 试卷正文展示用排版（与导入/拆题后的文本结构一致） */

const OPTION_LINE = /^[A-DＡ-Ｄa-d][\.．、)）]\s*/;
const SUBQ_LINE = /^[（(]\s*[1-9]\d{0,1}\s*[）)]\s*/;
const QNO_LINE = /^[1-9]\d{0,2}[\.．、]\s*/;

export function formatExamDisplayText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\u3000/g, '  ')
    .replace(/([^\n])([A-DＡ-Ｄa-d][\.．、)）]\s*)/g, '$1\n$2')
    .replace(/([^\n])([（(]\s*[1-9]\d{0,1}\s*[）)])/g, '$1\n$2')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export type ExamLineKind = 'default' | 'option' | 'subq' | 'qno';

export function classifyExamLine(line: string): ExamLineKind {
  const t = line.trim();
  if (!t) return 'default';
  if (OPTION_LINE.test(t)) return 'option';
  if (SUBQ_LINE.test(t)) return 'subq';
  if (QNO_LINE.test(t) && t.length < 80) return 'qno';
  return 'default';
}

export const IMAGE_INLINE_RE =
  /(\{\{image:[a-zA-Z0-9_-]+\}\}|!\[[^\]]*\]\(data:[^)]+\))/g;

export function splitExamContentSegments(content: string): string[] {
  return content.split(IMAGE_INLINE_RE).filter((s) => s.length > 0);
}
