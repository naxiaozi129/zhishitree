/** 选择题题干与选项排版（前后端共用） */

const OPTION_PREFIX =
  /^(?:[A-HＡ-Ｈa-h][.．)）]\s*|[（(]\s*[A-HＡ-Ｈa-h]\s*[）)])/;

/** 选项行首模式（用于 classify，不含顿号「、」以免误判 A、B 并列标注） */
export const MCQ_OPTION_LINE =
  /^[A-HＡ-Ｈa-h][.．)）]\s*|^[（(]\s*[A-HＡ-Ｈa-h]\s*[）)]\s*/;

/** 题干内并列标注：A、B两测力计 / 图甲、乙 — 非选择题选项 */
const STEM_LABEL_ENUM = /^[A-HＡ-Ｈa-h]、[A-HＡ-Ｈa-h]/;

/** 判断一行是否为选择题选项（非题干） */
export function isMcqOptionLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (STEM_LABEL_ENUM.test(t)) return false;
  if (/[分别是|分别为|示数|读数].*（\s*）\s*$/.test(t)) return false;
  if (/（\s*）\s*$/.test(t) && t.length > 12 && !/^[A-HＡ-Ｈa-h][.．]/.test(t)) return false;
  if (OPTION_PREFIX.test(t)) return true;
  if (/^[A-HＡ-Ｈa-h]、/.test(t)) {
    const after = t.slice(2, 12);
    return /^[0-9.]+\s*[Nn牛]/.test(after) || /^[0-9.]+\s*[Nn牛]/.test(t);
  }
  return false;
}

/** 是否含 Markdown 表格（选用 GFM 渲染） */
export function ocrTextHasMarkdownTable(text: string): boolean {
  return /\|[^|\n]+\|/.test(text);
}

/** A、后紧跟另一字母（A、B…）时为题干标注，不在此处分行 */
function isLetterEnumerationAt(str: string, letterEndIdx: number): boolean {
  const rest = str.slice(letterEndIdx);
  return /^、[A-HＡ-Ｈa-h]/.test(rest);
}

/**
 * 将挤在一行的选择题选项拆成逐行，并在题干与选项、选项与选项之间插入空行（便于 Markdown 分段显示）。
 */
export function formatMcqOptionsPerLine(raw: string): string {
  let s = raw.replace(/\r\n/g, '\n').replace(/\u3000/g, '  ');
  if (!s.trim()) return s;

  // 无空格紧挨：A.xxxB.yyy（顿号连接的 A、B 标注除外）
  s = s.replace(/([A-Ha-hＡ-Ｈ][.．][^\n]*?)(?=[A-Ha-hＡ-Ｈ][.．])/g, '$1\n');
  // 题干后接选项：...正确的是A.xxx（跳过 A、B 类并列标注；不用「字母+）」以免误伤 kg）（ ））
  s = s.replace(
    /([^\n\d])([A-HＡ-Ｈa-h])([.．、])(\s*)/g,
    (full, before, letter, punct, spaces, offset, str) => {
      const letterEnd = offset + before.length + letter.length;
      if (punct === '、' && isLetterEnumerationAt(str, letterEnd)) {
        return full;
      }
      return `${before}\n${letter}${punct}${spaces}`;
    },
  );
  // 空格分隔的下一选项：... xxx B. yyy
  s = s.replace(/([^\n])\s+([A-HＡ-Ｈa-h][.．]\s)/g, '$1\n$2');
  // (A) (B) 分行
  s = s.replace(/([^\n])\s*([（(]\s*[A-HＡ-Ｈa-h]\s*[）)])/g, '$1\n$2');
  // 小问 (1) (2) 分行
  s = s.replace(/([^\n])([（(]\s*[1-9]\d{0,1}\s*[）)])/g, '$1\n$2');

  return addMcqParagraphSpacing(s).replace(/\n{3,}/g, '\n\n').trimEnd();
}

/** 在题干与首个选项、以及各选项之间插入空行（Markdown 需双换行才分段） */
function addMcqParagraphSpacing(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const isOption = isMcqOptionLine(trimmed);
    const prevTrimmed = out.length > 0 ? out[out.length - 1].trim() : '';
    const prevIsOption = prevTrimmed.length > 0 && isMcqOptionLine(prevTrimmed);

    if (isOption) {
      if (prevTrimmed && !prevIsOption) {
        out.push('');
      } else if (prevIsOption) {
        out.push('');
      }
    }

    out.push(line);
  }

  return out.join('\n');
}
