import { db } from './db.js';

/** 每道错题映射到的知识点扣分（可环境变量覆盖） */
const WRONG_DELTA = () => Number(process.env.SCIENCE_WRONG_DELTA || 8);
/** 做对一题加分 */
const CORRECT_DELTA = () => Number(process.env.SCIENCE_CORRECT_DELTA || 6);
/** 错题时间衰减：半衰期（天），越久错题对「展示掌握度」影响越小 */
const DECAY_HALF_LIFE_DAYS = () => Number(process.env.SCIENCE_DECAY_HALF_LIFE_DAYS || 21);
/** 初始掌握度（中性） */
export const DEFAULT_MASTERY = 50;

export function ensureScienceMasteryTable(): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS science_mastery (
  user_id INTEGER NOT NULL,
  node_id TEXT NOT NULL,
  mastery REAL NOT NULL,
  wrong_count INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, node_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_science_mastery_user ON science_mastery(user_id);
`);
}

ensureScienceMasteryTable();

function scienceMasteryColumnNames(): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(science_mastery)`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

function ensureScienceMasteryExtraColumns(): void {
  const n = scienceMasteryColumnNames();
  if (!n.has('last_wrong_at')) db.exec(`ALTER TABLE science_mastery ADD COLUMN last_wrong_at TEXT`);
  if (!n.has('last_correct_at')) db.exec(`ALTER TABLE science_mastery ADD COLUMN last_correct_at TEXT`);
  if (!n.has('streak_correct')) db.exec(`ALTER TABLE science_mastery ADD COLUMN streak_correct INTEGER NOT NULL DEFAULT 0`);
  if (!n.has('exposure_count')) db.exec(`ALTER TABLE science_mastery ADD COLUMN exposure_count INTEGER NOT NULL DEFAULT 0`);
}

ensureScienceMasteryExtraColumns();

/** 练习幂等：同一 dedupe_key 在窗口内只生效一次 */
export function ensureSciencePracticeDedupeTable(): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS science_practice_dedupe (
  user_id INTEGER NOT NULL,
  dedupe_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, dedupe_key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_practice_dedupe_created ON science_practice_dedupe(created_at);
`);
}

/** 用户标记「本题不该映射到该知识点」后，不再对该错题重复扣分（纠错后续入库仍会跳过该组合） */
export function ensureScienceMappingRejectTable(): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS science_mapping_reject (
  user_id INTEGER NOT NULL,
  mistake_id INTEGER NOT NULL,
  node_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, mistake_id, node_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (mistake_id) REFERENCES mistakes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_mapping_reject_user ON science_mapping_reject(user_id);
`);
}

ensureSciencePracticeDedupeTable();
ensureScienceMappingRejectTable();

export type MasteryDetailRow = {
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

export function getMasteryRow(
  userId: number,
  nodeId: string,
): { mastery: number; wrong_count: number; correct_count: number } | undefined {
  const row = db
    .prepare('SELECT mastery, wrong_count, correct_count FROM science_mastery WHERE user_id = ? AND node_id = ?')
    .get(userId, nodeId) as { mastery: number; wrong_count: number; correct_count: number } | undefined;
  return row;
}

function clampMastery(v: number): number {
  return Math.max(0, Math.min(100, v));
}

/** 基于最近一次错题时间的展示衰减（不改变库存 raw mastery） */
export function computeEffectiveMastery(
  raw: number,
  lastWrongAt: string | null,
  lastCorrectAt: string | null,
): number {
  let e = raw;
  if (lastWrongAt) {
    const tWrong = new Date(lastWrongAt).getTime();
    const days = Math.max(0, (Date.now() - tWrong) / 86400000);
    const half = DECAY_HALF_LIFE_DAYS();
    const decay = Math.pow(0.5, days / Math.max(1, half));
    const bump = (1 - decay) * 12;
    e = clampMastery(raw + bump);
  }
  if (lastCorrectAt && lastWrongAt) {
    const tc = new Date(lastCorrectAt).getTime();
    const tw = new Date(lastWrongAt).getTime();
    if (tc > tw) {
      const streakBonus = Math.min(8, Math.max(0, e * 0.05));
      e = clampMastery(e + streakBonus * 0.5);
    }
  }
  return Math.round(e * 10) / 10;
}

function computeConfidence(wrong: number, correct: number, exposure: number): number {
  const n = wrong + correct + exposure * 0.25;
  return Math.round((Math.min(1, n / 24) * 100)) / 100;
}

export function getScienceMasteryMap(userId: number): Map<string, number> {
  const rows = db
    .prepare('SELECT node_id, mastery FROM science_mastery WHERE user_id = ?')
    .all(userId) as { node_id: string; mastery: number }[];
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.node_id, r.mastery);
  return m;
}

export function getScienceMasteryDetail(userId: number): Map<string, MasteryDetailRow> {
  const rows = db
    .prepare(
      `SELECT node_id, mastery, wrong_count, correct_count,
              last_wrong_at, last_correct_at, streak_correct, exposure_count
       FROM science_mastery WHERE user_id = ?`,
    )
    .all(userId) as {
    node_id: string;
    mastery: number;
    wrong_count: number;
    correct_count: number;
    last_wrong_at: string | null;
    last_correct_at: string | null;
    streak_correct: number;
    exposure_count: number;
  }[];
  const m = new Map<string, MasteryDetailRow>();
  for (const r of rows) {
    const exposure = r.exposure_count ?? 0;
    const effective = computeEffectiveMastery(r.mastery, r.last_wrong_at, r.last_correct_at);
    const confidence = computeConfidence(r.wrong_count, r.correct_count, exposure);
    m.set(r.node_id, {
      mastery: r.mastery,
      wrong_count: r.wrong_count,
      correct_count: r.correct_count,
      last_wrong_at: r.last_wrong_at,
      last_correct_at: r.last_correct_at,
      streak_correct: r.streak_correct ?? 0,
      exposure_count: exposure,
      effective,
      confidence,
    });
  }
  return m;
}

