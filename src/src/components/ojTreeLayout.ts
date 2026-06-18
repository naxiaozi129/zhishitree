import type { JuniorScienceTreeNode } from '../services/api';

export const OJ_NODE_W = 160;
export const OJ_NODE_H = 52;
export const OJ_BRANCH_GAP = 176;
export const OJ_ROW_STEP = 42;
export const OJ_MASTERY_LIT = 85;

export type OjPlacedNode = {
  id: string;
  label: string;
  parentId: string | null;
  x: number;
  y: number;
  depth: number;
  mastery: number;
  childCount: number;
  expanded: boolean;
  canCollapse: boolean;
  relPath?: string;
};

export type OjPlacedEdge = {
  id: string;
  fromId: string;
  toId: string;
  mastery: number;
};

type InternalNode = {
  id: string;
  label: string;
  parentId: string | null;
  depth: number;
  childCount: number;
  relPath?: string;
  children: InternalNode[];
  x: number;
  y: number;
  _branchWeight: number;
};

function collectVisible(
  nodes: JuniorScienceTreeNode[],
  expandedIds: Set<string>,
  parentId: string | null,
  depth: number,
  out: Omit<InternalNode, 'children' | 'x' | 'y' | '_branchWeight'>[],
) {
  for (const n of nodes) {
    const childCount = n.children?.length ?? 0;
    out.push({
      id: n.id,
      label: n.label,
      parentId,
      depth,
      childCount,
      relPath: n.relPath,
    });
    if (childCount > 0 && expandedIds.has(n.id)) {
      collectVisible(n.children!, expandedIds, n.id, depth + 1, out);
    }
  }
}

function buildHierarchy(
  flat: Omit<InternalNode, 'children' | 'x' | 'y' | '_branchWeight'>[],
): InternalNode[] {
  const map = new Map<string, InternalNode>();
  for (const f of flat) {
    map.set(f.id, { ...f, children: [], x: 0, y: 0, _branchWeight: 1 });
  }
  const roots: InternalNode[] = [];
  for (const n of map.values()) {
    if (n.parentId && map.has(n.parentId)) {
      map.get(n.parentId)!.children.push(n);
    } else {
      roots.push(n);
    }
  }
  return roots;
}

function estimateBranchWeight(node: InternalNode): number {
  if (!node.children.length) {
    node._branchWeight = 1;
    return 1;
  }
  let sideWeight = 0;
  node.children.forEach((child, index) => {
    const w = estimateBranchWeight(child);
    if (index > 0) sideWeight += w;
  });
  node._branchWeight = Math.max(1, sideWeight);
  return node._branchWeight;
}

function assignRouteLayout(node: InternalNode, x: number) {
  node.x = x;
  node.y = node.depth * OJ_ROW_STEP;
  const children = node.children;
  if (!children.length) return;

  const primary = children[0];
  if (primary) assignRouteLayout(primary, x);

  const sideChildren = children.slice(1);
  const left: InternalNode[] = [];
  const right: InternalNode[] = [];
  sideChildren.forEach((child, index) => {
    if (index % 2 === 0) right.push(child);
    else left.push(child);
  });

  let rightCursor = x;
  for (const child of right) {
    rightCursor += Math.max(1, child._branchWeight) * OJ_BRANCH_GAP;
    assignRouteLayout(child, rightCursor);
  }
  let leftCursor = x;
  for (const child of left) {
    leftCursor -= Math.max(1, child._branchWeight) * OJ_BRANCH_GAP;
    assignRouteLayout(child, leftCursor);
  }
}

function compressNonLeafTowardTrunk(nodes: InternalNode[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const node of nodes) {
    if (!node.parentId) continue;
    const parent = byId.get(node.parentId);
    if (!parent || parent.children.length <= 1) continue;
    if (!node.children.length) continue;
    const trunkX = parent.x;
    node.x = trunkX + (node.x - trunkX) * 0.22;
  }
}

