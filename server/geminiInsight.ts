import type { ResolvedAiConfig } from './aiModelConfig.js';
import { generateLlmText } from './llmGenerate.js';

export async function generateKnowledgeInsight(
  apiKey: string,
  payload: {
    nodes: { label: string; count: number }[];
    edges: { source: string; target: string; weight: number }[];
    summaries: string[];
  },
  modelId?: string,
  aiConfig?: Partial<ResolvedAiConfig>,
): Promise<string> {
  const cfg: Pick<ResolvedAiConfig, 'apiKey' | 'modelId' | 'provider' | 'baseUrl'> = {
    apiKey,
    modelId:
      modelId ||
      aiConfig?.modelId ||
      (aiConfig?.provider === 'zhipu' ? 'glm-4-flash' : process.env.GEMINI_INSIGHT_MODEL || 'gemini-2.0-flash'),
    provider: aiConfig?.provider || 'gemini',
    baseUrl: aiConfig?.baseUrl ?? null,
  };

  const text = `你是教研助手。根据以下「错题知识点共现」数据，用简体中文输出一份归纳（Markdown）：
- 说明哪些知识点经常在同一道题里同时出现（共现越强越要一起复习）
- 建议 3～6 条可执行的复习顺序或关联记忆线索
- 语气专业、简洁，可用二级标题与列表

知识点出现次数（节选）：${JSON.stringify(payload.nodes.slice(0, 60))}
同一题内共现（weight 为共现次数）：${JSON.stringify(payload.edges.slice(0, 100))}
题目摘要（节选）：${payload.summaries.slice(0, 25).join('\n---\n')}`;

  return generateLlmText(cfg, text, { maxTokens: 4096, temperature: 0.7 });
}
