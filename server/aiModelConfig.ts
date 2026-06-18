import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import {
  createAiModelConfig,
  deleteAiModelConfig,
  getAiModelConfigById,
  listAiModelConfigs,
  setDefaultAiModelConfig,
  updateAiModelConfig,
  type AiModelConfigRow,
} from './db.js';

export type AiProvider = 'gemini' | 'zhipu' | 'openai' | 'deepseek' | 'moonshot' | 'custom';

/** 智谱常用模型 ID（供 UI 提示与别名映射） */
export const ZHIPU_DEFAULT_MODEL = 'glm-4-flash';
export const ZHIPU_DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
/** 智谱官方视觉模型（glm-5 / glm-4-flash 等纯文本模型不能识图） */
export const ZHIPU_VISION_MODEL_DEFAULT = 'glm-4.6v';
export const ZHIPU_VISION_MODEL_FALLBACKS = ['glm-4.6v', 'glm-4v-plus', 'glm-4v-flash'] as const;

const ZHIPU_MODEL_ALIASES: Record<string, string> = {
  glm4flash: 'glm-4-flash',
  'glm-4': 'glm-4-flash',
  chatglm: 'glm-4-flash',
  chatglm3: 'glm-4-flash',
  'glm4-flash': 'glm-4-flash',
  'glm-4-flashx': 'glm-4-flashx-250414',
  'glm-4-flashx-250414': 'glm-4-flashx-250414',
  'glm-4-flash-250414': 'glm-4-flash-250414',
  'glm-4-air': 'glm-4-air',
  'glm-4-air-250414': 'glm-4-air-250414',
  'glm-4-plus': 'glm-4-plus',
  'glm-4-long': 'glm-4-long',
  'glm-4.5-flash': 'glm-4.5-flash',
  'glm-4.6': 'glm-4.6',
  'glm-4.7': 'glm-4.7',
  'glm4.7': 'glm-4.7',
  'glm-5': 'glm-5',
  'glm-5.1': 'glm-5.1',
  'glm-5.2': 'glm-5.2',
  'glm-4.6v': 'glm-4.6v',
  'glm-4.5v': 'glm-4.5v',
  'glm-4v-plus': 'glm-4v-plus',
  'glm-4v-flash': 'glm-4v-flash',
  glm4: 'glm-4-flash',
};