/** 查询某道错题下用户已否决的节点 id */
export function getRejectedNodeIdsForMistake(userId: number, mistakeId: number): Set<string> {
  const rows = db
    .prepare(
      'SELECT node_id FROM science_mapping_reject WHERE user_id = ? AND mistake_id = ?',
    )
    .all(userId, mistakeId) as { node_id: string }[];
  return new Set(rows.map((r) => r.node_id));
}

export function insertMappingReject(userId: number, mistakeId: number, nodeId: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO science_mapping_reject (user_id, mistake_id, node_id) VALUES (?, ?, ?)`,
  ).run(userId, mistakeId, nodeId);
}

/** 纠错：否决映射时退回一次错题扣分 */
export function refundWrongDelta(userId: number, nodeId: string): void {
  const d = WRONG_DELTA();
  const sel = db.prepare(
    'SELECT mastery FROM science_mastery WHERE user_id = ? AND node_id = ?',
  ).get(userId, nodeId) as { mastery: number } | undefined;
  if (!sel) return;
  db.prepare(
    `UPDATE science_mastery SET mastery = ?, updated_at = datetime('now') WHERE user_id = ? AND node_id = ?`,
  ).run(clampMastery(sel.mastery + d), userId, nodeId);
}

/** 错题命中：降低掌握度 */
export function applyScienceWrong(userId: number, nodeIds: string[]): void {
  const ids = [...new Set(nodeIds)].filter(Boolean);
  if (ids.length === 0) return;
  const d = WRONG_DELTA();
  const sel = db.prepare(
    'SELECT mastery, wrong_count, exposure_count FROM science_mastery WHERE user_id = ? AND node_id = ?',
  );
  const ins = db.prepare(
    `INSERT INTO science_mastery (user_id, node_id, mastery, wrong_count, correct_count,
      streak_correct, exposure_count, last_wrong_at, updated_at)
     VALUES (?, ?, ?, 1, 0, 0, 1, datetime('now'), datetime('now'))`,
  );
  const upd = db.prepare(
    `UPDATE science_mastery SET mastery = ?, wrong_count = wrong_count + 1,
      streak_correct = 0, exposure_count = exposure_count + 1,
      last_wrong_at = datetime('now'), updated_at = datetime('now')
     WHERE user_id = ? AND node_id = ?`,
  );

  const tx = db.transaction(() => {
    for (const nid of ids) {
      const prev = sel.get(userId, nid) as
        | { mastery: number; wrong_count: number; exposure_count: number }
        | undefined;
      if (!prev) {
        const start = clampMastery(DEFAULT_MASTERY - d);
        ins.run(userId, nid, start);
      } else {
        upd.run(clampMastery(prev.mastery - d), userId, nid);
      }
    }
  });
  tx();
}

/** 练习做对：提升掌握度 */
export function applyScienceCorrect(userId: number, nodeIds: string[]): void {
  const ids = [...new Set(nodeIds)].filter(Boolean);
  if (ids.length === 0) return;
  const d = CORRECT_DELTA();
  const sel = db.prepare(
    'SELECT mastery, correct_count, streak_correct, exposure_count FROM science_mastery WHERE user_id = ? AND node_id = ?',
  );
  const ins = db.prepare(
    `INSERT INTO science_mastery (user_id, node_id, mastery, wrong_count, correct_count,
      streak_correct, exposure_count, last_correct_at, updated_at)
     VALUES (?, ?, ?, 0, 1, 1, 1, datetime('now'), datetime('now'))`,
  );
  const upd = db.prepare(
    `UPDATE science_mastery SET mastery = ?, correct_count = correct_count + 1,
      streak_correct = streak_correct + 1, exposure_count = exposure_count + 1,
      last_correct_at = datetime('now'), updated_at = datetime('now')
     WHERE user_id = ? AND node_id = ?`,
  );

  const tx = db.transaction(() => {
    for (const nid of ids) {
      const prev = sel.get(userId, nid) as
        | { mastery: number; correct_count: number; streak_correct: number; exposure_count: number }
        | undefined;
      if (!prev) {
        const start = clampMastery(DEFAULT_MASTERY + d);
        ins.run(userId, nid, start);
      } else {
        upd.run(clampMastery(prev.mastery + d), userId, nid);
      }
    }
  });
  tx();
}

/** 若已存在相同 dedupe_key 则返回 false（不应再应用加减分） */
export function tryConsumePracticeDedupe(userId: number, dedupeKey: string): boolean {
  const trimmed = dedupeKey.trim().slice(0, 128);
  if (!trimmed) return true;
  try {
    const r = db
      .prepare(`INSERT INTO science_practice_dedupe (user_id, dedupe_key) VALUES (?, ?)`)
      .run(userId, trimmed);
    return r.changes > 0;
  } catch {
    return false;
  }
}
