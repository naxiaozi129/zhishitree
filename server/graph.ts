export interface AnalysisShape {
  knowledgePoints?: string[];
  knowledgeTree?: { node: string; children: unknown[] }[];
  summary?: string;
}

function childLabel(c: unknown): string | null {
  if (typeof c === 'string') return c.trim() || null;
  if (c && typeof c === 'object' && 'node' in c) {
    const n = (c as { node?: string }).node;
    return n ? String(n).trim() : null;
  }
  return null;
}

export function extractNodesFromAnalysis(a: AnalysisShape): string[] {
  const set = new Set<string>();
  for (const k of a.knowledgePoints || []) {
    const t = String(k).trim();
    if (t) set.add(t);
  }
  for (const tree of a.knowledgeTree || []) {
    if (tree?.node) set.add(String(tree.node).trim());
    for (const c of tree?.children || []) {
      const ct = childLabel(c);
      if (ct) set.add(ct);
    }
  }
  return [...set];
}

export function buildCooccurrenceGraph(rows: { analysis_json: string }[]) {
  const nodeCount = new Map<string, number>();
  const edgeCount = new Map<string, number>();

  const pairKey = (a: string, b: string) => (a < b ? `${a}\0${b}` : `${b}\0${a}`);

  for (const row of rows) {
    let analysis: AnalysisShape;
    try {
      analysis = JSON.parse(row.analysis_json) as AnalysisShape;
    } catch {
      continue;
    }
    const nodes = [...new Set(extractNodesFromAnalysis(analysis))].sort();
    for (const n of nodes) {
      nodeCount.set(n, (nodeCount.get(n) || 0) + 1);
    }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const k = pairKey(nodes[i], nodes[j]);
        edgeCount.set(k, (edgeCount.get(k) || 0) + 1);
      }
    }
  }

  const nodes = [...nodeCount.entries()].map(([label, count]) => ({ id: label, label, count }));
  const edges = [...edgeCount.entries()].map(([k, weight]) => {
    const [a, b] = k.split('\0');
    return { source: a, target: b, weight };
  });

  return { nodes, edges };
}
