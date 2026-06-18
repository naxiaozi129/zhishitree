import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { QuestionRow } from './db.js';

export const QUESTION_YAML_FORMAT = 'zhishitree-questions';
export const QUESTION_YAML_VERSION = 1;

export type QuestionImageRef = {
  id: string;
  alt?: string | null;
  mime: string;
  /** base64 不含 data: 前缀 */
  data: string;
};

export type QuestionYamlItem = {
  id?: number;
  title?: string | null;
  subject?: string | null;
  difficulty?: number | null;
  status?: 'draft' | 'published' | 'pending';
  source?: string | null;
  stem: string;
  answer?: string | null;
  images?: QuestionImageRef[];
  examPoints?: string[];
  tagLabels?: string[];
  scienceNodeIds?: string[];
  notes?: string | null;
  meta?: Record<string, unknown>;
};

export type QuestionYamlDocument = {
  format: typeof QUESTION_YAML_FORMAT;
  version: number;
  exportedAt?: string;
  questions: QuestionYamlItem[];
};

const IMG_PLACEHOLDER_RE = /\{\{image:([a-zA-Z0-9_-]+)\}\}/g;
const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

function parseBodyJson(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseDataUrl(src: string): { mime: string; data: string } | null {
  const m = src.match(/^data:([^;]+);base64,(.+)$/i);
  if (!m) return null;
  return { mime: m[1], data: m[2] };
}

function normalizeImageRef(raw: unknown, fallbackId: string): QuestionImageRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? fallbackId).trim() || fallbackId;
  let mime = typeof o.mime === 'string' ? o.mime : 'image/png';
  let data = typeof o.data === 'string' ? o.data.trim() : '';
  if (!data && typeof o.src === 'string') {
    const parsed = parseDataUrl(o.src.trim());
    if (parsed) {
      mime = parsed.mime;
      data = parsed.data;
    }
  }
  if (!data) return null;
  if (data.startsWith('data:')) {
    const parsed = parseDataUrl(data);
    if (!parsed) return null;
    mime = parsed.mime;
    data = parsed.data;
  }
  return {
    id,
    alt: typeof o.alt === 'string' ? o.alt : null,
    mime,
    data,
  };
}

/** 从 stem / body 收集图片，stem 中长 data URL 替换为 {{image:id}} */
export function normalizeQuestionImages(
  stem: string,
  body: Record<string, unknown>,
): { stem: string; images: QuestionImageRef[] } {
  const images: QuestionImageRef[] = [];
  const byId = new Map<string, QuestionImageRef>();
  let seq = 0;

  const pushImage = (ref: QuestionImageRef) => {
    const id = ref.id || `img${seq++}`;
    const normalized = { ...ref, id };
    byId.set(id, normalized);
    images.push(normalized);
    return id;
  };

  if (Array.isArray(body.images)) {
    for (const raw of body.images) {
      const ref = normalizeImageRef(raw, `img${seq++}`);
      if (ref) pushImage(ref);
    }
  }

  let normalizedStem = stem;
  normalizedStem = normalizedStem.replace(MD_IMAGE_RE, (full, altRaw, srcRaw) => {
    const src = String(srcRaw).trim();
    const parsed = parseDataUrl(src);
    if (!parsed) return full;
    const id = pushImage({
      id: `img${seq++}`,
      alt: String(altRaw || '').trim() || null,
      mime: parsed.mime,
      data: parsed.data,
    });
    return `{{image:${id}}}`;
  });

  for (const img of images) {
    if (!normalizedStem.includes(`{{image:${img.id}}}`)) {
      // 保留未在 stem 引用的图片（便于 YAML 完整导出）
    }
  }

  return { stem: normalizedStem, images: [...byId.values()] };
}

/** 将 {{image:id}} 还原为 markdown 图片（便于前端渲染） */
export function expandImagePlaceholders(stem: string, images: QuestionImageRef[]): string {
  if (!images.length) return stem;
  const map = new Map(images.map((img) => [img.id, img]));
  return stem.replace(IMG_PLACEHOLDER_RE, (_full, id: string) => {
    const img = map.get(id);
    if (!img) return _full;
    const alt = img.alt || img.id;
    return `![${alt}](data:${img.mime};base64,${img.data})`;
  });
}

export function collectImagesForStem(stem: string, pool: Record<string, QuestionImageRef>): QuestionImageRef[] {
  const ids = new Set<string>();
  for (const m of stem.matchAll(IMG_PLACEHOLDER_RE)) {
    ids.add(m[1]);
  }
  for (const m of stem.matchAll(MD_IMAGE_RE)) {
    const parsed = parseDataUrl(String(m[2]).trim());
    if (parsed) ids.add(`inline_${ids.size}`);
  }
  const out: QuestionImageRef[] = [];
  for (const id of ids) {
    const img = pool[id];
    if (img) out.push(img);
  }
  return out;
}