function resolveCollisions(allNodes: InternalNode[]) {
  const bandHeight = OJ_NODE_H + 46;
  const minGap = (n: InternalNode) => (n.children.length ? OJ_NODE_W + 24 : OJ_NODE_W + 44);
  const bands = new Map<number, InternalNode[]>();
  for (const n of allNodes) {
    const key = Math.round(n.y / bandHeight);
    if (!bands.has(key)) bands.set(key, []);
    bands.get(key)!.push(n);
  }
  for (const band of bands.values()) {
    if (band.length <= 1) continue;
    const center = band.reduce((s, n) => s + n.x, 0) / band.length;
    for (let pass = 0; pass < 3; pass++) {
      band.sort((a, b) => a.x - b.x);
      for (let i = 1; i < band.length; i++) {
        const gap = Math.max(minGap(band[i - 1]), minGap(band[i]));
        if (band[i].x - band[i - 1].x < gap) band[i].x = band[i - 1].x + gap;
      }
      for (let i = band.length - 2; i >= 0; i--) {
        const gap = Math.max(minGap(band[i + 1]), minGap(band[i]));
        if (band[i + 1].x - band[i].x < gap) band[i].x = band[i + 1].x - gap;
      }
    }
    const shifted = band.reduce((s, n) => s + n.x, 0) / band.length;
    const offset = shifted - center;
    if (offset !== 0) band.forEach((n) => { n.x -= offset; });
  }
}

function flattenInternal(node: InternalNode, out: InternalNode[]) {
  out.push(node);
  for (const c of node.children) flattenInternal(c, out);
}

export function layoutOjKnowledgeTree(
  roots: JuniorScienceTreeNode[],
  expandedIds: Set<string>,
  displayMastery: Record<string, number>,
): { nodes: OjPlacedNode[]; edges: OjPlacedEdge[]; width: number; height: number } {
  const flat: Omit<InternalNode, 'children' | 'x' | 'y' | '_branchWeight'>[] = [];
  collectVisible(roots, expandedIds, null, 0, flat);
  if (!flat.length) {
    return { nodes: [], edges: [], width: 960, height: 640 };
  }

  const forest = buildHierarchy(flat);
  let cursorX = 0;
  const allInternal: InternalNode[] = [];

  for (const root of forest) {
    estimateBranchWeight(root);
    assignRouteLayout(root, cursorX);
    const subtree: InternalNode[] = [];
    flattenInternal(root, subtree);
    compressNonLeafTowardTrunk(subtree);
    resolveCollisions(subtree);
    allInternal.push(...subtree);
    const maxX = Math.max(...subtree.map((n) => n.x));
    const minX = Math.min(...subtree.map((n) => n.x));
    cursorX += maxX - minX + OJ_BRANCH_GAP * 1.2;
  }

  const nodes: OjPlacedNode[] = allInternal.map((n) => ({
    id: n.id,
    label: n.label,
    parentId: n.parentId,
    x: n.x,
    y: n.y,
    depth: n.depth,
    mastery: Math.round(displayMastery[n.id] ?? 0),
    childCount: n.childCount,
    expanded: expandedIds.has(n.id),
    canCollapse: n.childCount >= 5,
    relPath: n.relPath,
  }));

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: OjPlacedEdge[] = [];
  for (const n of nodes) {
    if (!n.parentId) continue;
    const parent = byId.get(n.parentId);
    if (!parent) continue;
    edges.push({
      id: `e-${n.parentId}-${n.id}`,
      fromId: n.parentId,
      toId: n.id,
      mastery: n.mastery,
    });
  }

  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const padX = OJ_NODE_W;
  const padY = OJ_NODE_H + 80;
  const width = Math.max(960, Math.max(...xs) - Math.min(...xs) + padX * 2);
  const height = Math.max(640, Math.max(...ys) * OJ_ROW_STEP + padY * 2);

  return { nodes, edges, width, height };
}

export function findNodePath(
  roots: JuniorScienceTreeNode[],
  targetId: string,
  path: string[] = [],
): string[] | null {
  for (const n of roots) {
    const next = [...path, n.id];
    if (n.id === targetId) return next;
    if (n.children?.length) {
      const hit = findNodePath(n.children, targetId, next);
      if (hit) return hit;
    }
  }
  return null;
}

export function flattenSearchRows(
  roots: JuniorScienceTreeNode[],
): { id: string; label: string; path: string }[] {
  const out: { id: string; label: string; path: string }[] = [];
  const walk = (n: JuniorScienceTreeNode, prefix: string) => {
    const p = prefix ? `${prefix} › ${n.label}` : n.label;
    out.push({ id: n.id, label: n.label, path: p });
    for (const c of n.children || []) walk(c, p);
  };
  roots.forEach((r) => walk(r, ''));
  return out;
}
