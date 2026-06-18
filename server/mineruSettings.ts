import { db, getSystemSettingJson, setSystemSettingJson } from './db.js';
import { decryptApiKey, encryptApiKey, maskApiKey } from './aiModelConfig.js';

const SETTINGS_KEY = 'mineru';

export type MineruApiMode = 'local' | 'cloud_v4' | 'cloud_agent';

export const MINERU_DEFAULT_URLS: Record<MineruApiMode, string> = {
  local: 'http://127.0.0.1:8000',
  cloud_v4: 'https://mineru.net/api/v4',
  cloud_agent: 'https://mineru.net/api/v1/agent',
};

export type MineruSettingsStored = {
  enabled: boolean;
  apiMode: MineruApiMode;
  apiUrl: string;
  lang: string;
  parseMethod: string;
  fallbackVision: boolean;
  llmCorrect: boolean;
  timeoutMs: number;
  backend: string;
};

type MineruSettingsDbRow = MineruSettingsStored & {
  apiKeyEnc?: string;
  updatedAt?: string;
};

export type MineruSettingsPublic = MineruSettingsStored & {
  source: 'db' | 'env';
  active: boolean;
  healthy: boolean;
  updatedAt: string | null;
  apiKeyMasked: string;
  hasApiKey: boolean;
};

export type MineruRuntimeConfig = MineruSettingsStored & {
  source: 'db' | 'env';
  apiKey: string;
};

/** MinerU 3.x file_parse 官方 backend 取值（见 cli_tools.md / fast_api） */
export const MINERU_BACKEND_OPTIONS: Array<{ value: string; label: string; hint: string }> = [
  {
    value: 'vlm-auto-engine',
    label: 'MinerU VLM（桌面端同名）',
    hint: '本地 VLM 高精度，中英文；对应桌面端「MinerU VLM」',
  },
  {
    value: 'hybrid-auto-engine',
    label: 'Hybrid 高精度（CLI 默认）',
    hint: '多语言、低幻觉；medium 强度默认关闭 image analysis',
  },
  {
    value: 'pipeline',
    label: 'Pipeline 传统管线',
    hint: 'CPU 可跑、无幻觉；parse_method / lang 仅对此后端生效',
  },
  {
    value: 'vlm-http-client',
    label: 'VLM HTTP 客户端',
    hint: '需额外配置 server_url（OpenAI 兼容推理服务）',
  },
  {
    value: 'hybrid-http-client',
    label: 'Hybrid HTTP 客户端',
    hint: '需本地 pipeline + 远程 OpenAI 兼容服务',
  },
];

/** 兼容旧配置 vlm / hybrid-engine 等写法 */
export function resolveMineruBackend(raw: string | undefined | null): string {
  const b = (raw || '').trim();
  if (!b) return 'vlm-auto-engine';
  const legacy: Record<string, string> = {
    vlm: 'vlm-auto-engine',
    'vlm-engine': 'vlm-auto-engine',
    hybrid: 'hybrid-auto-engine',
    'hybrid-engine': 'hybrid-auto-engine',
  };
  return legacy[b] || b;
}

function parseApiMode(raw: unknown, fallback: MineruApiMode): MineruApiMode {
  if (raw === 'local' || raw === 'cloud_v4' || raw === 'cloud_agent') return raw;
  return fallback;
}

function envMineruDefaults(): MineruSettingsStored {
  const envMode = process.env.MINERU_API_MODE?.trim();
  const apiMode = parseApiMode(envMode, 'local');
  return {
    enabled: process.env.MINERU_OCR_ENABLED !== '0',
    apiMode,
    apiUrl: process.env.MINERU_API_URL?.trim() || MINERU_DEFAULT_URLS[apiMode],
    lang: process.env.MINERU_LANG?.trim() || 'ch',
    parseMethod: process.env.MINERU_PARSE_METHOD?.trim() || 'auto',
    fallbackVision: process.env.MINERU_OCR_FALLBACK_VISION !== '0',
    /** 默认关闭 LLM 校正，避免篡改表格/实验数据；需显式设 AI_OCR_LLM_CORRECT=1 */
    llmCorrect: process.env.AI_OCR_LLM_CORRECT === '1',
    timeoutMs: Number(process.env.MINERU_TIMEOUT_MS || 180_000),
    /** 与 MinerU 桌面端「MinerU VLM」→ vlm-auto-engine */
    backend: resolveMineruBackend(process.env.MINERU_BACKEND),
  };
}

