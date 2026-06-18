import type { QuestionAnalysis } from './geminiService';

/** 避免对空响应或非 JSON（如代理 502 空正文、HTML 错误页）调用 r.json() 导致 Unexpected end of JSON input */
async function parseResponseJson<T>(r: Response): Promise<T> {
  const text = await r.text();
  const trimmed = text.trim();
  if (!trimmed) {
    return {} as T;
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const hint =
      r.status === 502 || r.status === 504
        ? '后端未启动或代理超时，请先在本机运行 npm run dev:api 或 npm run dev:all'
        : '服务器返回了非 JSON 内容';
    throw new Error(hint);
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string>),
    },
  });
  const data = await parseResponseJson<T & { error?: string }>(r);
  if (!r.ok) {
    throw new Error((data as { error?: string }).error || r.statusText || `请求失败 (${r.status})`);
  }
  return data as T;
}

/** multipart 上传（勿设 Content-Type，由浏览器带 boundary） */
export async function apiUploadForm<T>(
  path: string,
  file: File,
  fields?: Record<string, string | boolean | number | null | undefined>,
): Promise<T> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('originalFileName', file.name);
  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      if (v == null) continue;
      fd.append(k, String(v));
    }
  }
  const r = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    body: fd,
  });
  const data = await parseResponseJson<T & { error?: string }>(r);
  if (!r.ok) {
    throw new Error((data as { error?: string }).error || r.statusText || `请求失败 (${r.status})`);
  }
  return data as T;
}

export type SaveMistakeResult =
  | { ok: true; id: number }
  | { ok: false; reason: 'not_logged_in' | 'not_approved' | 'api_error'; message: string };

export async function saveMistakeIfAuthed(analysis: QuestionAnalysis): Promise<SaveMistakeResult> {
  try {
    const r = await fetch('/api/mistakes', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ analysis }),
    });
    const data = await parseResponseJson<{ id?: number; error?: string }>(r);
    if (r.status === 401) {
      return { ok: false, reason: 'not_logged_in', message: '未登录，错题仅保存在本机浏览器' };
    }
    if (r.status === 403) {
      return {
        ok: false,
        reason: 'not_approved',
        message: data.error || '账号尚未通过超级管理员审核，暂无法保存云端错题',
      };
    }
    if (!r.ok) {
      return { ok: false, reason: 'api_error', message: data.error || `保存失败 (${r.status})` };
    }
    if (typeof data.id !== 'number') {
      return { ok: false, reason: 'api_error', message: '保存失败：服务器未返回记录 ID' };
    }
    return { ok: true, id: data.id };
  } catch {
    return { ok: false, reason: 'api_error', message: '无法连接云端 API，请确认已启动 npm run dev:all' };
  }
}

/** 错题思维交流：第一步 AI 输出 */
export type ReflectionAnalyzeResponse = {
  blindSpots: string[];
  teacherComment: string;
  followUpQuestions: string[];
  similarQuestions: { stem: string; testingFocus: string }[];
  session?: unknown;
};

/** 错题思维交流：第二步评估 */
export type ReflectionAssessResponse = {
  masteryLevel: string;
  summaryFeedback: string;
  followUpFeedback: { index: number; comment: string; onTrack: boolean }[];
  similarFeedback: { index: number; comment: string; demonstratesUnderstanding: boolean }[];
  session?: unknown;
};

export type MistakeRow = {
  id: number;
  analysis_json: string;
  summary_preview: string;
  created_at: string;
  reflection_text?: string | null;
  reflection_session?: unknown;
};

export type GraphPayload = {
  nodes: { id: string; label: string; count: number }[];
  edges: { source: string; target: string; weight: number }[];
};

export type AdminUserRow = {
  id: number;
  username: string;
  role: string;
  approved: boolean;
  created_at: string;
  mistake_count: number;
};

export type QuestionApiRow = {
  id: number;
  title: string | null;
  stem: string;
  subject: string | null;
  difficulty: number | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  status: string;
  source: string | null;
  body: Record<string, unknown>;
};

export type PreviewSplitResponse = {
  method: 'heuristic' | 'gemini' | 'heuristic_fallback';
  count: number;
  items: { title: string | null; stem: string; body: Record<string, unknown> }[];
};

