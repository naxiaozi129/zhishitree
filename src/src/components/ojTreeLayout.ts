import type { JuniorScienceTreeNode } from '../services/api';

export const OJ_NODE_W = 160;
export const OJ_NODE_H = 52;
export const OJ_NODE_GAP_X = 28;
export const OJ_NODE_GAP_Y = 20;
export const OJ_BRANCH_GAP = 176;
/** 行距须大于节点高度，否则相邻层级会垂直重叠 */
export const OJ_ROW_STEP = OJ_NODE_H + OJ_NODE_GAP_Y;
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

function minCenterGapX() {
  return OJ_NODE_W + OJ_NODE_GAP_X;
}

function minCenterGapY() {
  return OJ_NODE_H + OJ_NODE_GAP_Y;
}

/** 全局碰撞消解：同层水平推开 + 跨层矩形重叠检测 */
function resolveCollisions(allNodes: InternalNode[]) {
  if (allNodes.length <= 1) return;

  const gapX = minCenterGapX();
  const gapY = minCenterGapY();

  for (let pass = 0; pass < 16; pass++) {
    let moved = false;

    const byDepth = new Map<number, InternalNode[]>();
    for (const n of allNodes) {
      const row = byDepth.get(n.depth) ?? [];
      row.push(n);
      byDepth.set(n.depth, row);
    }
    for (const row of byDepth.values()) {
      if (row.length <= 1) continue;
      row.sort((a, b) => a.x - b.x);
      for (let i = 1; i < row.length; i++) {
        if (row[i].x - row[i - 1].x < gapX) {
          row[i].x = row[i - 1].x + gapX;
          moved = true;
        }
      }
    }

    for (let i = 0; i < allNodes.length; i++) {
      for (let j = i + 1; j < allNodes.length; j++) {
        const a = allNodes[i];
        const b = allNodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const overlapX = gapX - Math.abs(dx);
        const overlapY = gapY - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;
        const shift = overlapX / 2 + 1;
        if (dx >= 0) {
          a.x -= shift;
          b.x += shift;
        } else {
          a.x += shift;
          b.x -= shift;
        }
        moved = true;
      }
    }

    if (!moved) break;
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
    allInternal.push(...subtree);
    const maxX = Math.max(...subtree.map((n) => n.x));
    const minX = Math.min(...subtree.map((n) => n.x));
    cursorX += maxX - minX + minCenterGapX();
  }

  resolveCollisions(allInternal);

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
  const height = Math.max(640, Math.max(...ys) + OJ_NODE_H + padY);

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
