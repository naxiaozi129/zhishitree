import type { ResolvedAiConfig } from './aiModelConfig.js';
import { generateLlmText } from './llmGenerate.js';

/** 单题 AI 考点归纳（供知识树标签与人工审核参考） */
export type QuestionExamAnalysis = {
  examPoints: string[];
  tagLabels: string[];
  brief?: string;
};

type AiCallConfig = Pick<ResolvedAiConfig, 'apiKey' | 'modelId' | 'provider' | 'baseUrl'>;

function buildCfg(
  apiKey: string,
  modelId: string | undefined,
  aiConfig?: Partial<ResolvedAiConfig>,
): AiCallConfig {
  return {
    apiKey,
    modelId:
      modelId ||
      aiConfig?.modelId ||
      (aiConfig?.provider === 'zhipu' ? 'glm-4-flash' : process.env.GEMINI_ANALYZE_MODEL || 'gemini-2.0-flash'),
    provider: aiConfig?.provider || 'gemini',
    baseUrl: aiConfig?.baseUrl ?? null,
  };
}

export async function analyzeQuestionExamPoints(
  apiKey: string,
  stem: string,
  subject: string | null,
  modelId?: string,
  aiConfig?: Partial<ResolvedAiConfig>,
): Promise<QuestionExamAnalysis> {
  const cfg = buildCfg(apiKey, modelId, aiConfig);
  const clipped = stem.length > 24_000 ? `${stem.slice(0, 24_000)}\n…（已截断）` : stem;
  const sub = subject?.trim() ? `学科背景：${subject.trim()}\n` : '';
  const prompt = `你是初中科学命题分析助手。阅读下方一道题的题干（可能含选项），输出考查要点与标签。
${sub}
要求：
1. examPoints：2～6 条，每条一句中文，写清「考什么能力/概念」（不要抄题干原文大段）。
2. tagLabels：3～10 个短词或短语，便于和知识点目录匹配（如「欧姆定律」「光合作用」「化学方程式配平」）。
3. brief：一句话概括本题命题意图（可空字符串）。
4. 不要编造题干中没有涉及的知识点。
5. **只输出一个 JSON 对象**，键为 examPoints（数组）、tagLabels（数组）、brief（字符串）。

题干：
---
${clipped}
---`;

  const text = await generateLlmText(cfg, prompt, { maxTokens: 2048, temperature: 0.3 });

  let parsed: unknown;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch {
    throw new Error('考点分析返回不是合法 JSON');
  }

  const obj = parsed as {
    examPoints?: unknown;
    tagLabels?: unknown;
    brief?: unknown;
  };
  const examPoints = Array.isArray(obj.examPoints)
    ? obj.examPoints.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 8)
    : [];
  const tagLabels = Array.isArray(obj.tagLabels)
    ? obj.tagLabels.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 12)
    : [];
  const brief = typeof obj.brief === 'string' ? obj.brief.trim().slice(0, 400) : '';

  if (examPoints.length === 0 && tagLabels.length === 0) {
    return {
      examPoints: ['（模型未给出细分考点，请人工补充）'],
      tagLabels: [],
      brief: brief || undefined,
    };
  }

  return {
    examPoints: examPoints.length ? examPoints : ['（请人工核对考点）'],
    tagLabels,
    brief: brief || undefined,
  };
}