/** 整卷待审核入库接口返回 */
export type PaperIngestPendingResponse = {
  ok: boolean;
  batchKey: string;
  splitMethod: 'heuristic' | 'gemini' | 'heuristic_fallback';
  count: number;
  ids: number[];
  preview: Array<{
    title: string | null;
    stem: string;
    examPoints: string[];
    tagLabels: string[];
    scienceNodeIds: string[];
    scienceMatchPreview: ScienceMatchRow[];
  }>;
};

export type PaperExtractFileResponse = {
  text: string;
  format: string;
  charCount: number;
  fileName: string;
  originalName: string;
  imageCount?: number;
  images?: Record<string, { id: string; mime: string; data: string; alt?: string | null }>;
};

export type QuestionYamlImportResponse = {
  ok: boolean;
  count: number;
  ids: number[];
  skippedErrors?: string[];
};

export type PaperIngestUploadResponse = PaperIngestPendingResponse & {
  originalName: string;
};

export type JuniorScienceTreeNode = {
  id: string;
  label: string;
  keywords?: string[];
  children?: JuniorScienceTreeNode[];
  relPath?: string;
};

export type ScienceCoveragePayload = {
  coverage: Record<string, number>;
  mistakeCount: number;
};

/** 掌握度明细（含库存 raw、展示 effective、置信度等） */
export type ScienceMasteryDetailRow = {
  mastery: number;
  wrong_count: number;
  correct_count: number;
  last_wrong_at: string | null;
  last_correct_at: string | null;
  streak_correct: number;
  exposure_count: number;
  effective: number;
  confidence: number;
};

/** 知识点掌握度及对错统计 */
export type ScienceMasteryPayload = {
  mastery: Record<string, number>;
  detail: Record<string, ScienceMasteryDetailRow>;
  mistakeCount: number;
  /** 与后端课纲数据对齐 */
  treeVersion?: string;
};

export type JuniorScienceTreePayload = {
  tree: JuniorScienceTreeNode[];
  version: string;
  rootExists?: boolean;
  rootLabel?: string;
};

export type MaterialItem = {
  name: string;
  relPath: string;
  kind: 'dir' | 'file';
  ext?: string;
  size?: number;
  modifiedAt?: string;
};

export type MaterialListPayload = {
  rootLabel: string;
  rootExists: boolean;
  currentPath: string;
  parentPath: string | null;
  items: MaterialItem[];
};

export type MaterialPreviewPayload = {
  relPath: string;
  format: string;
  charCount: number;
  preview: string;
};

export type MaterialIngestResponse = PaperIngestPendingResponse & {
  relPath: string;
};

export type ScienceMatchRow = {
  id: string;
  label: string;
  path: string;
  score: number;
  /** 命中依据（关键词等） */
  reasons?: string[];
};

export type PracticeCandidateRow = {
  id: number;
  title: string | null;
  stem: string;
};

export type AiProvider = 'gemini' | 'zhipu' | 'openai' | 'deepseek' | 'moonshot' | 'custom';

export type AiModelConfigRow = {
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

export type AiModelsListResponse = {
  models: AiModelConfigRow[];
  active: {
    source: 'db' | 'env';
    configId: number | null;
    configName: string | null;
    provider: AiProvider;
    modelId: string;
  } | null;
  envFallback: { gemini: boolean; zhipu: boolean };
};

export type AiModelTestResponse = {
  ok: boolean;
  message: string;
  replyPreview?: string;
  latencyMs?: number;
  provider?: AiProvider;
  modelId?: string;
};

export type MineruApiMode = 'local' | 'cloud_v4' | 'cloud_agent';

export type MineruSettingsPublic = {
  enabled: boolean;
  apiMode: MineruApiMode;
  apiUrl: string;
  lang: string;
  parseMethod: string;
  fallbackVision: boolean;
  llmCorrect: boolean;
  timeoutMs: number;
  backend: string;
  source: 'db' | 'env';
  active: boolean;
  healthy: boolean;
  updatedAt: string | null;
  apiKeyMasked: string;
  hasApiKey: boolean;
};

export type MineruSettingsResponse = {
  settings: MineruSettingsPublic;
};

export type MineruTestResponse = {
  ok: boolean;
  message: string;
  detail?: string;
  url?: string;
};
