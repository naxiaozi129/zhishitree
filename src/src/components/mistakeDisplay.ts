import type {
  MistakeRow,
  ReflectionAnalyzeResponse,
  ReflectionAssessResponse,
} from '../services/api';
import {
  figureDataUri,
  isValidFigureData,
  resolveAnalysisImageUri,
  type QuestionAnalysis,
} from '../services/geminiService';

export function parseMistakeAnalysis(row: MistakeRow): QuestionAnalysis | null {
  try {
    return JSON.parse(row.analysis_json) as QuestionAnalysis;
  } catch {
    return null;
  }
}

/** 错题本列表：一句话考点总结 */
export function mistakeExamPointLine(row: MistakeRow, analysis: QuestionAnalysis | null): string {
  const kps = analysis?.knowledgePoints?.filter((x) => x?.trim());
  if (kps?.length) {
    const line = kps.slice(0, 3).join('、');
    return line.length > 96 ? `${line.slice(0, 93)}…` : line;
  }
  const summary = analysis?.summary?.trim();
  if (summary) return summary.length > 96 ? `${summary.slice(0, 93)}…` : summary;
  const preview = row.summary_preview?.trim();
  if (preview) return preview;
  return '（暂无考点摘要）';
}

export function mistakeImageUri(row: MistakeRow): string | null {
  const analysis = parseMistakeAnalysis(row);
  return resolveAnalysisImageUri(analysis);
}

export type MistakeReflectionSession = {
  reflectionText?: string;
  analyzeResult?: ReflectionAnalyzeResponse;
  followUpAnswers?: string[];
  similarAnswers?: string[];
  assessResult?: ReflectionAssessResponse;
  selectedCauseIndices?: number[];
  otherCause?: string;
};

export type RestoredMistakeSession = {
  mistakeId: number;
  analysis: QuestionAnalysis;
  image: string | null;
  mimeType: string;
  studentReflection: string;
  reflectionAnalyzeResult: ReflectionAnalyzeResponse | null;
  followUpAnswers: string[];
  similarAnswers: string[];
  reflectionAssessResult: ReflectionAssessResponse | null;
  selectedCauseIndices: number[];
  otherCause: string;
};

/** 从云端错题记录恢复错题录入页的完整状态（不重新调用分析 API） */
export function restoreMistakeSession(row: MistakeRow): RestoredMistakeSession | null {
  const analysis = parseMistakeAnalysis(row);
  if (!analysis) return null;

  let image: string | null = null;
  let mimeType = 'image/jpeg';
  if (analysis.sourceImage && isValidFigureData(analysis.sourceImage.data)) {
    image = figureDataUri(analysis.sourceImage);
    mimeType = analysis.sourceImage.mime || 'image/jpeg';
  } else {
    image = resolveAnalysisImageUri(analysis);
  }

  const session = (row.reflection_session ?? null) as MistakeReflectionSession | null;
  const studentReflection = session?.reflectionText?.trim() || row.reflection_text?.trim() || '';

  let reflectionAnalyzeResult: ReflectionAnalyzeResponse | null = null;
  let followUpAnswers: string[] = [];
  let similarAnswers: string[] = [];
  let reflectionAssessResult: ReflectionAssessResponse | null = null;

  if (session?.analyzeResult) {
    reflectionAnalyzeResult = session.analyzeResult;
    const fuLen = session.analyzeResult.followUpQuestions.length;
    const simLen = session.analyzeResult.similarQuestions.length;
    followUpAnswers = Array.from({ length: fuLen }, (_, i) => session.followUpAnswers?.[i] ?? '');
    similarAnswers = Array.from({ length: simLen }, (_, i) => session.similarAnswers?.[i] ?? '');
  } else if (session?.followUpAnswers?.length || session?.similarAnswers?.length) {
    followUpAnswers = session.followUpAnswers ?? [];
    similarAnswers = session.similarAnswers ?? [];
  }
  if (session?.assessResult) {
    reflectionAssessResult = session.assessResult;
  }

  const selectedCauseIndices = Array.isArray(session?.selectedCauseIndices)
    ? session.selectedCauseIndices.filter((n): n is number => Number.isInteger(n) && n >= 0)
    : [];
  const otherCause = typeof session?.otherCause === 'string' ? session.otherCause : '';

  return {
    mistakeId: row.id,
    analysis,
    image,
    mimeType,
    studentReflection,
    reflectionAnalyzeResult,
    followUpAnswers,
    similarAnswers,
    reflectionAssessResult,
    selectedCauseIndices,
    otherCause,
  };
}
