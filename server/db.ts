import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = process.env.DATABASE_PATH || path.join(dataDir, 'zhishitree.db');
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mistakes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  analysis_json TEXT NOT NULL,
  summary_preview TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mistakes_user_id ON mistakes(user_id);
`);

function mistakeColumnNames(): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(mistakes)`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

/** 错题思维交流：学生自述错因与 AI 会话快照 */
export function ensureMistakeReflectionColumns(): void {
  const names = mistakeColumnNames();
  if (!names.has('reflection_text')) {
    db.exec(`ALTER TABLE mistakes ADD COLUMN reflection_text TEXT`);
  }
  if (!names.has('reflection_session')) {
    db.exec(`ALTER TABLE mistakes ADD COLUMN reflection_session TEXT`);
  }
}

ensureMistakeReflectionColumns();

db.exec(`
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  stem TEXT NOT NULL,
  body_json TEXT NOT NULL DEFAULT '{}',
  subject TEXT,
  difficulty INTEGER,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_questions_subject ON questions(subject);
CREATE INDEX IF NOT EXISTS idx_questions_created_at ON questions(created_at DESC);
`);

function questionColumnNames(): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(questions)`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

function ensureQuestionExtraColumns(): void {
  const names = questionColumnNames();
  if (!names.has('status')) {
    db.exec(`ALTER TABLE questions ADD COLUMN status TEXT NOT NULL DEFAULT 'published'`);
  }
  if (!names.has('source')) {
    db.exec(`ALTER TABLE questions ADD COLUMN source TEXT`);
  }
}

ensureQuestionExtraColumns();

db.exec(`CREATE INDEX IF NOT EXISTS idx_questions_status ON questions(status)`);

function userColumnNames(): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

/** 用户审核与三级角色：user | question_admin | super_admin */
export function ensureUserApprovalColumns(): void {
  const names = userColumnNames();
  if (!names.has('approved')) {
    db.exec(`ALTER TABLE users ADD COLUMN approved INTEGER NOT NULL DEFAULT 0`);
    db.exec(`UPDATE users SET approved = 1`);
  }
  db.exec(`UPDATE users SET role = 'super_admin' WHERE role = 'admin'`);
}

ensureUserApprovalColumns();

export type UserRow = {
  id: number;
  username: string;
  password_hash: string;
  role: string;
  approved: number;
  created_at: string;
};

export type PublicUserRow = {
  id: number;
  username: string;
  role: string;
  approved: boolean;
  created_at: string;
};

export function getUserByUsername(username: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username) as UserRow | undefined;
}

export function createUser(
  username: string,
  passwordHash: string,
  role = 'user',
  approved = false,
): number {
  const r = db
    .prepare('INSERT INTO users (username, password_hash, role, approved) VALUES (?, ?, ?, ?)')
    .run(username, passwordHash, role, approved ? 1 : 0);
  return Number(r.lastInsertRowid);
}

export function getUserById(id: number): PublicUserRow | undefined {
  const row = db
    .prepare('SELECT id, username, role, approved, created_at FROM users WHERE id = ?')
    .get(id) as { id: number; username: string; role: string; approved: number; created_at: string } | undefined;
  if (!row) return undefined;
  return { ...row, approved: Boolean(row.approved) };
}

export function countUsers(): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
  return row.c;
}

export function countSuperAdmins(): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM users WHERE role IN ('admin', 'super_admin')`)
    .get() as { c: number };
  return row.c;
}

export function updateUserAdminFields(
  id: number,
  patch: { role?: string; approved?: boolean },
): PublicUserRow | null {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.role !== undefined) {
    sets.push('role = ?');
    params.push(patch.role);
  }
  if (patch.approved !== undefined) {
    sets.push('approved = ?');
    params.push(patch.approved ? 1 : 0);
  }
  if (sets.length === 0) return getUserById(id) ?? null;
  params.push(id);
  const r = db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  if (r.changes === 0) return null;
  return getUserById(id) ?? null;
}

export type QuestionRow = {
  id: number;
  title: string | null;
  stem: string;
  body_json: string;
  subject: string | null;
  difficulty: number | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  status: string;
  source: string | null;
};