export type AiModelConfigPublic = {
  id: number;
  name: string;
  provider: AiProvider;
  modelId: string;
  baseUrl: string | null;
  enabled: boolean;
  isDefault: boolean;
  note: string | null;
  apiKeyMasked: string;
  hasApiKey: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ResolvedAiConfig = {
  apiKey: string;
  modelId: string;
  provider: AiProvider;
  baseUrl: string | null;
  source: 'db' | 'env';
  configId?: number;
  configName?: string;
};

const ENC_PREFIX = 'enc:v1:';

function encryptionKey(): Buffer {
  const secret = process.env.AI_KEY_ENCRYPTION_SECRET || process.env.JWT_SECRET || 'zhishitree-dev-key';
  return createHash('sha256').update(secret).digest();
}

export function encryptApiKey(plain: string): string {
  const key = encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString('base64url')}.${enc.toString('base64url')}.${tag.toString('base64url')}`;
}

export function decryptApiKey(stored: string): string {
  if (!stored.startsWith(ENC_PREFIX)) return stored;
  const payload = stored.slice(ENC_PREFIX.length);
  const [ivB64, dataB64, tagB64] = payload.split('.');
  if (!ivB64 || !dataB64 || !tagB64) throw new Error('API Key 存储格式无效');
  const key = encryptionKey();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8');
}

export function maskApiKey(plain: string): string {
  const s = plain.trim();
  if (!s) return '';
  if (s.length <= 8) return '****';
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function normalizeProvider(v: string): AiProvider {
  const p = v.trim().toLowerCase();
  if (p === 'zhipu' || p === 'zhipuai' || p === 'bigmodel' || p === '智谱' || p === '智谱ai') {
    return 'zhipu';
  }
  if (p === 'gemini' || p === 'openai' || p === 'deepseek' || p === 'moonshot' || p === 'custom') {
    return p;
  }
  return 'custom';
}

export function normalizeModelId(provider: AiProvider, modelId: string): string {
  const raw = modelId.trim();
  if (!raw) return provider === 'zhipu' ? ZHIPU_DEFAULT_MODEL : raw;
  const key = raw.toLowerCase().replace(/_/g, '-');
  if (provider === 'zhipu') {
    if (ZHIPU_MODEL_ALIASES[key.replace(/-/g, '')]) {
      return ZHIPU_MODEL_ALIASES[key.replace(/-/g, '')];
    }
    if (ZHIPU_MODEL_ALIASES[key]) return ZHIPU_MODEL_ALIASES[key];
    if (key.startsWith('glm')) return key;
  }
  if (provider === 'gemini') {
    return normalizeGeminiModelId(raw);
  }
  return raw;
}

function normalizeGeminiModelId(raw: string): string {
  const t = raw.trim();
  const compact = t.toLowerCase().replace(/[\s_]+/g, '');
  if (/^gemini2\.?5flash/.test(compact)) return 'gemini-2.5-flash';
  if (/^gemini2\.?0flash/.test(compact)) return 'gemini-2.0-flash';
  if (/^gemini2\.?5pro/.test(compact)) return 'gemini-2.5-pro';
  if (/^gemini2\.?0pro/.test(compact)) return 'gemini-2.0-flash';
  if (t.startsWith('gemini-') || t.startsWith('gemini')) return t.replace(/\s+/g, '-').toLowerCase();
  return t;
}

/** 是否为智谱视觉模型（可接收 image_url） */
export function isZhipuVisionModel(modelId: string): boolean {
  const m = normalizeModelId('zhipu', modelId).toLowerCase();
  if (/^glm-5|^glm-4-flash|^glm-4-air|^glm-4-plus$|^glm-4-long|^glm-4\.6$|^glm-4\.7$/.test(m)) {
    return false;
  }
  return /(^glm-4v|4v-|4\.6v|4\.5v|vision)/i.test(m);
}

/** OCR 专用：从配置/环境变量解析视觉模型，绝不返回纯文本模型 */
export function resolveZhipuVisionModelCandidates(configuredModelId: string): string[] {
  const out: string[] = [];
  const push = (id: string) => {
    const n = normalizeModelId('zhipu', id);
    if (n && !out.includes(n)) out.push(n);
  };
  const envVision = process.env.ZHIPU_VISION_MODEL?.trim();
  if (envVision) push(envVision);
  const configured = normalizeModelId('zhipu', configuredModelId);
  if (isZhipuVisionModel(configured)) push(configured);
  for (const fb of ZHIPU_VISION_MODEL_FALLBACKS) push(fb);
  if (out.length === 0) push(ZHIPU_VISION_MODEL_DEFAULT);
  return out;
}

export function resolveOpenAiCompatibleBaseUrl(provider: AiProvider, baseUrl?: string | null): string | null {
  const custom = baseUrl?.trim();
  if (custom) return custom;
  switch (provider) {
    case 'zhipu':
      return ZHIPU_DEFAULT_BASE_URL;
    case 'openai':
      return 'https://api.openai.com/v1';
    case 'deepseek':
      return 'https://api.deepseek.com/v1';
    case 'moonshot':
      return 'https://api.moonshot.cn/v1';
    default:
      return null;
  }
}

export function providerDefaultModelId(provider: AiProvider): string {
  switch (provider) {
    case 'zhipu':
      return ZHIPU_DEFAULT_MODEL;
    case 'gemini':
      return process.env.GEMINI_DEFAULT_MODEL || 'gemini-2.0-flash';
    default:
      return '';
  }
}

function rowToPublic(row: AiModelConfigRow, apiKeyPlain?: string): AiModelConfigPublic {
  let masked = '****';
  let hasKey = Boolean(row.api_key_enc);
  if (apiKeyPlain) {
    masked = maskApiKey(apiKeyPlain);
    hasKey = Boolean(apiKeyPlain.trim());
  } else if (row.api_key_enc) {
    try {
      masked = maskApiKey(decryptApiKey(row.api_key_enc));
    } catch {
      masked = '（无法解密）';
    }
  }
  return {
    id: row.id,
    name: row.name,
    provider: normalizeProvider(row.provider),
    modelId: row.model_id,
    baseUrl: row.base_url,
    enabled: row.enabled === 1,
    isDefault: row.is_default === 1,
    note: row.note,
    apiKeyMasked: masked,
    hasApiKey: hasKey,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listAiModelsForAdmin(): AiModelConfigPublic[] {
  return listAiModelConfigs().map((row) => rowToPublic(row));
}

export function getAiModelPublic(id: number): AiModelConfigPublic | undefined {
  const row = getAiModelConfigById(id);
  return row ? rowToPublic(row) : undefined;
}

export function resolveAiCredentials(opts?: { configId?: number }): ResolvedAiConfig | null {
  if (opts?.configId) {
    const row = getAiModelConfigById(opts.configId);
    if (row && row.enabled === 1) {
      try {
        const apiKey = decryptApiKey(row.api_key_enc).trim();
        if (apiKey) {
          return {
            apiKey,
            modelId: row.model_id,
            provider: normalizeProvider(row.provider),
            baseUrl: row.base_url,
            source: 'db',
            configId: row.id,
            configName: row.name,
          };
        }
      } catch {
        /* fall through */
      }
    }
  }

  const rows = listAiModelConfigs().filter((r) => r.enabled === 1);
  const picked = rows.find((r) => r.is_default === 1) || rows[0];
  if (picked) {
    try {
      const apiKey = decryptApiKey(picked.api_key_enc).trim();
      if (apiKey) {
        return {
          apiKey,
          modelId: picked.model_id,
          provider: normalizeProvider(picked.provider),
          baseUrl: picked.base_url,
          source: 'db',
          configId: picked.id,
          configName: picked.name,
        };
      }
    } catch {
      /* fall through */
    }
  }

  return resolveEnvFallbackCredentials();
}

function resolveEnvFallbackCredentials(): ResolvedAiConfig | null {
  const prefer = (process.env.AI_DEFAULT_PROVIDER || '').trim().toLowerCase();
  const zhipuKey = String(process.env.ZHIPU_API_KEY || '').trim();
  const geminiKey = String(process.env.GEMINI_API_KEY || '').trim();

  const zhipuCfg: ResolvedAiConfig | null = zhipuKey
    ? {
        apiKey: zhipuKey,
        modelId: process.env.ZHIPU_DEFAULT_MODEL || ZHIPU_DEFAULT_MODEL,
        provider: 'zhipu',
        baseUrl: process.env.ZHIPU_BASE_URL?.trim() || ZHIPU_DEFAULT_BASE_URL,
        source: 'env',
      }
    : null;

  const geminiCfg: ResolvedAiConfig | null = geminiKey
    ? {
        apiKey: geminiKey,
        modelId: process.env.GEMINI_DEFAULT_MODEL || 'gemini-2.0-flash',
        provider: 'gemini',
        baseUrl: null,
        source: 'env',
      }
    : null;

  if (prefer === 'zhipu') return zhipuCfg || geminiCfg;
  if (prefer === 'gemini') return geminiCfg || zhipuCfg;
  return geminiCfg || zhipuCfg;
}

export function getEnvAiFallbackStatus(): { gemini: boolean; zhipu: boolean } {
  return {
    gemini: Boolean(String(process.env.GEMINI_API_KEY || '').trim()),
    zhipu: Boolean(String(process.env.ZHIPU_API_KEY || '').trim()),
  };
}

/** 识图 / OCR 专用配置（可与文字分析模型分离） */
export function resolveOcrCredentials(fallback: ResolvedAiConfig | null): ResolvedAiConfig | null {
  if (!fallback) return null;

  const ocrProvider = (process.env.AI_OCR_PROVIDER || '').trim().toLowerCase();
  const useGeminiOcr =
    ocrProvider === 'gemini' ||
    process.env.AI_OCR_USE_GEMINI === '1' ||
    process.env.AI_OCR_USE_GEMINI === 'true';

  if (useGeminiOcr || ocrProvider === 'gemini') {
    const gemini = resolveGeminiCredentials();
    if (gemini) {
      return {
        ...gemini,
        modelId:
          process.env.GEMINI_OCR_MODEL?.trim() ||
          process.env.GEMINI_VISION_MODEL?.trim() ||
          gemini.modelId ||
          'gemini-2.0-flash',
      };
    }
  }

  const rows = listAiModelConfigs().filter((r) => r.enabled === 1);
  const ocrNamed = rows.find(
    (r) => /ocr|识图|视觉|vision/i.test(r.name) && isZhipuVisionModel(r.model_id),
  );
  if (ocrNamed) {
    try {
      const apiKey = decryptApiKey(ocrNamed.api_key_enc).trim();
      if (apiKey) {
        return {
          apiKey,
          modelId: normalizeModelId('zhipu', ocrNamed.model_id),
          provider: 'zhipu',
          baseUrl: ocrNamed.base_url,
          source: 'db',
          configId: ocrNamed.id,
          configName: ocrNamed.name,
        };
      }
    } catch {
      /* fall through */
    }
  }

  if (fallback.provider === 'gemini') {
    return {
      ...fallback,
      modelId:
        process.env.GEMINI_OCR_MODEL?.trim() ||
        process.env.GEMINI_VISION_MODEL?.trim() ||
        fallback.modelId ||
        'gemini-2.0-flash',
    };
  }

  if (fallback.provider === 'zhipu') {
    const visionId = resolveZhipuVisionModelCandidates(fallback.modelId)[0] || ZHIPU_VISION_MODEL_DEFAULT;
    return { ...fallback, modelId: visionId };
  }

  return fallback;
}

/** 服务端 AI 调用：默认且已启用的任意提供商，其次环境变量 */
export function resolveActiveAiCredentials(opts?: { configId?: number }): ResolvedAiConfig | null {
  return resolveAiCredentials(opts);
}

/** @deprecated 请使用 resolveActiveAiCredentials；保留兼容 Gemini 专用筛选 */
export function resolveGeminiCredentials(opts?: { configId?: number }): ResolvedAiConfig | null {
  if (opts?.configId) {
    const cfg = resolveAiCredentials({ configId: opts.configId });
    if (cfg?.provider === 'gemini' && cfg.apiKey) return cfg;
  }

  const rows = listAiModelConfigs().filter((r) => r.enabled === 1 && normalizeProvider(r.provider) === 'gemini');
  const picked = rows.find((r) => r.is_default === 1) || rows[0];
  if (picked) {
    try {
      const apiKey = decryptApiKey(picked.api_key_enc).trim();
      if (apiKey) {
        return {
          apiKey,
          modelId: picked.model_id,
          provider: 'gemini',
          baseUrl: picked.base_url,
          source: 'db',
          configId: picked.id,
          configName: picked.name,
        };
      }
    } catch {
      /* fall through */
    }
  }

  const envKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (envKey) {
    return {
      apiKey: envKey,
      modelId: process.env.GEMINI_DEFAULT_MODEL || 'gemini-2.0-flash',
      provider: 'gemini',
      baseUrl: null,
      source: 'env',
    };
  }

  return null;
}

export function aiConfigUnavailableMessage(): string {
  return '未配置 AI 模型 API（请在管理后台「系统设置」添加模型，或在 .env.local 中设置 ZHIPU_API_KEY / GEMINI_API_KEY）';
}

export function createAiModelFromInput(input: {
  name: string;
  provider: string;
  modelId: string;
  apiKey: string;
  baseUrl?: string | null;
  enabled?: boolean;
  isDefault?: boolean;
  note?: string | null;
}): AiModelConfigPublic {
  const name = input.name.trim();
  const modelId = input.modelId.trim();
  const apiKey = input.apiKey.trim();
  if (!name) throw new Error('请填写配置名称');
  if (!modelId) throw new Error('请填写模型 ID');
  if (!apiKey) throw new Error('请填写 API Key');

  const id = createAiModelConfig({
    name,
    provider: normalizeProvider(input.provider),
    modelId: normalizeModelId(normalizeProvider(input.provider), modelId),
    apiKeyEnc: encryptApiKey(apiKey),
    baseUrl: input.baseUrl?.trim() || null,
    enabled: input.enabled !== false,
    isDefault: Boolean(input.isDefault),
    note: input.note?.trim() || null,
  });
  const row = getAiModelConfigById(id);
  if (!row) throw new Error('创建失败');
  return rowToPublic(row, apiKey);
}

export function updateAiModelFromInput(
  id: number,
  input: {
    name?: string;
    provider?: string;
    modelId?: string;
    apiKey?: string;
    baseUrl?: string | null;
    enabled?: boolean;
    isDefault?: boolean;
    note?: string | null;
  },
): AiModelConfigPublic | undefined {
  const existing = getAiModelConfigById(id);
  if (!existing) return undefined;

  const patch: Parameters<typeof updateAiModelConfig>[1] = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new Error('配置名称不能为空');
    patch.name = name;
  }
  if (input.provider !== undefined) patch.provider = normalizeProvider(input.provider);
  if (input.modelId !== undefined) {
    const modelId = input.modelId.trim();
    if (!modelId) throw new Error('模型 ID 不能为空');
    const provider = input.provider !== undefined ? normalizeProvider(input.provider) : normalizeProvider(existing.provider);
    patch.modelId = normalizeModelId(provider, modelId);
  }
  if (input.baseUrl !== undefined) patch.baseUrl = input.baseUrl?.trim() || null;
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.isDefault !== undefined) patch.isDefault = input.isDefault;
  if (input.note !== undefined) patch.note = input.note?.trim() || null;
  if (input.apiKey !== undefined && input.apiKey.trim()) {
    patch.apiKeyEnc = encryptApiKey(input.apiKey.trim());
  }

  updateAiModelConfig(id, patch);
  const row = getAiModelConfigById(id);
  return row ? rowToPublic(row) : undefined;
}

export function removeAiModel(id: number): boolean {
  return deleteAiModelConfig(id);
}

export function markAiModelDefault(id: number): AiModelConfigPublic | undefined {
  setDefaultAiModelConfig(id);
  return getAiModelPublic(id);
}

/** 解析检测用的凭证：表单 apiKey 优先，否则从已保存配置读取 */
export function resolveAiModelForTest(input: {
  configId?: number;
  provider?: string;
  modelId?: string;
  apiKey?: string;
  baseUrl?: string | null;
}): { provider: AiProvider; modelId: string; apiKey: string; baseUrl: string | null } {
  const row = input.configId ? getAiModelConfigById(input.configId) : undefined;
  const provider = normalizeProvider(input.provider ?? row?.provider ?? 'gemini');
  const modelId = (input.modelId ?? row?.model_id ?? '').trim();
  const baseUrl =
    input.baseUrl !== undefined ? input.baseUrl?.trim() || null : row?.base_url ?? null;

  let apiKey = String(input.apiKey ?? '').trim();
  if (!apiKey && row) {
    apiKey = decryptApiKey(row.api_key_enc).trim();
  }

  if (!modelId) throw new Error('请填写模型 ID');
  if (!apiKey) throw new Error('请填写 API Key，或使用已保存且含密钥的配置');

  return { provider, modelId: normalizeModelId(provider, modelId), apiKey, baseUrl };
}

export const AI_PROVIDER_OPTIONS: { value: AiProvider; label: string; hint?: string; defaultModelId?: string; defaultBaseUrl?: string }[] = [
  { value: 'gemini', label: 'Google Gemini', hint: '服务端已接入', defaultModelId: 'gemini-2.0-flash' },
  {
    value: 'zhipu',
    label: '智谱 AI（GLM）',
    hint: '服务端已接入',
    defaultModelId: ZHIPU_DEFAULT_MODEL,
    defaultBaseUrl: ZHIPU_DEFAULT_BASE_URL,
  },
  { value: 'openai', label: 'OpenAI', defaultModelId: 'gpt-4o-mini', defaultBaseUrl: 'https://api.openai.com/v1' },
  { value: 'deepseek', label: 'DeepSeek', defaultModelId: 'deepseek-chat', defaultBaseUrl: 'https://api.deepseek.com/v1' },
  { value: 'moonshot', label: 'Moonshot / Kimi', defaultModelId: 'moonshot-v1-8k', defaultBaseUrl: 'https://api.moonshot.cn/v1' },
  { value: 'custom', label: '自定义 OpenAI 兼容' },
];
