import type { ResolvedAiConfig } from './aiModelConfig.js';
import { generateLlmText } from './llmGenerate.js';

export type ReflectionAnalyzeResult = {
  blindSpots: string[];
  teacherComment: string;
  followUpQuestions: string[];
  similarQuestions: { stem: string; testingFocus: string }[];
};

export type ReflectionAssessResult = {
  masteryLevel: string;
  summaryFeedback: string;
  followUpFeedback: { index: number; comment: string; onTrack: boolean }[];
  similarFeedback: { index: number; comment: string; demonstratesUnderstanding: boolean }[];
};

type AiCallConfig = Pick<ResolvedAiConfig, 'apiKey' | 'modelId' | 'provider' | 'baseUrl'>;

function buildCfg(apiKey: string, modelId?: string, aiConfig?: Partial<ResolvedAiConfig>): AiCallConfig {
  return {
    apiKey,
    modelId:
      modelId ||
      aiConfig?.modelId ||
      (aiConfig?.provider === 'zhipu' ? 'glm-4-flash' : process.env.GEMINI_REFLECTION_MODEL || 'gemini-2.0-flash'),
    provider: aiConfig?.provider || 'gemini',
    baseUrl: aiConfig?.baseUrl ?? null,
  };
}

function compactAnalysisForPrompt(analysis: Record<string, unknown>): Record<string, unknown> {
  const raw = typeof analysis.rawOcrText === 'string' ? analysis.rawOcrText : '';
  return {
    summary: analysis.summary,
    knowledgePoints: analysis.knowledgePoints,
    pitfalls: analysis.pitfalls,
    specificMistake: analysis.specificMistake,
    rawOcrText: raw.length > 3500 ? `${raw.slice(0, 3500)}…` : raw,
  };
}

function parseJsonResponse<T>(text: string): T {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch ? jsonMatch[0] : text) as T;
}

export async function analyzeStudentReflection(
  apiKey: string,
  params: {
    analysis: Record<string, unknown>;
    reflectionText: string;
    scienceContext: string;
  },
  modelId?: string,
  aiConfig?: Partial<ResolvedAiConfig>,
): Promise<ReflectionAnalyzeResult> {
  const cfg = buildCfg(apiKey, modelId, aiConfig);
  const payload = compactAnalysisForPrompt(params.analysis);
  const prompt = `你是经验丰富的中学教研员。根据题目侧的 AI 解析要点、（若有）课纲知识点命中，以及学生自述「为什么选错、当时怎么想的」，完成下列任务。全程使用简体中文。

【题目侧解析摘要】
${JSON.stringify(payload, null, 0)}

【与本校初中科学知识树相关的命中节点（可为空）】
${params.scienceContext.trim() || '（无）'}

【学生自述】
${params.reflectionText}

请**只输出一个 JSON 对象**（不要 markdown 代码块），键如下：
- blindSpots：3～6 条字符串数组，指出学生表述中暴露的可能知识盲区或思维误区（要具体，避免空话）。
- teacherComment：1 段话字符串，肯定合理之处并温和指出问题，80～200 字。
- followUpQuestions：3～5 个口语化追问句字符串数组，用于探测是否真正理解考点（不要重复题干原文）。
- similarQuestions：2～3 个对象的数组，每道含 stem（完整题干，可含选项）与 testingFocus（本题考查点一句话）。难度接近原题，不得照抄 OCR 原句。`;

  const out = await generateLlmText(cfg, prompt, { maxTokens: 4096, temperature: 0.6 });
  return parseJsonResponse<ReflectionAnalyzeResult>(out);
}

export async function assessReflectionAnswers(
  apiKey: string,
  params: {
    analyzeResult: ReflectionAnalyzeResult;
    reflectionText: string;
    followUpAnswers: string[];
    similarAnswers: string[];
    analysisSummary: string;
  },
  modelId?: string,
  aiConfig?: Partial<ResolvedAiConfig>,
): Promise<ReflectionAssessResult> {
  const cfg = buildCfg(apiKey, modelId, aiConfig);
  const prompt = `你是中学教研员。根据先前生成的盲区归纳、追问与相似题，阅读学生的文字作答，评估其对知识点的真实理解程度。使用简体中文，客观、鼓励。

【题目摘要】${params.analysisSummary}

【学生第一步自述】${params.reflectionText}

【先前归纳的盲区】${JSON.stringify(params.analyzeResult.blindSpots)}

【追问列表】${JSON.stringify(params.analyzeResult.followUpQuestions)}
【学生对追问的回答（按顺序）】${JSON.stringify(params.followUpAnswers)}

【相似题题干列表】${JSON.stringify(params.analyzeResult.similarQuestions.map((q) => q.stem))}
【学生对相似题的作答（按顺序）】${JSON.stringify(params.similarAnswers)}

请**只输出一个 JSON 对象**（不要 markdown 代码块），键如下：
- masteryLevel：三者之一字符串——「薄弱」「尚可」「较好」（依据作答总体判断）。
- summaryFeedback：一段总评字符串，120～280 字。
- followUpFeedback：与追问同序的对象数组，每项含 index（从 0 开始）、comment（具体反馈）、onTrack（boolean，是否答在点上）。
- similarFeedback：与相似题同序的对象数组，每项含 index、comment、demonstratesUnderstanding（boolean，是否体现迁移理解）。`;

  const out = await generateLlmText(cfg, prompt, { maxTokens: 4096, temperature: 0.5 });
  return parseJsonResponse<ReflectionAssessResult>(out);
}
