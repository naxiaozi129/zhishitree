/**
 * exam-paper-recognition skill — 运行时错题/试卷图识别入口
 * Cursor Skill 文档：.cursor/skills/exam-paper-recognition/SKILL.md
 */

import { formatMcqOptionsPerLine } from '../shared/formatMcq.js';
import { stripExamBoilerplate } from './examBoilerplate.js';
import { splitQuestionAndAnswer } from './examContentSplit.js';
import { postprocessMineruMarkdown } from './examFigureExtract.js';
import { isMineruOcrEnabled, parseImageWithMineru } from './mineruOcr.js';
import { getEffectiveMineruConfig, resolveMineruBackend } from './mineruSettings.js';
import type { QuestionFigure } from './questionImageAnalyze.js';

export const EXAM_PAPER_RECOGNITION_SKILL_ID = 'exam-paper-recognition';
export const EXAM_PAPER_RECOGNITION_SKILL_VERSION = '1';

export type ExamPaperOcrMeta = {
  pipeline: typeof EXAM_PAPER_RECOGNITION_SKILL_ID;
  skillVersion: string;
  source: 'mineru' | 'vision' | 'pdf-text';
  mineruBackend?: string;
};

export type ExamPaperRecognitionText = {
  fullText: string;
  question: string;
  answer: string | null;
};

export type ExamPaperImageRecognitionResult = {
  text: string;
  question: string;
  answer: string | null;
  figures?: QuestionFigure[];
  meta: ExamPaperOcrMeta;
};

function stripBase64Prefix(raw: string): string {
  return raw.replace(/^data:[^;]+;base64,/, '').trim();
}

/** 对 OCR 原文应用试卷识别排版：去卷头、选项分行、题答分离 */
export function applyExamPaperRecognitionPipeline(raw: string): ExamPaperRecognitionText {
  const normalized = raw.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return { fullText: '', question: '', answer: null };
  }

  const stripped = stripExamBoilerplate(normalized);
  const fullText = formatMcqOptionsPerLine(stripped);
  const { question, answer } = splitQuestionAndAnswer(fullText);

  return {
    fullText,
    question: question || fullText,
    answer,
  };
}

/**
 * exam-paper-recognition 主入口：MinerU VLM OCR + 表格/配图 + 试卷排版
 * 失败时返回 null，由上层决定是否回退视觉大模型
 */
export async function recognizeExamPaperImage(
  base64: string,
  mimeType: string,
): Promise<ExamPaperImageRecognitionResult> {
  if (!isMineruOcrEnabled()) {
    throw new Error(
      `${EXAM_PAPER_RECOGNITION_SKILL_ID}：MinerU OCR 未启用。请在 .env.local 设置 MINERU_API_URL 并启动 mineru-api`,
    );
  }

  const mineru = await parseImageWithMineru(base64, mimeType);
  const cfg = getEffectiveMineruConfig();
  const backend = resolveMineruBackend(cfg.backend);
  const rawData = stripBase64Prefix(base64);

  const processed = postprocessMineruMarkdown({
    markdown: mineru.markdown,
    parsedImages: mineru.images,
    fallbackCircuit: rawData ? { mime: mimeType || 'image/jpeg', data: rawData } : undefined,
  });

  const piped = applyExamPaperRecognitionPipeline(processed.markdown);

  console.log(
    `[zhishitree] [${EXAM_PAPER_RECOGNITION_SKILL_ID}] MinerU 识别完成 backend=${backend} 正文=${piped.fullText.length}字 配图=${processed.figures?.length ?? 0}`,
  );

  return {
    text: piped.fullText,
    question: piped.question,
    answer: piped.answer,
    figures: processed.figures,
    meta: {
      pipeline: EXAM_PAPER_RECOGNITION_SKILL_ID,
      skillVersion: EXAM_PAPER_RECOGNITION_SKILL_VERSION,
      source: 'mineru',
      mineruBackend: backend,
    },
  };
}

export function examPaperOcrMetaForVisionFallback(): ExamPaperOcrMeta {
  return {
    pipeline: EXAM_PAPER_RECOGNITION_SKILL_ID,
    skillVersion: EXAM_PAPER_RECOGNITION_SKILL_VERSION,
    source: 'vision',
  };
}
