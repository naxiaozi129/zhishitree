import type { AiProvider, ResolvedAiConfig } from './aiModelConfig.js';
import { createGeminiClient, runWithGeminiNetwork } from './geminiClient.js';
import { normalizeModelId, resolveOpenAiCompatibleBaseUrl } from './aiModelConfig.js';
import { chatCompletionsUrl, extractOpenAiResponseText } from './llmOpenAiCompat.js';

export type LlmGenerateOptions = {
  maxTokens?: number;
  temperature?: number;
  /** 智谱等：是否关闭深度思考（默认关闭，便于直接拿到 content） */
  disableThinking?: boolean;
};

function buildOpenAiRequestBody(
  cfg: Pick<ResolvedAiConfig, 'provider' | 'modelId' | 'baseUrl'>,
  modelId: string,
  prompt: string,
  opts?: LlmGenerateOptions,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: modelId,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: opts?.maxTokens ?? 8192,
    temperature: opts?.temperature ?? 0.7,
    stream: false,
  };

  if (cfg.provider === 'zhipu') {
    const disableThinking = opts?.disableThinking !== false;
    if (disableThinking) {
      body.thinking = { type: 'disabled' };
    }
  }

  return body;
}

function emptyResponseMessage(finishReason?: string, modelId?: string): string {
  const parts = ['模型未返回可解析的正文'];
  if (finishReason) parts.push(`finish_reason=${finishReason}`);
  if (modelId) parts.push(`model=${modelId}`);
  parts.push('若为智谱 GLM-4.7/5 系列，请确认模型 ID 正确，或尝试 glm-4-flash');
  return parts.join('；');
}

async function generateOpenAiCompatibleText(
  cfg: Pick<ResolvedAiConfig, 'apiKey' | 'modelId' | 'provider' | 'baseUrl'>,
  prompt: string,
  opts?: LlmGenerateOptions,
): Promise<string> {
  const base = resolveOpenAiCompatibleBaseUrl(cfg.provider, cfg.baseUrl);
  if (!base) throw new Error('请配置 Base URL（OpenAI 兼容接口）');

  const modelId = normalizeModelId(cfg.provider, cfg.modelId);
  const url = chatCompletionsUrl(base);
  const body = buildOpenAiRequestBody(cfg, modelId, prompt, opts);

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey.trim()}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  const raw = await r.text();
  let data: unknown = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(raw.slice(0, 300) || `HTTP ${r.status}`);
  }

  if (!r.ok) {
    const err = data as { error?: { message?: string } };
    throw new Error(err.error?.message || raw.slice(0, 300) || `HTTP ${r.status}`);
  }

  let { text, finishReason } = extractOpenAiResponseText(data);

  if (!text && cfg.provider === 'zhipu' && opts?.disableThinking !== false) {
    const retryBody = { ...body, thinking: { type: 'enabled' } };
    const r2 = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey.trim()}`,
      },
      body: JSON.stringify(retryBody),
      signal: AbortSignal.timeout(120_000),
    });
    const raw2 = await r2.text();
    let data2: unknown = {};
    try {
      data2 = raw2 ? JSON.parse(raw2) : {};
    } catch {
      /* use first pass error */
    }
    if (r2.ok) {
      const parsed = extractOpenAiResponseText(data2);
      text = parsed.text;
      finishReason = parsed.finishReason;
    }
  }

  if (!text) throw new Error(emptyResponseMessage(finishReason, modelId));
  return text;
}

async function generateGeminiText(
  apiKey: string,
  modelId: string,
  prompt: string,
): Promise<string> {
  return runWithGeminiNetwork(async () => {
    const ai = createGeminiClient(apiKey);
    const response = await ai.models.generateContent({
      model: normalizeModelId('gemini', modelId),
      contents: { parts: [{ text: prompt }] },
    });
    const text = response.text?.trim();
    if (!text) throw new Error('模型未返回内容');
    return text;
  });
}

/** 按已解析配置调用大模型，返回纯文本 */
export async function generateLlmText(
  cfg: Pick<ResolvedAiConfig, 'apiKey' | 'modelId' | 'provider' | 'baseUrl'>,
  prompt: string,
  opts?: LlmGenerateOptions,
): Promise<string> {
  if (cfg.provider === 'gemini') {
    return generateGeminiText(cfg.apiKey, cfg.modelId, prompt);
  }
  return generateOpenAiCompatibleText(cfg, prompt, opts);
}

export async function generateLlmTextFromLegacy(
  apiKey: string,
  modelId: string | undefined,
  prompt: string,
  provider: AiProvider = 'gemini',
  baseUrl: string | null = null,
  opts?: LlmGenerateOptions,
): Promise<string> {
  return generateLlmText(
    {
      apiKey,
      modelId: modelId || (provider === 'gemini' ? 'gemini-2.0-flash' : 'glm-4-flash'),
      provider,
      baseUrl,
    },
    prompt,
    opts,
  );
}
