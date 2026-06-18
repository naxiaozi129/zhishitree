import { extractNodesFromAnalysis, type AnalysisShape } from './graph.js';
import { JUNIOR_SCIENCE_TREE, type ScienceTreeNode } from './juniorScienceTreeData.js';

export type FlatScienceNode = {
  id: string;
  label: string;
  path: string;
  keywords: string[];
};

export type ScienceMatch = {
  id: string;
  label: string;
  path: string;
  score: number;
};

function collectKeywords(n: ScienceTreeNode): string[] {
  const own = n.keywords ? [...n.keywords] : [];
  if (!own.includes(n.label)) own.unshift(n.label);
  return own;
}

export function flattenJuniorScienceTree(
  nodes: ScienceTreeNode[] = JUNIOR_SCIENCE_TREE,
  parentPath = '',
): FlatScienceNode[] {
  const out: FlatScienceNode[] = [];
  for (const n of nodes) {
    const path = parentPath ? `${parentPath} › ${n.label}` : n.label;
    const keywords = collectKeywords(n);
    out.push({ id: n.id, label: n.label, path, keywords });
    if (n.children?.length) {
      out.push(...flattenJuniorScienceTree(n.children, path));
    }
  }
  return out;
}

let _flatCache: FlatScienceNode[] | null = null;

export function getFlatScienceNodes(): FlatScienceNode[] {
  if (!_flatCache) _flatCache = flattenJuniorScienceTree();
  return _flatCache;
}

/** 去空白便于中文包含匹配 */
function compact(s: string): string {
  return s.replace(/\s+/g, '').trim();
}

function scoreAgainstQuery(query: string, node: FlatScienceNode): number {
  const q = compact(query);
  if (!q) return 0;
  let s = 0;
  const labelC = compact(node.label);
  if (labelC.length >= 2 && q.includes(labelC)) s += 100;
  else if (labelC.length >= 4) {
    const head = labelC.slice(0, 4);
    if (q.includes(head)) s += 45;
  }
  for (const kw of node.keywords) {
    const k = compact(kw);
    if (k.length < 2) continue;
    if (q.includes(k)) s += 38;
    else if (k.length >= 4 && q.includes(k.slice(0, 4))) s += 18;
  }
  return s;
}

const MATCH_THRESHOLD = 28;

/**
 * 对一段文本（摘要 + 知识点列表拼接）做匹配，返回达到阈值的节点，按分数降序。
 */
export function matchTextToScienceTree(text: string, limit = 24): ScienceMatch[] {
  const flat = getFlatScienceNodes();
  const scored = flat
    .map((node) => {
      const score = scoreAgainstQuery(text, node);
      return score >= MATCH_THRESHOLD
        ? { id: node.id, label: node.label, path: node.path, score }
        : null;
    })
    .filter((x): x is ScienceMatch => x !== null);
  scored.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const uniq: ScienceMatch[] = [];
  for (const m of scored) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    uniq.push(m);
    if (uniq.length >= limit) break;
  }
  return uniq;
}

/**
 * 针对多条自由表述的知识点标签分别打分，合并取每个 id 的最高分。
 */
/** 合并多路匹配结果，同一节点保留最高分 */
export function mergeScienceMatches(groups: ScienceMatch[][]): ScienceMatch[] {
  const merged = new Map<string, ScienceMatch>();
  for (const group of groups) {
    for (const m of group) {
      const prev = merged.get(m.id);
      if (!prev || prev.score < m.score) merged.set(m.id, m);
    }
  }
  return [...merged.values()].sort((a, b) => b.score - a.score);
}

export function matchLabelsToScienceTree(labels: string[]): ScienceMatch[] {
  const flat = getFlatScienceNodes();
  const best = new Map<string, ScienceMatch>();
  for (const raw of labels) {
    const label = String(raw).trim();
    if (!label) continue;
    for (const node of flat) {
      const score = scoreAgainstQuery(label, node);
      if (score < MATCH_THRESHOLD) continue;
      const prev = best.get(node.id);
      const next = { id: node.id, label: node.label, path: node.path, score };
      if (!prev || prev.score < score) best.set(node.id, next);
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

/**
 * 结合摘要全文 + 提取的知识点，生成合并匹配结果（用于单题展示）。
 */
/** 与错题分析映射使用同一文本拼接，便于解释命中依据 */
export function analysisMatchBlob(analysis: AnalysisShape): string {
  const labels = extractNodesFromAnalysis(analysis);
  const summary = typeof analysis.summary === 'string' ? analysis.summary : '';
  return [summary, ...labels].join('\n');
}

export function matchAnalysisToScienceTree(analysis: AnalysisShape): ScienceMatch[] {
  const labels = extractNodesFromAnalysis(analysis);
  const summary = typeof analysis.summary === 'string' ? analysis.summary : '';
  const blob = [summary, ...labels].join('\n');
  const fromText = matchTextToScienceTree(blob, 40);
  const fromLabels = matchLabelsToScienceTree(labels);
  const merged = new Map<string, ScienceMatch>();
  for (const m of [...fromText, ...fromLabels]) {
    const prev = merged.get(m.id);
    if (!prev || prev.score < m.score) merged.set(m.id, m);
  }
  return [...merged.values()].sort((a, b) => b.score - a.score);
}

export type ScienceMatchRich = ScienceMatch & { reasons: string[] };

/** 为每条匹配生成简短可读的命中依据（关键词 / 节点名） */
export function enrichMatchesWithReasons(text: string, matches: ScienceMatch[]): ScienceMatchRich[] {
  const flat = getFlatScienceNodes();
  const byId = new Map(flat.map((n) => [n.id, n]));
  const q = compact(text);
  return matches.map((m) => {
    const node = byId.get(m.id);
    const reasons: string[] = [];
    if (node) {
      const labelC = compact(node.label);
      if (labelC.length >= 2 && q.includes(labelC)) reasons.push(`文本中包含节点名称「${node.label}」`);
      if (labelC.length >= 4 && reasons.length === 0 && q.includes(labelC.slice(0, 4))) {
        reasons.push(`文本前缀匹配「${node.label.slice(0, 4)}…」`);
      }
      for (const kw of node.keywords) {
        const k = compact(kw);
        if (k.length >= 2 && q.includes(k)) reasons.push(`关键词「${kw}」`);
      }
    }
    return { ...m, reasons: reasons.slice(0, 8) };
  });
}

/** 统计用户在错题中命中各知识树节点的次数（每题每个 id 最多计 1 次） */
export function buildScienceTreeCoverage(rows: { analysis_json: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    let analysis: AnalysisShape;
    try {
      analysis = JSON.parse(row.analysis_json) as AnalysisShape;
    } catch {
      continue;
    }
    const matches = matchAnalysisToScienceTree(analysis);
    const ids = new Set(matches.map((m) => m.id));
    for (const id of ids) {
      counts.set(id, (counts.get(id) || 0) + 1);
    }
  }
  return counts;
}
