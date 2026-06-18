import type { AiProvider, ResolvedAiConfig } from './aiModelConfig.js';
import { normalizeModelId, resolveOpenAiCompatibleBaseUrl } from './aiModelConfig.js';
import { generateLlmText } from './llmGenerate.js';

const TEST_PROMPT = '请只回复两个字母：OK';

export type AiModelTestResult = {
  ok: boolean;
  message: string;
  replyPreview?: string;
  latencyMs?: number;
  provider?: AiProvider;
  modelId?: string;
};

export async function testAiModelConnection(params: {
  provider: AiProvider;
  modelId: string;
  apiKey: string;
  baseUrl?: string | null;
}): Promise<AiModelTestResult> {
  const provider = params.provider;
  const modelId = normalizeModelId(provider, params.modelId);
  const apiKey = params.apiKey.trim();
  if (!modelId) return { ok: false, message: '请填写模型 ID', provider, modelId: params.modelId };
  if (!apiKey) return { ok: false, message: '请填写 API Key', provider, modelId };

  const cfg: Pick<ResolvedAiConfig, 'apiKey' | 'modelId' | 'provider' | 'baseUrl'> = {
    apiKey,
    modelId,
    provider,
    baseUrl: params.baseUrl ?? null,
  };

  if (provider !== 'gemini' && !resolveOpenAiCompatibleBaseUrl(provider, params.baseUrl)) {
    return { ok: false, message: '请填写 Base URL（自定义 OpenAI 兼容接口）', provider, modelId };
  }

  const start = Date.now();
  try {
    const reply = await generateLlmText(cfg, TEST_PROMPT, {
      maxTokens: 256,
      temperature: 0.1,
      disableThinking: true,
    });
    const latencyMs = Date.now() - start;
    return {
      ok: true,
      message: `连接成功，模型「${modelId}」可正常响应（耗时 ${latencyMs} ms）`,
      replyPreview: reply.slice(0, 120) || '（模型返回为空）',
      latencyMs,
      provider,
      modelId,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '检测失败';
    let hint = msg;
    if (provider === 'zhipu' && /未返回|not found|unknown model|不存在/i.test(msg)) {
      hint = `${msg}。智谱检测建议：模型 ID 用 glm-4-flash；视觉用 glm-4.6v；Base URL 为 https://open.bigmodel.cn/api/paas/v4`;
    } else if (provider === 'gemini' && /fetch failed|ECONNREFUSED|ETIMEDOUT|network|ENOTFOUND/i.test(msg)) {
      hint = `${msg}。国内服务器需配置代理：在 .env.local 添加 GEMINI_HTTP_PROXY=http://127.0.0.1:7890（改为你的代理地址），重启服务后再检测。或改用智谱 glm-4.6v 识图。`;
    } else if (provider === 'gemini' && params.baseUrl?.trim()) {
      hint = `${msg}。Gemini 无需填写 Base URL，请清空 aistudio 网页地址，仅保留 API Key`;
    }
    return {
      ok: false,
      message: hint,
      latencyMs: Date.now() - start,
      provider,
      modelId,
    };
  }
}
