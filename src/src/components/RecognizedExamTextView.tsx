import { ExamPaperView } from './ExamPaperView';
import { MarkdownRenderer } from './MarkdownRenderer';
import { splitQuestionAndAnswer } from '../utils/examContentSplit';
import { ocrTextHasMarkdownTable } from '../../../shared/formatMcq';

function ocrTextHasMarkdownImage(text: string): boolean {
  return /!\[[^\]]*\]\([^)]+\)/.test(text);
}

type Props = {
  markdown: string;
  className?: string;
};

/**
 * 错题 OCR 展示：exam-paper-recognition 流水线
 * - 有 Markdown 表格 → GFM
 * - 否则 → 试卷式排版（题干 / 选项分行）
 */
export function RecognizedExamTextView({ markdown, className }: Props) {
  const trimmed = markdown.trim();
  if (!trimmed) return null;

  if (ocrTextHasMarkdownTable(trimmed) || ocrTextHasMarkdownImage(trimmed)) {
    return (
      <MarkdownRenderer
        content={trimmed}
        density="normal"
        highlightMcqOptions
        className={className}
      />
    );
  }

  const { question, answer } = splitQuestionAndAnswer(trimmed);
  return (
    <ExamPaperView
      question={question}
      answer={answer}
      className={`exam-paper-sheet--embedded ${className ?? ''}`}
    />
  );
}