export type QuestionListFilter = {
  subject?: string;
  q?: string;
  status?: 'draft' | 'published' | 'pending' | 'all';
  limit?: number;
  offset?: number;
};

function likePattern(raw: string): string {
  const t = raw.trim().replace(/[%_\\]/g, '');
  if (!t) return '';
  return `%${t}%`;
}

export function countQuestions(filter: Pick<QuestionListFilter, 'subject' | 'q' | 'status'>): number {
  let sql = 'SELECT COUNT(*) AS c FROM questions WHERE 1 = 1';
  const params: unknown[] = [];
  if (filter.subject?.trim()) {
    sql += ' AND subject = ?';
    params.push(filter.subject.trim());
  }
  if (filter.status === 'draft') {
    sql += " AND status = 'draft'";
  } else if (filter.status === 'published') {
    sql += " AND status = 'published'";
  } else if (filter.status === 'pending') {
    sql += " AND status = 'pending'";
  }
  const pat = filter.q ? likePattern(filter.q) : '';
  if (pat) {
    sql += ' AND (title LIKE ? OR stem LIKE ?)';
    params.push(pat, pat);
  }
  const row = db.prepare(sql).get(...params) as { c: number };
  return row.c;
}

export function listQuestions(filter: QuestionListFilter): QuestionRow[] {
  const limit = Math.min(Math.max(Number(filter.limit) || 50, 1), 200);
  const offset = Math.max(Number(filter.offset) || 0, 0);
  let sql =
    'SELECT id, title, stem, body_json, subject, difficulty, created_by, created_at, updated_at, status, source FROM questions WHERE 1 = 1';
  const params: unknown[] = [];
  if (filter.subject?.trim()) {
    sql += ' AND subject = ?';
    params.push(filter.subject.trim());
  }
  if (filter.status === 'draft') {
    sql += " AND status = 'draft'";
  } else if (filter.status === 'published') {
    sql += " AND status = 'published'";
  } else if (filter.status === 'pending') {
    sql += " AND status = 'pending'";
  }
  const pat = filter.q ? likePattern(filter.q) : '';
  if (pat) {
    sql += ' AND (title LIKE ? OR stem LIKE ?)';
    params.push(pat, pat);
  }
  sql += ' ORDER BY id DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return db.prepare(sql).all(...params) as QuestionRow[];
}

/** YAML 导出：允许更大 limit */
export function listQuestionsForExport(filter: QuestionListFilter & { limit?: number }): QuestionRow[] {
  const limit = Math.min(Math.max(Number(filter.limit) || 2000, 1), 5000);
  return listQuestions({ ...filter, limit, offset: filter.offset ?? 0 });
}

export function getQuestionById(id: number): QuestionRow | undefined {
  return db
    .prepare(
      'SELECT id, title, stem, body_json, subject, difficulty, created_by, created_at, updated_at, status, source FROM questions WHERE id = ?',
    )
    .get(id) as QuestionRow | undefined;
}

