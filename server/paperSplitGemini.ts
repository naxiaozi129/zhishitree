import type { ResolvedAiConfig } from './aiModelConfig.js';
import { normalizeModelId } from './aiModelConfig.js';
import type { SplitPaperItem } from './importPaper.js';
import { stripSectionHeaderLines } from './examBoilerplate.js';
import { generateLlmText } from './llmGenerate.js';

export async function splitExamPaperGemini(
  apiKey: string,
  raw: string,
  modelId?: string,
  aiConfig?: Partial<ResolvedAiConfig>,
): Promise<SplitPaperItem[]> {
  const cfg: Pick<ResolvedAiConfig, 'apiKey' | 'modelId' | 'provider' | 'baseUrl'> = {
    apiKey,
    modelId:
      modelId ||
      aiConfig?.modelId ||
      (aiConfig?.provider === 'zhipu' ? 'glm-4-flash' : process.env.GEMINI_SPLIT_MODEL || 'gemini-2.0-flash'),
    provider: aiConfig?.provider || 'gemini',
    baseUrl: aiConfig?.baseUrl ?? null,
  };
  return splitExamPaperWithConfig(cfg, raw);
}

export async function splitExamPaperWithConfig(
  cfg: Pick<ResolvedAiConfig, 'apiKey' | 'modelId' | 'provider' | 'baseUrl'>,
  raw: string,
): Promise<SplitPaperItem[]> {
  const clipped = raw.length > 100_000 ? `${raw.slice(0, 100_000)}\n…（已截断）` : raw;
  const prompt = `你是试卷结构化助手。把下面整份试卷拆成若干道**完整**独立题目（大题）。
要求：
1. **每一道题以题号开头的题干为第一行**（如 1．、2．、第3题），一题一个 items 元素。
2. **严禁**把「一、选择题」下多道题合并为一个 stem，也严禁把整份选择题/填空题/解答题合成一块。
3. 每道题 stem 须含该题全部正文（选项、小问、表格等），不得截断。
4. 不要包含卷头、注意事项、「一、选择题」等板块标题行。
5. 一道大题下的小问 (1)(2) 须合并在同一 stem，不要把小问拆成多道题。
6. title 为题号短标签（如 "1．"），没有则 null。
7. 不要编造内容；保留换行，用 \\n 表示。
8. **只输出一个 JSON 对象**，键 items，元素 {"title": string|null, "stem": string}。试卷全文：
---
${clipped}
---`;

  const text = await generateLlmText(cfg, prompt, { maxTokens: 8192, temperature: 0.2 });
  const modelLabel = normalizeModelId(cfg.provider, cfg.modelId);

  let parsed: unknown;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch {
    throw new Error(`模型 ${modelLabel} 返回的不是合法 JSON`);
  }

  const obj = parsed as { items?: unknown };
  const items = Array.isArray(obj.items) ? obj.items : [];
  const out: SplitPaperItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it || typeof it !== 'object') continue;
    const stemRaw = typeof (it as { stem?: unknown }).stem === 'string' ? String((it as { stem: string }).stem).trim() : '';
    if (!stemRaw) continue;
    const stem = stripSectionHeaderLines(stemRaw);
    if (!stem) continue;
    const titleRaw = (it as { title?: unknown }).title;
    const title =
      titleRaw === null || titleRaw === undefined
        ? null
        : typeof titleRaw === 'string'
          ? titleRaw.trim().slice(0, 120) || null
          : null;
    out.push({
      title,
      stem,
      body: { splitIndex: i, splitMethod: 'gemini', llmProvider: cfg.provider, llmModel: modelLabel },
    });
  }

  if (out.length === 0) throw new Error('模型未解析出任何题目');
  return out;
}
