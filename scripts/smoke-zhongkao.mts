/**
 * 自动冒烟：中考资料 A/B/C（目录列表、专题树、预览；可选入库）
 * 用法：npx tsx scripts/smoke-zhongkao.mts [--ingest]
 */
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env') });
dotenv.config({ path: path.join(root, '.env.local') });

const API = process.env.SMOKE_API_BASE || 'http://127.0.0.1:8787';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-JWT_SECRET';
const doIngest = process.argv.includes('--ingest');

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
    throw new Error(`${p} 非 JSON: ${text.slice(0, 200)}`);
  }
  if (!r.ok) throw new Error(`${p} → ${r.status}: ${data.error || text.slice(0, 200)}`);
  return data as T;
}

type MaterialList = {
  rootExists: boolean;
  rootLabel: string;
  currentPath: string;
  items: { name: string; relPath: string; kind: string; ext?: string }[];
};

type TopicTree = {
  tree: { id: string; label: string; children?: unknown[] }[];
  version: string;
  rootExists: boolean;
  rootLabel: string;
};

function findFirstFile(items: MaterialList['items'], exts: RegExp): string | null {
  for (const it of items) {
    if (it.kind === 'file' && it.ext && exts.test(it.ext)) return it.relPath;
  }
  return null;
}

async function walkForFile(relDir = '', depth = 0): Promise<string | null> {
  if (depth > 4) return null;
  const listing = await api<MaterialList>(`/api/zhongkao/materials?path=${encodeURIComponent(relDir)}`);
  if (!listing.rootExists) return null;
  const hit =
    findFirstFile(listing.items, /\.(txt|md)$/i) ||
    findFirstFile(listing.items, /\.(docx|pdf)$/i);
  if (hit) return hit;
  for (const it of listing.items) {
    if (it.kind === 'dir') {
      const deeper = await walkForFile(it.relPath, depth + 1);
      if (deeper) return deeper;
    }
  }
  return null;
}

async function main() {
  console.log('\n=== 中考资料 A/B/C 冒烟测试 ===');
  console.log('API:', API);

  const health = await api<{ ok: boolean }>('/api/health');
  console.log('[OK] health', health);

  const listing = await api<MaterialList>('/api/zhongkao/materials');
  console.log('[OK] C 资料目录', {
    rootExists: listing.rootExists,
    rootLabel: listing.rootLabel,
    topItems: listing.items.length,
    sample: listing.items.slice(0, 3).map((x) => x.name),
  });

  const topic = await api<TopicTree>('/api/knowledge/zhongkao-topic-tree');
  const childCount = topic.tree[0]?.children?.length ?? 0;
  console.log('[OK] B 中考专题树', {
    version: topic.version,
    rootExists: topic.rootExists,
    topChildren: childCount,
  });

  if (!listing.rootExists) {
    console.warn('[SKIP] 资料目录不存在，跳过预览/入库');
    return;
  }

  const sampleFile = await walkForFile('');
  if (!sampleFile) {
    console.warn('[SKIP] 未找到可预览的 docx/pdf/txt');
  } else {
    const preview = await api<{ relPath: string; format: string; charCount: number; preview: string }>(
      `/api/zhongkao/materials/preview?relPath=${encodeURIComponent(sampleFile)}`,
    );
    console.log('[OK] C 预览', {
      file: sampleFile,
      format: preview.format,
      charCount: preview.charCount,
      previewHead: preview.preview.slice(0, 120).replace(/\s+/g, ' '),
    });

    if (doIngest) {
      const hasKey = Boolean(process.env.GEMINI_API_KEY?.trim());
      if (!hasKey) {
        console.warn('[SKIP] --ingest 需要 GEMINI_API_KEY');
      } else {
        console.log('[…] A 入库中（可能较慢）…', sampleFile);
        const ing = await api<{ count: number; batchKey: string; splitMethod: string; relPath: string }>(
          '/api/zhongkao/materials/ingest',
          {
            method: 'POST',
            body: JSON.stringify({
              relPath: sampleFile,
              useAiSplit: false,
              analyzeWithAi: true,
              defaultSubject: '初中科学',
            }),
          },
        );
        console.log('[OK] A 入库待审核', {
          count: ing.count,
          batchKey: ing.batchKey,
          splitMethod: ing.splitMethod,
        });
      }
    }
  }

  console.log('\n全部检查完成。\n');

  const ingestText = '1. 浮力大小与排开液体体积有关。\n2. 密度 ρ=m/V。';
  const ing = await api<{ count: number; batchKey: string; splitMethod: string }>(
    '/api/questions/paper-ingest-pending',
    {
      method: 'POST',
      body: JSON.stringify({
        text: ingestText,
        paperTitle: '冒烟测试-2题',
        defaultSubject: '初中科学',
        useAiSplit: false,
        analyzeWithAi: false,
      }),
    },
  );
  console.log('[OK] A 待审核入库', { count: ing.count, batchKey: ing.batchKey, splitMethod: ing.splitMethod });
}

main().catch((e) => {
  console.error('\n[FAIL]', e instanceof Error ? e.message : e);
  process.exit(1);
});