export function questionRowToYamlItem(row: QuestionRow): QuestionYamlItem {
  const body = parseBodyJson(row.body_json);
  const answer =
    typeof body.answerText === 'string' && body.answerText.trim() ? body.answerText.trim() : null;
  const { stem, images } = normalizeQuestionImages(row.stem, body);

  const examPoints = Array.isArray(body.examPoints)
    ? body.examPoints.map((x) => String(x ?? '').trim()).filter(Boolean)
    : undefined;
  const tagLabels = Array.isArray(body.tagLabels)
    ? body.tagLabels.map((x) => String(x ?? '').trim()).filter(Boolean)
    : undefined;
  const scienceNodeIds = Array.isArray(body.scienceNodeIds)
    ? body.scienceNodeIds.map((x) => String(x ?? '').trim()).filter(Boolean)
    : undefined;
  const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;

  const meta: Record<string, unknown> = { ...body };
  delete meta.answerText;
  delete meta.images;
  delete meta.examPoints;
  delete meta.tagLabels;
  delete meta.scienceNodeIds;
  delete meta.notes;

  const item: QuestionYamlItem = {
    id: row.id,
    title: row.title,
    subject: row.subject,
    difficulty: row.difficulty,
    status: row.status as QuestionYamlItem['status'],
    source: row.source,
    stem,
    answer,
    images: images.length ? images : undefined,
    examPoints: examPoints?.length ? examPoints : undefined,
    tagLabels: tagLabels?.length ? tagLabels : undefined,
    scienceNodeIds: scienceNodeIds?.length ? scienceNodeIds : undefined,
    notes,
    meta: Object.keys(meta).length ? meta : undefined,
  };
  return item;
}

export function serializeQuestionsYaml(rows: QuestionRow[]): string {
  const doc: QuestionYamlDocument = {
    format: QUESTION_YAML_FORMAT,
    version: QUESTION_YAML_VERSION,
    exportedAt: new Date().toISOString(),
    questions: rows.map(questionRowToYamlItem),
  };
  return stringifyYaml(doc, {
    lineWidth: 120,
    defaultStringType: 'BLOCK_LITERAL',
    defaultKeyType: 'PLAIN',
  });
}

export function yamlItemToPreparedQuestion(
  item: QuestionYamlItem,
  createdBy: number | null,
  opts?: { defaultStatus?: 'draft' | 'published' | 'pending'; defaultSubject?: string | null },
): {
  title: string | null;
  stem: string;
  body: Record<string, unknown>;
  subject: string | null;
  difficulty: number | null;
  createdBy: number | null;
  status: 'draft' | 'published' | 'pending';
  source: 'manual' | 'import';
} {
  const images = Array.isArray(item.images)
    ? item.images
        .map((raw, i) => normalizeImageRef(raw, `img${i}`))
        .filter((x): x is QuestionImageRef => Boolean(x))
    : [];

  let stem = String(item.stem ?? '').trim();
  if (!stem) throw new Error('YAML 中存在缺少 stem 的题目');

  stem = expandImagePlaceholders(stem, images);

  const body: Record<string, unknown> = { ...(item.meta && typeof item.meta === 'object' ? item.meta : {}) };
  if (item.answer?.trim()) body.answerText = item.answer.trim();
  if (images.length) body.images = images;
  if (item.examPoints?.length) body.examPoints = item.examPoints;
  if (item.tagLabels?.length) body.tagLabels = item.tagLabels;
  if (item.scienceNodeIds?.length) body.scienceNodeIds = item.scienceNodeIds;
  if (item.notes?.trim()) body.notes = item.notes.trim();
  body.yamlImportedAt = new Date().toISOString();

  let difficulty: number | null = null;
  if (item.difficulty != null) {
    const n = Number(item.difficulty);
    if (!Number.isNaN(n) && n >= 1 && n <= 5) difficulty = Math.round(n);
  }

  const status =
    item.status === 'draft' || item.status === 'published' || item.status === 'pending'
      ? item.status
      : opts?.defaultStatus ?? 'published';

  return {
    title: item.title != null ? String(item.title).trim() || null : null,
    stem,
    body,
    subject:
      item.subject != null
        ? String(item.subject).trim() || null
        : opts?.defaultSubject?.trim() || null,
    difficulty,
    createdBy,
    status,
    source: item.source === 'manual' ? 'manual' : 'import',
  };
}

export function parseQuestionsYaml(text: string): QuestionYamlItem[] {
  const raw = text.trim();
  if (!raw) throw new Error('YAML 内容为空');

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (e) {
    throw new Error(`YAML 解析失败：${e instanceof Error ? e.message : '格式错误'}`);
  }

  if (Array.isArray(parsed)) {
    return parsed as QuestionYamlItem[];
  }

  const doc = parsed as QuestionYamlDocument;
  if (doc && Array.isArray(doc.questions)) {
    return doc.questions;
  }

  if (doc && typeof doc === 'object' && 'stem' in doc && typeof (doc as QuestionYamlItem).stem === 'string') {
    return [doc as QuestionYamlItem];
  }

  throw new Error('未识别 YAML 结构，需包含 questions 数组或使用本题单题格式');
}
