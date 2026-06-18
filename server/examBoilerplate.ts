/** 移除试卷卷头、注意事项等对题库无用的正文 */

function normalizeLines(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\u3000/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 注意事项条目：1 ．答卷前 / 2. 回答第Ⅰ卷 … */
function isNoticeNumberedLine(line: string): boolean {
  const s = line.trim();
  if (!/^\s*[1-9]\d?\s*[．.、]\s*/.test(s)) return false;
  return /(?:答卷|回答|考生|考试结束|本试卷|答题卡|2B|铅笔|橡皮|涂黑|写在本|交回|第[ⅠⅡIⅢ]|第\s*[12]\s*卷)/u.test(s);
}

/** 卷头标题、学科行、时长分值等 */
function isExamHeaderLine(line: string): boolean {
  const s = line.trim();
  if (!s) return true;
  if (s.length > 100) return false;
  if (/^注意事项\s*[:：]?\s*$/u.test(s)) return true;
  if (/(?:中考|模拟|样卷|预测|联考|统考|浙江卷|真题).{0,24}(?:试卷|考试)?/u.test(s) && s.length < 60) return true;
  if (/^科\s*[\u4e00-\u9fa5A-Za-z\s]{1,12}$/u.test(s)) return true;
  if (/^[（(].*(?:考试时间|考试时长|试卷满分|满\s*分).*[）)]\s*$/u.test(s)) return true;
  if (/^(?:考试时间|试卷满分|满分\s*[:：])/u.test(s)) return true;
  return false;
}

const SECTION_LINE =
  /^[一二三四五六七八九十百]+[、．.]\s*(?:选择题|填空题|解答题|综合题|实验探究题|简答题|非选择题|阅读题|计算题)/u;

/** 去掉「一、选择题」等板块标题行（不作为题目正文） */
export function stripSectionHeaderLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => !SECTION_LINE.test(line.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripNoticeBlock(text: string): string {
  const noticeHead = /(?:^|\n)\s*注意事项\s*[:：]?\s*\n/u.exec(text);
  if (!noticeHead) return text;

  const bodyStart = noticeHead.index + noticeHead[0].length;
  const rest = text.slice(bodyStart);
  const lines = rest.split('\n');
  let consume = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const s = raw.trim();
    if (!s) {
      consume += raw.length + 1;
      continue;
    }
    if (SECTION_LINE.test(s)) break;
    if (isNoticeNumberedLine(s)) {
      consume += raw.length + 1;
      continue;
    }
    if (/^\s*[1-9]\d?\s*[．.](?!\d)/u.test(s) && !isNoticeNumberedLine(s)) break;
    consume += raw.length + 1;
  }

  const before = text.slice(0, noticeHead.index).trimEnd();
  const after = rest.slice(consume).trimStart();
  return [before, after].filter(Boolean).join('\n\n').trim();
}

function stripPreambleBeforeBody(text: string): string {
  const sectionAt = text.search(/(?:^|\n)\s*[一二三四五六七八九十百]+[、．.]\s*(?:选择|填空|解答|综合|实验|简答|非选择|阅读|计算)/u);
  const questionAt = text.search(/(?:^|\n)\s*[1-9]\d?\s*[．.](?!\d)/u);
  let cut = -1;
  if (sectionAt >= 0 && questionAt >= 0) cut = Math.min(sectionAt, questionAt);
  else if (sectionAt >= 0) cut = sectionAt;
  else if (questionAt >= 0) cut = questionAt;
  if (cut <= 0) return text;
  const prefix = text.slice(0, cut).trim();
  if (!prefix || /注意事项|中考|模拟|浙江卷|^科\s/mu.test(prefix)) {
    const start = text[cut] === '\n' ? cut + 1 : cut;
    return text.slice(start).trim();
  }
  return text;
}

function stripFromFirstSection(text: string): string {
  return stripPreambleBeforeBody(text);
}

/** 无板块标题时，逐行去掉卷头行与注意事项条目 */
function stripLeadingHeaderLines(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let started = false;

  for (const line of lines) {
    const s = line.trim();
    if (!started) {
      if (!s) continue;
      if (/^注意事项\s*[:：]?\s*$/u.test(s)) continue;
      if (isExamHeaderLine(s) || isNoticeNumberedLine(s)) continue;
      started = true;
    } else if (isNoticeNumberedLine(s)) {
      continue;
    }
    out.push(line);
  }

  return out.join('\n').trim();
}

/**
 * 去掉标题、学科、时长、注意事项等，仅保留可入库试题正文。
 * 可在 docx 抽文本后与拆题前各调用一次。
 */
export function stripExamBoilerplate(raw: string): string {
  if (!raw.trim()) return '';

  let text = normalizeLines(raw);
  text = stripNoticeBlock(text);
  text = stripFromFirstSection(text);
  text = stripLeadingHeaderLines(text);

  return text.trim();
}
