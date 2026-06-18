import fs from 'node:fs';
import path from 'node:path';
import type { ScienceTreeNode } from './zhejiangScienceTree2024.js';
import { getZhongkaoMaterialsRoot, slugId } from './zhongkaoMaterials.js';

export const ZHONGKAO_TOPIC_TREE_VERSION = 'materials.v1';

const SKIP_DIR = new Set(['.git', 'node_modules']);

function keywordsFromLabel(label: string): string[] {
  const clean = label.replace(/\.(docx|doc|pdf|txt)$/i, '').trim();
  const parts = clean.split(/[\s_\-—·、，,（）()]+/).filter((p) => p.length >= 2);
  const out = [clean.slice(0, 24), ...parts.slice(0, 8)];
  return [...new Set(out)].slice(0, 10);
}

function fileToLeaf(relPath: string, fileName: string): ScienceTreeNode {
  const label = fileName.replace(/\.(docx|doc|pdf)$/i, '');
  const id = `zk.${slugId(relPath.replace(/[/\\]/g, '_'))}`;
  return { id, label, keywords: keywordsFromLabel(label), relPath };
}

function scanDir(absDir: string, relDir: string, depth: number, maxDepth: number): ScienceTreeNode[] {
  if (depth > maxDepth) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIR.has(e.name));
  const files = entries.filter((e) => e.isFile() && /\.(docx|doc|pdf)$/i.test(e.name));

  const nodes: ScienceTreeNode[] = [];

  for (const d of dirs.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))) {
    const rel = relDir ? `${relDir}/${d.name}` : d.name;
    const childAbs = path.join(absDir, d.name);
    const children = scanDir(childAbs, rel, depth + 1, maxDepth);
    const id = `zk.${slugId(rel)}`;
    nodes.push({
      id,
      label: d.name,
      keywords: keywordsFromLabel(d.name),
      children: children.length > 0 ? children : undefined,
    });
  }

  if (depth >= maxDepth - 1) {
    for (const f of files.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN')).slice(0, 40)) {
      const rel = relDir ? `${relDir}/${f.name}` : f.name;
      nodes.push(fileToLeaf(rel, f.name));
    }
  }

  return nodes;
}

let cached: { tree: ScienceTreeNode[]; version: string; builtAt: number } | null = null;
const CACHE_MS = 60_000;

/** 由本地「10.中考浙江科学」目录结构生成中考专题树（最多 3 层目录 + 叶子文件） */
export function buildZhongkaoTopicTree(force = false): {
  tree: ScienceTreeNode[];
  version: string;
  rootExists: boolean;
  rootLabel: string;
} {
  const root = getZhongkaoMaterialsRoot();
  const rootExists = fs.existsSync(root);
  const now = Date.now();

  if (!force && cached && now - cached.builtAt < CACHE_MS) {
    return {
      tree: cached.tree,
      version: cached.version,
      rootExists,
      rootLabel: path.basename(root),
    };
  }

  if (!rootExists) {
    cached = { tree: [], version: ZHONGKAO_TOPIC_TREE_VERSION, builtAt: now };
    return { tree: [], version: ZHONGKAO_TOPIC_TREE_VERSION, rootExists: false, rootLabel: path.basename(root) };
  }

  const children = scanDir(root, '', 0, 3);
  const tree: ScienceTreeNode[] = [
    {
      id: 'zk.root',
      label: '中考浙江科学',
      keywords: ['中考', '浙江', '科学', '复习'],
      children,
    },
  ];

  cached = { tree, version: ZHONGKAO_TOPIC_TREE_VERSION, builtAt: now };
  return { tree, version: ZHONGKAO_TOPIC_TREE_VERSION, rootExists: true, rootLabel: path.basename(root) };
}
