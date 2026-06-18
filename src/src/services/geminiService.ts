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
  sourceImage?: { mime: string; data: string };
  figures?: QuestionFigure[];
  circuitDescription?: string;
}

export interface KnowledgePointDetails {
  explanation: string;
  exampleQuestion: string;
  exampleSolution: string;
}

export function figureDataUri(fig: { mime: string; data: string }): string {
  const d = fig.data.replace(/^data:[^;]+;base64,/, '');
  return `data:${fig.mime || 'image/jpeg'};base64,${d}`;
}

export function resolveAnalysisImageUri(
  analysis: QuestionAnalysis | null,
  fallbackDataUrl?: string | null,
): string | null {
  if (fallbackDataUrl) return fallbackDataUrl;
  if (analysis?.sourceImage) return figureDataUri(analysis.sourceImage);
  if (analysis?.figures?.[0]) return figureDataUri(analysis.figures[0]);
  return null;
}

/** 电路图/配图 URI：优先 MinerU 裁剪的 fig-circuit */
export function resolveCircuitImageUri(
  analysis: QuestionAnalysis | null,
  fallbackDataUrl?: string | null,
): string | null {
  const circuit =
    analysis?.figures?.find((f) => f.id === 'fig-circuit') ??
    analysis?.figures?.find((f) => /电路/.test(f.label));
  if (circuit) return figureDataUri(circuit);
  return resolveAnalysisImageUri(analysis, fallbackDataUrl);
}

async function postAnalyze<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; analysis?: T; details?: T };
  if (!res.ok) {
    throw new Error(data.error || `请求失败（HTTP ${res.status}）`);
  }
  return (data.analysis ?? data.details) as T;
}

export async function analyzeQuestionImage(base64Image: string, mimeType: string): Promise<QuestionAnalysis> {
  return postAnalyze<QuestionAnalysis>('/api/analyze/question-image', {
    base64: base64Image,
    mimeType,
  });
}

export async function explainKnowledgePoint(point: string, contextSummary: string): Promise<KnowledgePointDetails> {
  return postAnalyze<KnowledgePointDetails>('/api/analyze/explain-knowledge-point', {
    point,
    contextSummary,
  });
}