export function createQuestion(input: {
  title?: string | null;
  stem: string;
  body?: Record<string, unknown>;
  subject?: string | null;
  difficulty?: number | null;
  createdBy: number | null;
  status?: 'draft' | 'published' | 'pending';
  source?: 'manual' | 'import';
}): number {
  const bodyJson = JSON.stringify(input.body ?? {});
  const status = input.status ?? 'published';
  const source = input.source ?? 'manual';
  const r = db
    .prepare(
      `INSERT INTO questions (title, stem, body_json, subject, difficulty, created_by, status, source, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
    .run(
      input.title ?? null,
      input.stem.trim(),
      bodyJson,
      input.subject ?? null,
      input.difficulty ?? null,
      input.createdBy,
      status,
      source,
    );
  return Number(r.lastInsertRowid);
}

export function bulkCreateQuestions(
  items: Array<{
    title?: string | null;
    stem: string;
    body?: Record<string, unknown>;
    subject?: string | null;
    difficulty?: number | null;
    createdBy: number | null;
    status: 'draft' | 'published' | 'pending';
    source: 'manual' | 'import';
  }>,
): number[] {
  const stmt = db.prepare(
    `INSERT INTO questions (title, stem, body_json, subject, difficulty, created_by, status, source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  );
  const ids: number[] = [];
  const tx = db.transaction(() => {
    for (const input of items) {
      const r = stmt.run(
        input.title ?? null,
        input.stem.trim(),
        JSON.stringify(input.body ?? {}),
        input.subject ?? null,
        input.difficulty ?? null,
        input.createdBy,
        input.status,
        input.source,
      );
      ids.push(Number(r.lastInsertRowid));
    }
  });
  tx();
  return ids;
}

export function updateQuestion(
  id: number,
  patch: Partial<{
    title: string | null;
    stem: string;
    body: Record<string, unknown>;
    subject: string | null;
    difficulty: number | null;
    status: 'draft' | 'published' | 'pending';
  }>,
): boolean {
  const cols: string[] = [];
  const vals: unknown[] = [];
  if ('title' in patch) {
    cols.push('title = ?');
    vals.push(patch.title);
  }
  if ('stem' in patch && typeof patch.stem === 'string') {
    cols.push('stem = ?');
    vals.push(patch.stem.trim());
  }
  if ('body' in patch && patch.body !== undefined) {
    cols.push('body_json = ?');
    vals.push(JSON.stringify(patch.body));
  }
  if ('subject' in patch) {
    cols.push('subject = ?');
    vals.push(patch.subject);
  }
  if ('difficulty' in patch) {
    cols.push('difficulty = ?');
    vals.push(patch.difficulty);
  }
  if ('status' in patch && patch.status !== undefined) {
    cols.push('status = ?');
    vals.push(patch.status);
  }
  if (cols.length === 0) return false;
  cols.push("updated_at = datetime('now')");
  const sql = `UPDATE questions SET ${cols.join(', ')} WHERE id = ?`;
  vals.push(id);
  const r = db.prepare(sql).run(...vals);
  return r.changes > 0;
}

export function deleteQuestion(id: number): boolean {
  const r = db.prepare('DELETE FROM questions WHERE id = ?').run(id);
  return r.changes > 0;
}

/** 批量删除；可选仅删除指定 status（如 pending） */
export function bulkDeleteQuestions(ids: number[], opts?: { status?: string }): number {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  if (unique.length === 0) return 0;
  const placeholders = unique.map(() => '?').join(',');
  let sql = `DELETE FROM questions WHERE id IN (${placeholders})`;
  const params: (number | string)[] = [...unique];
  if (opts?.status) {
    sql += ' AND status = ?';
    params.push(opts.status);
  }
  return db.prepare(sql).run(...params).changes;
}

db.exec(`
CREATE TABLE IF NOT EXISTS ai_model_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'gemini',
  model_id TEXT NOT NULL,
  api_key_enc TEXT NOT NULL,
  base_url TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_model_configs_enabled ON ai_model_configs(enabled, is_default DESC);
`);

export type AiModelConfigRow = {
  id: number;
  name: string;
  provider: string;
  model_id: string;
  api_key_enc: string;
  base_url: string | null;
  enabled: number;
  is_default: number;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export function listAiModelConfigs(): AiModelConfigRow[] {
  return db
    .prepare(
      `SELECT id, name, provider, model_id, api_key_enc, base_url, enabled, is_default, note, created_at, updated_at
       FROM ai_model_configs ORDER BY is_default DESC, id ASC`,
    )
    .all() as AiModelConfigRow[];
}

export function getAiModelConfigById(id: number): AiModelConfigRow | undefined {
  return db
    .prepare(
      `SELECT id, name, provider, model_id, api_key_enc, base_url, enabled, is_default, note, created_at, updated_at
       FROM ai_model_configs WHERE id = ?`,
    )
    .get(id) as AiModelConfigRow | undefined;
}

export function createAiModelConfig(input: {
  name: string;
  provider: string;
  modelId: string;
  apiKeyEnc: string;
  baseUrl?: string | null;
  enabled?: boolean;
  isDefault?: boolean;
  note?: string | null;
}): number {
  const tx = db.transaction(() => {
    if (input.isDefault) {
      db.prepare(`UPDATE ai_model_configs SET is_default = 0`).run();
    }
    const r = db
      .prepare(
        `INSERT INTO ai_model_configs (name, provider, model_id, api_key_enc, base_url, enabled, is_default, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.name,
        input.provider,
        input.modelId,
        input.apiKeyEnc,
        input.baseUrl ?? null,
        input.enabled === false ? 0 : 1,
        input.isDefault ? 1 : 0,
        input.note ?? null,
      );
    const newId = Number(r.lastInsertRowid);
    const count = (db.prepare(`SELECT COUNT(*) AS c FROM ai_model_configs`).get() as { c: number }).c;
    if (count === 1) {
      db.prepare(`UPDATE ai_model_configs SET is_default = 1 WHERE id = ?`).run(newId);
    }
    return newId;
  });
  return tx();
}

export function updateAiModelConfig(
  id: number,
  patch: {
    name?: string;
    provider?: string;
    modelId?: string;
    apiKeyEnc?: string;
    baseUrl?: string | null;
    enabled?: boolean;
    isDefault?: boolean;
    note?: string | null;
  },
): boolean {
  const tx = db.transaction(() => {
    if (patch.isDefault) {
      db.prepare(`UPDATE ai_model_configs SET is_default = 0`).run();
    }
    const cols: string[] = [];
    const vals: unknown[] = [];
    if (patch.name !== undefined) {
      cols.push('name = ?');
      vals.push(patch.name);
    }
    if (patch.provider !== undefined) {
      cols.push('provider = ?');
      vals.push(patch.provider);
    }
    if (patch.modelId !== undefined) {
      cols.push('model_id = ?');
      vals.push(patch.modelId);
    }
    if (patch.apiKeyEnc !== undefined) {
      cols.push('api_key_enc = ?');
      vals.push(patch.apiKeyEnc);
    }
    if (patch.baseUrl !== undefined) {
      cols.push('base_url = ?');
      vals.push(patch.baseUrl);
    }
    if (patch.enabled !== undefined) {
      cols.push('enabled = ?');
      vals.push(patch.enabled ? 1 : 0);
    }
    if (patch.isDefault !== undefined) {
      cols.push('is_default = ?');
      vals.push(patch.isDefault ? 1 : 0);
    }
    if (patch.note !== undefined) {
      cols.push('note = ?');
      vals.push(patch.note);
    }
    if (cols.length === 0) return false;
    cols.push("updated_at = datetime('now')");
    const sql = `UPDATE ai_model_configs SET ${cols.join(', ')} WHERE id = ?`;
    vals.push(id);
    const r = db.prepare(sql).run(...vals);
    return r.changes > 0;
  });
  return tx();
}

export function deleteAiModelConfig(id: number): boolean {
  const tx = db.transaction(() => {
    const row = getAiModelConfigById(id);
    if (!row) return false;
    const r = db.prepare(`DELETE FROM ai_model_configs WHERE id = ?`).run(id);
    if (r.changes > 0 && row.is_default === 1) {
      const next = db
        .prepare(`SELECT id FROM ai_model_configs WHERE enabled = 1 ORDER BY id ASC LIMIT 1`)
        .get() as { id: number } | undefined;
      if (next) {
        db.prepare(`UPDATE ai_model_configs SET is_default = 1 WHERE id = ?`).run(next.id);
      }
    }
    return r.changes > 0;
  });
  return tx();
}

export function setDefaultAiModelConfig(id: number): boolean {
  const tx = db.transaction(() => {
    const row = getAiModelConfigById(id);
    if (!row) return false;
    db.prepare(`UPDATE ai_model_configs SET is_default = 0`).run();
    db.prepare(`UPDATE ai_model_configs SET is_default = 1, enabled = 1, updated_at = datetime('now') WHERE id = ?`).run(
      id,
    );
    return true;
  });
  return tx();
}

db.exec(`
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

export function getSystemSettingJson<T>(key: string): T | null {
  const row = db
    .prepare(`SELECT value_json FROM system_settings WHERE key = ?`)
    .get(key) as { value_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    return null;
  }
}

export function setSystemSettingJson(key: string, value: unknown): void {
  db.prepare(
    `INSERT INTO system_settings (key, value_json, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = datetime('now')`,
  ).run(key, JSON.stringify(value));
}
