export interface KnowledgeNode {
  node: string;
  children: any[];
}

export type QuestionFigure = {
  id: string;
  label: string;
  mime: string;
  data: string;
  note?: string;
};

export interface QuestionAnalysis {
  rawOcrText: string;
  knowledgePoints: string[];
  pitfalls: string[];
  knowledgeTree: KnowledgeNode[];
  summary: string;
  specificMistake: string;
  /** 黑色笔迹：学生原始作答 */
  originalAnswer?: string;
  /** 红色笔迹：批改后的正确答案 */
  correctedAnswer?: string;
  sourceImage?: { mime: string; data: string };
  figures?: QuestionFigure[];
  circuitDescription?: string;
  ocrMeta?: {
    pipeline: string;
    skillVersion?: string;
    source: 'mineru' | 'vision';
    mineruBackend?: string;
  };
}

export interface KnowledgePointDetails {
  explanation: string;
  exampleQuestion: string;
  exampleSolution: string;
}

export function isPdfMime(mime?: string | null): boolean {
  return (mime || '').toLowerCase().includes('pdf');
}

export function figureDataUri(fig: { mime: string; data: string }): string {
  const d = fig.data.replace(/^data:[^;]+;base64,/, '').trim();
  return `data:${fig.mime || 'image/jpeg'};base64,${d}`;
}

/** base64 正文有效（避免空 data 导致裂图） */
export function isValidFigureData(data: string | undefined | null): boolean {
  if (!data) return false;
  const d = data.replace(/^data:[^;]+;base64,/, '').trim();
  return d.length >= 64;
}

export function figureDataUriIfValid(fig: { mime: string; data: string }): string | null {
  return isValidFigureData(fig.data) ? figureDataUri(fig) : null;
}

export function resolveAnalysisImageUri(
  analysis: QuestionAnalysis | null,
  fallbackDataUrl?: string | null,
): string | null {
  if (analysis?.sourceImage) {
    const uri = figureDataUriIfValid(analysis.sourceImage);
    if (uri) return uri;
    if (isPdfMime(analysis.sourceImage.mime) && isValidFigureData(analysis.sourceImage.data)) {
      return figureDataUri(analysis.sourceImage);
    }
  }
  for (const fig of analysis?.figures ?? []) {
    const uri = figureDataUriIfValid(fig);
    if (uri) return uri;
  }
  if (fallbackDataUrl) return fallbackDataUrl;
  return null;
}

/** 电路图 URI：优先有效裁剪图，否则用上传原图 */
export function resolveCircuitImageUri(
  analysis: QuestionAnalysis | null,
  fallbackDataUrl?: string | null,
): string | null {
  const circuit =
    analysis?.figures?.find((f) => f.id === 'fig-circuit') ??
    analysis?.figures?.find((f) => /电路/.test(f.label));
  if (circuit) {
    const uri = figureDataUriIfValid(circuit);
    if (uri) return uri;
  }
  return resolveAnalysisImageUri(analysis, fallbackDataUrl);
}

async function postAnalyze<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    analysis?: T;
    details?: T;
    recognition?: T;
  };
  if (!res.ok) {
    throw new Error(data.error || `请求失败（HTTP ${res.status}）`);
  }
  return (data.analysis ?? data.details ?? data.recognition) as T;
}

export type OcrEngine = 'default' | 'exam-service';

export type QuestionRecognitionResult = {
  rawOcrText: string;
  originalAnswer?: string;
  correctedAnswer?: string;
  circuitDescription?: string;
  figures?: QuestionFigure[];
  ocrMeta?: QuestionAnalysis['ocrMeta'];
};

export async function recognizeQuestionImage(
  base64Image: string,
  mimeType: string,
  engine: OcrEngine = 'default',
): Promise<QuestionRecognitionResult> {
  return postAnalyze<QuestionRecognitionResult>('/api/analyze/recognize-question', {
    base64: base64Image,
    mimeType,
    engine,
  });
}

export async function analyzeRecognizedQuestion(
  ocrText: string,
  base64Image: string,
  mimeType: string,
  recognition: QuestionRecognitionResult,
): Promise<QuestionAnalysis> {
  return postAnalyze<QuestionAnalysis>('/api/analyze/analyze-recognized', {
    ocrText,
    base64: base64Image,
    mimeType,
    originalAnswer: recognition.originalAnswer,
    correctedAnswer: recognition.correctedAnswer,
    circuitDescription: recognition.circuitDescription,
    figures: recognition.figures,
    ocrMeta: recognition.ocrMeta,
  });
}

export async function analyzeQuestionImage(
  base64Image: string,
  mimeType: string,
  engine: OcrEngine = 'default',
): Promise<QuestionAnalysis> {
  return postAnalyze<QuestionAnalysis>('/api/analyze/question-image', {
    base64: base64Image,
    mimeType,
    engine,
  });
}

export type ExamServiceHealth = {
  enabled: boolean;
  ok: boolean;
  message: string;
  detail?: string;
};

export async function fetchExamServiceHealth(): Promise<ExamServiceHealth> {
  const parsePayload = (data: Partial<ExamServiceHealth> & { examRecognition?: ExamServiceHealth }): ExamServiceHealth => {
    const er = data.examRecognition ?? data;
    return {
      enabled: Boolean(er.enabled),
      ok: Boolean(er.ok),
      message: er.message || '',
      detail: er.detail,
    };
  };

  try {
    const res = await fetch('/api/analyze/exam-service/health', { credentials: 'include' });
    if (res.status === 404) {
      const fallback = await fetch('/api/health', { credentials: 'include' });
      const data = (await fallback.json().catch(() => ({}))) as {
        examRecognition?: ExamServiceHealth;
      };
      if (data.examRecognition) return parsePayload(data);
      return {
        enabled: false,
        ok: false,
        message: '后端未更新，请重启 npm run start 或 dev:all 后再试',
      };
    }
    const data = (await res.json().catch(() => ({}))) as Partial<ExamServiceHealth>;
    return {
      enabled: Boolean(data.enabled),
      ok: Boolean(data.ok),
      message: data.message || (res.ok ? '' : `检测失败（HTTP ${res.status}）`),
      detail: data.detail,
    };
  } catch {
    return { enabled: false, ok: false, message: '无法检测识别服务状态' };
  }
}

export async function explainKnowledgePoint(point: string, contextSummary: string): Promise<KnowledgePointDetails> {
  return postAnalyze<KnowledgePointDetails>('/api/analyze/explain-knowledge-point', {
    point,
    contextSummary,
  });
}
