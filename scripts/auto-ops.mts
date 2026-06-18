/**
 * 自动运维：清理乱码待审核题、验证拆题、重启后冒烟
 * 用法：npx tsx scripts/auto-ops.mts
 */
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { splitExamPaperHeuristic, heuristicSplitLooksBroken } from '../server/importPaper.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env') });
dotenv.config({ path: path.join(root, '.env.local') });

const API = process.env.SMOKE_API_BASE || 'http://127.0.0.1:8787';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-JWT_SECRET';
const token = jwt.sign({ sub: 1, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

async function api<T>(p: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API}${p}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Cookie: `token=${token}`,
      ...(init?.headers as Record<string, string>),
    },
  });
  const text = await r.text();
  let data: T & { error?: string };
  try {
    data = JSON.parse(text) as T & { error?: string };
  } catch {
    throw new Error(`${p} 非 JSON (${r.status}): ${text.slice(0, 160)}`);
  }
  if (!r.ok) throw new Error(`${p} → ${r.status}: ${data.error || text.slice(0, 160)}`);
  return data as T;
}

function looksBrokenStem(stem: string): boolean {
  const s = stem.trim();
  if (s.length < 35) return true;
  const first = s.split('\n')[0]?.trim() ?? '';
  if (/^\d[\d.]*(?:\s+[\d./°%]+)*\s*(?:米\/秒|m\/s|厘米|cm|°|V|A|Ω|N)?\s*$/i.test(first)) return true;
  const zh = (s.match(/[\u4e00-\u9fff]/g) || []).length;
  if (s.length < 55 && zh < 8) return true;
  return false;
}

const sampleExam = `一、选择题（本大题共15小题，每小题3分，共45分）
1．下列有关科学说法正确的是（  ）
A. 选项一
B. 选项二

2．关于浮力的说法，正确的是（  ）
A. 浮力方向竖直向上

二、解答题
3．（8分）小明研究滑块运动，测得数据如下：
3.2 米/秒
3.2 米/秒
33 厘米
30 °
（1）实验前小明需要估测水平轨道上滑行长度 L。
（2）请计算平均速度。`;

async function waitHealth(maxMs = 45000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      await api<{ ok: boolean }>('/api/health');
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw new Error('API 未在时限内就绪，请先运行 npm run dev:all');
}

async function main() {
  console.log('\n=== 自动运维 ===\n');

  const localItems = splitExamPaperHeuristic(sampleExam);
  console.log('[OK] 本地拆题验证', {
    count: localItems.length,
    broken: heuristicSplitLooksBroken(localItems, sampleExam),
    titles: localItems.map((x) => x.stem.slice(0, 40).replace(/\n/g, ' ')),
  });

  await waitHealth();
  console.log('[OK] API 健康检查');

  const dbPath = path.join(root, 'data', 'zhishitree.db');
  const db = new Database(dbPath);
  const pending = db
    .prepare('SELECT id, stem FROM questions WHERE status = ? ORDER BY id')
    .all('pending') as { id: number; stem: string }[];

  const brokenIds = pending.filter((q) => looksBrokenStem(q.stem)).map((q) => q.id);
  console.log('[INFO] 待审核', pending.length, '条，疑似乱码', brokenIds.length, '条', brokenIds);

  if (brokenIds.length > 0) {
    const del = await api<{ ok: boolean; count: number }>('/api/questions/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ ids: brokenIds, onlyPending: true }),
    });
    console.log('[OK] 已批量删除乱码待审核', del.count, '条');
  }

  const preview = await api<{ method: string; count: number; items: { stem: string }[] }>(
    '/api/questions/preview-split',
    {
      method: 'POST',
      body: JSON.stringify({ text: sampleExam, useAi: false }),
    },
  );
  console.log('[OK] API 预览拆题', {
    method: preview.method,
    count: preview.count,
    heads: preview.items.map((x) => x.stem.slice(0, 50).replace(/\n/g, ' ')),
  });

  db.close();
  console.log('\n全部自动操作完成。\n');
}

main().catch((e) => {
  console.error('\n[FAIL]', e instanceof Error ? e.message : e);
  process.exit(1);
});
