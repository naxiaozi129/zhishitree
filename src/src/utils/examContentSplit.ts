/** 将整段题干文本拆成「题目」与「答案/解析」两块（与 server/examContentSplit.ts 保持一致） */

export type QuestionAnswerBlocks = {
  question: string;
  answer: string | null;
};

const ANSWER_MARKERS: RegExp[] = [
  /(?:^|\n)\s*【(?:答案及解析|答案与解析|参考答案|答案|解析|详解|解答|知识点)】\s*/m,
  /(?:^|\n)\s*【(?:答\s*案)】\s*/m,
  /(?:^|\n)\s*(?:参考)?答案(?:及解析|与解析)?\s*[:：]\s*/m,
  /(?:^|\n)\s*(?:试题)?(?:答案)?解析\s*[:：]\s*/m,
  /(?:^|\n)\s*解答\s*[:：]\s*/m,
  /(?:^|\n)\s*【(?:评分|给分)标准】\s*/m,
];

const MIN_QUESTION_LEN = 12;

export function splitQuestionAndAnswer(raw: string): QuestionAnswerBlocks {
  const text = raw.replace(/\r\n/g, '\n').trim();
  if (!text) return { question: '', answer: null };

  let splitAt = -1;
  let markerLen = 0;

  for (const re of ANSWER_MARKERS) {
    const m = re.exec(text);
    if (!m || m.index < MIN_QUESTION_LEN) continue;
    if (splitAt < 0 || m.index < splitAt) {
      splitAt = m.index;
      markerLen = m[0].length;
    }
  }

  if (splitAt < 0) return { question: text, answer: null };

  const question = text.slice(0, splitAt).trim();
  const answer = text.slice(splitAt + markerLen).trim();
  if (!question || !answer) return { question: text, answer: null };

  return { question, answer };
}

export function getQuestionAnswerFromRow(stem: string, body?: Record<string, unknown>): QuestionAnswerBlocks {
  const stored = typeof body?.answerText === 'string' ? body.answerText.trim() : '';
  if (stored) return { question: stem.trim(), answer: stored };
  return splitQuestionAndAnswer(stem);
}