function normalizeStored(raw: Partial<MineruSettingsStored> | null | undefined): MineruSettingsStored {
  const env = envMineruDefaults();
  if (!raw || typeof raw !== 'object') return env;
  const timeoutMs = Number(raw.timeoutMs);
  const apiMode = parseApiMode(raw.apiMode, env.apiMode);
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : env.enabled,
    apiMode,
    apiUrl:
      typeof raw.apiUrl === 'string' && raw.apiUrl.trim()
        ? raw.apiUrl.trim()
        : MINERU_DEFAULT_URLS[apiMode],
    lang: typeof raw.lang === 'string' && raw.lang.trim() ? raw.lang.trim() : env.lang,
    parseMethod:
      typeof raw.parseMethod === 'string' && raw.parseMethod.trim() ? raw.parseMethod.trim() : env.parseMethod,
    fallbackVision: typeof raw.fallbackVision === 'boolean' ? raw.fallbackVision : env.fallbackVision,
    llmCorrect: typeof raw.llmCorrect === 'boolean' ? raw.llmCorrect : env.llmCorrect,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : env.timeoutMs,
    backend: resolveMineruBackend(
      typeof raw.backend === 'string' && raw.backend.trim() ? raw.backend.trim() : env.backend,
    ),
  };
}

function readDbRow(): MineruSettingsDbRow | null {
  return getSystemSettingJson<MineruSettingsDbRow>(SETTINGS_KEY);
}

function resolveApiKeyPlain(row: MineruSettingsDbRow | null): string {
  if (row?.apiKeyEnc) {
    try {
      return decryptApiKey(row.apiKeyEnc);
    } catch {
      return '';
    }
  }
  return process.env.MINERU_API_KEY?.trim() || process.env.MINERU_API_TOKEN?.trim() || '';
}

/** 运行时生效配置：数据库优先，否则环境变量 */
export function getEffectiveMineruConfig(): MineruRuntimeConfig {
  const row = readDbRow();
  if (row) {
    return { ...normalizeStored(row), source: 'db', apiKey: resolveApiKeyPlain(row) };
  }
  const env = envMineruDefaults();
  return { ...env, source: 'env', apiKey: resolveApiKeyPlain(null) };
}

export function isMineruOcrActive(): boolean {
  const cfg = getEffectiveMineruConfig();
  if (!cfg.enabled || !cfg.apiUrl) return false;
  if (cfg.apiMode === 'cloud_v4' && !cfg.apiKey) return false;
  return true;
}

export function isMineruFallbackVisionEnabled(): boolean {
  return getEffectiveMineruConfig().fallbackVision;
}

export function isOcrLlmCorrectEnabled(): boolean {
  return getEffectiveMineruConfig().llmCorrect;
}

function publicFromConfig(
  cfg: MineruSettingsStored,
  source: 'db' | 'env',
  apiKeyPlain: string,
  updatedAt: string | null,
): Omit<MineruSettingsPublic, 'active' | 'healthy'> {
  return {
    ...cfg,
    source,
    updatedAt,
    hasApiKey: Boolean(apiKeyPlain),
    apiKeyMasked: apiKeyPlain ? maskApiKey(apiKeyPlain) : '',
  };
}

export async function getMineruSettingsPublic(): Promise<MineruSettingsPublic> {
  const row = readDbRow();
  const source: 'db' | 'env' = row ? 'db' : 'env';
  const stored = row ? normalizeStored(row) : envMineruDefaults();
  const apiKeyPlain = resolveApiKeyPlain(row);
  const { checkMineruHealth } = await import('./mineruOcr.js');
  const active = isMineruOcrActive();
  const healthy = active
    ? await checkMineruHealth({
        apiUrl: stored.apiUrl,
        apiMode: stored.apiMode,
        apiKey: apiKeyPlain,
      })
    : false;
  const updatedRow = db
    .prepare(`SELECT updated_at FROM system_settings WHERE key = ?`)
    .get(SETTINGS_KEY) as { updated_at: string } | undefined;
  return {
    ...publicFromConfig(stored, source, apiKeyPlain, updatedRow?.updated_at ?? row?.updatedAt ?? null),
    active,
    healthy,
  };
}

export function updateMineruSettings(
  patch: Partial<MineruSettingsStored> & { apiKey?: string },
): MineruSettingsStored {
  const current = getEffectiveMineruConfig();
  const next = normalizeStored({ ...current, ...patch });
  if (next.enabled && !next.apiUrl) {
    throw new Error('启用 MinerU OCR 时必须填写 API 地址');
  }

  const row = readDbRow();
  let finalKey = resolveApiKeyPlain(row);
  if (patch.apiKey !== undefined) {
    finalKey = patch.apiKey.trim();
  }
  if (next.enabled && next.apiMode === 'cloud_v4' && !finalKey) {
    throw new Error('MinerU 云端 API 必须填写 API Token');
  }

  let apiKeyEnc = row?.apiKeyEnc;
  if (patch.apiKey !== undefined) {
    apiKeyEnc = patch.apiKey.trim() ? encryptApiKey(patch.apiKey.trim()) : undefined;
  }

  const payload: MineruSettingsDbRow = {
    ...next,
    updatedAt: new Date().toISOString(),
  };
  if (apiKeyEnc) payload.apiKeyEnc = apiKeyEnc;

  setSystemSettingJson(SETTINGS_KEY, payload);
  return next;
}
