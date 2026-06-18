import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  FolderOpen,
  LayoutGrid,
  List,
  Loader2,
  Network,
  Plus,
  Search,
  Sparkles,
  TreeDeciduous,
} from 'lucide-react';
import {
  apiFetch,
  type GraphPayload,
  type JuniorScienceTreeNode,
  type JuniorScienceTreePayload,
  type PracticeCandidateRow,
  type ScienceMasteryPayload,
  type ScienceMatchRow,
} from '../services/api';
import { useAuth } from '../context/AuthContext';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import { PageChrome } from '../components/PageChrome';
import { syncPracticeQueue } from '../utils/practiceQueueSync';
import { OjStyleKnowledgeTreeCanvas } from '../components/OjStyleKnowledgeTreeCanvas';
import type { OjPlacedNode } from '../components/ojTreeLayout';

type MapTab = 'cooccur' | 'science' | 'zhongkao';
type CanvasTone = 'green' | 'blue' | 'gray';
type CanvasNode = {
  id: string;
  label: string;
  x: number;
  y: number;
  tone: CanvasTone;
  count?: number;
  small?: boolean;
  /** 有子节点时可点击展开 */
  expandable?: boolean;
  expanded?: boolean;
  isActive?: boolean;
};
type CanvasEdge = {
  id: string;
  from: string;
  to: string;
  tone: 'green' | 'blue' | 'muted';
  weight?: number;
};

const CANVAS_W = 1280;
const CANVAS_H = 920;
const SCIENCE_START_ID = '__science_start__';
/** 层与层之间的垂直间距（自下而上生长） */
const CANVAS_ROW_HEIGHT = 148;
const CANVAS_BASE_Y = 860;
const CANVAS_MARGIN_X = 72;
/** 相邻叶子节点最小水平间距 */
const CANVAS_NODE_GAP = 228;
/** 多棵年级树之间的间隔 */
const CANVAS_ROOT_GAP = 56;

/** 尚无学习记录时节点展示的完成度（初始为 0） */
const DEFAULT_MASTERY_SCORE = 0;

function clampLabel(label: string, max = 16) {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

function nodeTone(count: number, index: number): CanvasTone {
  if (count >= 3 || index < 2) return 'green';
  if (count > 0 || index < 8) return 'blue';
  return 'gray';
}

/** 0–100 完成度 → 节点配色 */
function canvasMasteryTone(mastery: number): CanvasTone {
  if (mastery >= 72) return 'green';
  if (mastery >= 40) return 'blue';
  return 'gray';
}

function edgePath(a: CanvasNode, b: CanvasNode) {
  const dx = Math.abs(a.x - b.x);
  const midY = (a.y + b.y) / 2;
  const bend = Math.max(28, Math.min(120, dx * 0.38));
  return `M ${a.x} ${a.y} C ${a.x} ${midY - bend}, ${b.x} ${midY + bend}, ${b.x} ${b.y}`;
}

function buildCooccurCanvas(nodes: GraphPayload['nodes'], edges: GraphPayload['edges']) {
  const ranked = [...nodes].sort((a, b) => b.count - a.count).slice(0, 16);
  const canvasNodes: CanvasNode[] = [
    { id: '__root__', label: '错题知识图谱', x: 490, y: 700, tone: 'green' },
    { id: '__hub__', label: ranked[0]?.label || '核心知识点', x: 490, y: 455, tone: 'green', count: ranked[0]?.count },
  ];

  const slots = [
    [398, 585],
    [610, 570],
    [322, 455],
    [664, 430],
    [265, 330],
    [720, 318],
    [402, 275],
    [575, 245],
    [205, 210],
    [770, 205],
    [510, 150],
    [640, 105],
    [360, 102],
    [170, 398],
    [830, 390],
  ] as const;

  ranked.slice(1).forEach((node, i) => {
    const [x, y] = slots[i] || [120 + ((i * 137) % 740), 120 + ((i * 89) % 430)];
    canvasNodes.push({
      id: node.id,
      label: node.label,
      x,
      y,
      tone: nodeTone(node.count, i),
      count: node.count,
      small: i > 8,
    });
  });

  const canvasEdges: CanvasEdge[] = [
    { id: '__root_hub__', from: '__root__', to: '__hub__', tone: 'green', weight: 3 },
  ];
  if (ranked[0]) {
    canvasEdges.push({ id: `hub-${ranked[0].id}`, from: '__hub__', to: ranked[0].id, tone: 'green', weight: 3 });
  }

  const ids = new Set(canvasNodes.map((n) => n.id));
  const used = new Set(canvasEdges.map((e) => e.id));
  for (const edge of [...edges].sort((a, b) => b.weight - a.weight)) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
    const id = `${edge.source}->${edge.target}`;
    if (used.has(id)) continue;
    canvasEdges.push({
      id,
      from: edge.source,
      to: edge.target,
      tone: edge.weight >= 3 ? 'green' : 'blue',
      weight: edge.weight,
    });
    used.add(id);
    if (canvasEdges.length > 28) break;
  }

  for (const node of canvasNodes.slice(2)) {
    if (!canvasEdges.some((e) => e.from === node.id || e.to === node.id)) {
      canvasEdges.push({ id: `fallback-${node.id}`, from: '__hub__', to: node.id, tone: node.tone === 'green' ? 'green' : 'blue', weight: 1 });
    }
  }

  return { canvasNodes, canvasEdges };
}

type ScienceTreeIndex = {
  byId: Map<string, JuniorScienceTreeNode>;
  roots: JuniorScienceTreeNode[];
};

function indexScienceTree(tree: JuniorScienceTreeNode[]): ScienceTreeIndex {
  const byId = new Map<string, JuniorScienceTreeNode>();
  const walk = (n: JuniorScienceTreeNode) => {
    byId.set(n.id, n);
    for (const c of n.children || []) walk(c);
  };
  tree.forEach(walk);
  return { byId, roots: tree };
}

function scienceNodeHasChildren(id: string, index: ScienceTreeIndex): boolean {
  if (id === SCIENCE_START_ID) return false;
  return Boolean(index.byId.get(id)?.children?.length);
}

type PlacedScienceNode = {
  id: string;
  label: string;
  parentId: string | null;
  depth: number;
  x: number;
  y: number;
};

/** 年级层兄弟节点 id（用于手风琴：同时只展开一条主枝） */
function scienceGradeSiblingIds(index: ScienceTreeIndex): string[] {
  return index.roots.map((r) => r.id);
}

function findParentInNode(node: JuniorScienceTreeNode, targetId: string): string | null {
  for (const c of node.children || []) {
    if (c.id === targetId) return node.id;
    const deeper = findParentInNode(c, targetId);
    if (deeper) return deeper;
  }
  return null;
}

function scienceParentId(index: ScienceTreeIndex, id: string): string | null {
  if (index.roots.some((r) => r.id === id)) return null;
  for (const r of index.roots) {
    const p = findParentInNode(r, id);
    if (p) return p;
  }
  return null;
}

function scienceSiblingIds(index: ScienceTreeIndex, id: string): string[] {
  const parentId = scienceParentId(index, id);
  if (parentId === null) return scienceGradeSiblingIds(index);
  const parent = index.byId.get(parentId);
  return (parent?.children || []).map((c) => c.id);
}

/** 收起某节点及其全部后代 */
function pruneScienceSubtree(index: ScienceTreeIndex, id: string, expanded: Set<string>): void {
  expanded.delete(id);
  const node = index.byId.get(id);
  for (const c of node?.children || []) pruneScienceSubtree(index, c.id, expanded);
}

/** 手风琴展开：同级只保留当前节点展开 */
function accordionToggleExpanded(
  index: ScienceTreeIndex,
  id: string,
  prev: Set<string>,
): Set<string> {
  const next = new Set(prev);
  if (next.has(id)) {
    pruneScienceSubtree(index, id, next);
    return next;
  }
  for (const sib of scienceSiblingIds(index, id)) {
    if (sib !== id) pruneScienceSubtree(index, sib, next);
  }
  next.add(id);
  return next;
}

/**
 * 自下而上树布局：父节点居中于子树；仅从年级根开始，点击后向上长出子枝。
 */
function layoutScienceSubtree(
  node: JuniorScienceTreeNode,
  depth: number,
  leftBound: number,
  expandedIds: Set<string>,
  out: PlacedScienceNode[],
  parentId: string | null,
): number {
  const children =
    expandedIds.has(node.id) && node.children?.length ? [...node.children] : [];
  const y = CANVAS_BASE_Y - depth * CANVAS_ROW_HEIGHT;

  if (children.length === 0) {
    const x = leftBound + CANVAS_NODE_GAP / 2;
    out.push({ id: node.id, label: node.label, parentId, depth, x, y });
    return CANVAS_NODE_GAP;
  }

  let cursor = leftBound;
  const childXs: number[] = [];
  for (const c of children) {
    const w = layoutScienceSubtree(c, depth + 1, cursor, expandedIds, out, node.id);
    const placed = out.find((p) => p.id === c.id);
    if (placed) childXs.push(placed.x);
    cursor += w;
  }
  const subtreeW = Math.max(CANVAS_NODE_GAP, cursor - leftBound);
  const x =
    childXs.length === 1
      ? childXs[0]
      : (childXs[0] + childXs[childXs.length - 1]) / 2;
  out.push({ id: node.id, label: node.label, parentId, depth, x, y });
  return subtreeW;
}

function buildExpandableScienceCanvas(
  tree: JuniorScienceTreeNode[],
  displayMastery: Record<string, number>,
  expandedIds: Set<string>,
  activeId: string | null,
) {
  const index = indexScienceTree(tree);
  const placed: PlacedScienceNode[] = [];
  let cursorX = CANVAS_MARGIN_X;

  for (const root of index.roots) {
    const w = layoutScienceSubtree(root, 0, cursorX, expandedIds, placed, null);
    cursorX += w + CANVAS_ROOT_GAP;
  }

  const canvasWidth = Math.max(CANVAS_W, cursorX + CANVAS_MARGIN_X);
  const canvasNodes: CanvasNode[] = placed.map((it) => {
    const mastery = displayMastery[it.id] ?? DEFAULT_MASTERY_SCORE;
    const expandable = scienceNodeHasChildren(it.id, index);
    return {
      id: it.id,
      label: it.label,
      x: it.x,
      y: it.y,
      tone: canvasMasteryTone(mastery),
      count: Math.round(mastery),
      small: it.depth >= 3,
      expandable,
      expanded: expandable && expandedIds.has(it.id),
      isActive: activeId === it.id,
    };
  });

  const canvasEdges: CanvasEdge[] = placed
    .filter((it) => it.parentId)
    .map((it) => {
      const mastery = displayMastery[it.id] ?? DEFAULT_MASTERY_SCORE;
      return {
        id: `e-${it.parentId}-${it.id}`,
        from: it.parentId!,
        to: it.id,
        tone: (mastery >= 72 ? 'green' : mastery >= 40 ? 'blue' : 'muted') as CanvasEdge['tone'],
        weight: Math.max(1, Math.round(mastery / 15)),
      };
    });

  const minY = placed.length ? Math.min(...placed.map((p) => p.y)) : CANVAS_BASE_Y;
  const canvasHeight = Math.max(CANVAS_H, CANVAS_BASE_Y + 72, CANVAS_BASE_Y - minY + 160);

  return { canvasNodes, canvasEdges, canvasHeight, canvasWidth };
}

/** 共现分析尚无错题数据时的空状态（不再展示与学科无关的占位示意图） */
function CooccurEmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/90 px-6 py-14 text-center shadow-inner">
      <Network className="mx-auto text-slate-400" size={40} strokeWidth={1.5} />
      <p className="mt-4 text-base font-semibold text-slate-800">暂无错题共现数据</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-600">
        在「错题录入」中完成分析并<strong>保存错题</strong>后，本页会根据你错题中的知识点自动生成共现关系图。
      </p>
      <p className="mt-4 text-xs text-slate-500">
        查看浙教版课纲与掌握度，请切换到上方「初中科学知识树」标签。
      </p>
    </div>
  );
}

function KnowledgeGraphCanvas({
  nodes,
  edges,
  caption,
  width = CANVAS_W,
  height = CANVAS_H,
  onNodeClick,
  showCompletion = false,
}: {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  caption?: string;
  width?: number;
  height?: number;
  onNodeClick?: (id: string) => void;
  /** 在节点上显示完成度进度条（知识树模式） */
  showCompletion?: boolean;
}) {
  const byId = new Map(nodes.map((n) => [n.id, n]));

  return (
    <div className="knowledge-map-frame knowledge-map-frame--tall">
      <div className="knowledge-map-canvas" style={{ width, height, minWidth: width }}>
        <svg className="knowledge-map-lines" viewBox={`0 0 ${width} ${height}`} aria-hidden>
          <defs>
            <filter id="lineGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {edges.map((edge) => {
            const a = byId.get(edge.from);
            const b = byId.get(edge.to);
            if (!a || !b) return null;
            return (
              <path
                key={edge.id}
                d={edgePath(a, b)}
                className={`knowledge-map-edge knowledge-map-edge-${edge.tone}`}
                strokeWidth={Math.max(2, Math.min(7, (edge.weight || 1) + 1))}
                filter={edge.tone === 'green' ? 'url(#lineGlow)' : undefined}
              />
            );
          })}
        </svg>
        {nodes.map((node) => {
          const interactive = Boolean(onNodeClick);
          const pct = Math.max(0, Math.min(100, node.count ?? 0));
          const title =
            showCompletion && node.count != null
              ? `${node.label} · 完成度 ${pct}${node.expandable ? (node.expanded ? ' · 点击收起' : ' · 点击展开') : ''}`
              : node.label;
          const inner = (
            <>
              {node.expandable ? (
                <span className="knowledge-map-plus" aria-hidden>
                  {node.expanded ? <ChevronDown size={12} strokeWidth={2.6} /> : <Plus size={12} strokeWidth={2.6} />}
                </span>
              ) : null}
              <span className="knowledge-map-label">{clampLabel(node.label, node.small ? 14 : 18)}</span>
              {showCompletion ? (
                <>
                  <span className="knowledge-map-mastery-track" aria-hidden>
                    <span className="knowledge-map-mastery-fill" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="knowledge-map-mastery-text">完成度 {pct}</span>
                </>
              ) : (
                <span className="knowledge-map-bar" />
              )}
            </>
          );
          const cls = `knowledge-map-node knowledge-map-node-${node.tone} ${node.small ? 'knowledge-map-node-small' : ''} ${showCompletion ? 'knowledge-map-node-with-mastery' : ''} ${interactive ? 'knowledge-map-node-interactive' : ''} ${node.isActive ? 'knowledge-map-node-active' : ''}`;

          if (interactive) {
            return (
              <button
                key={node.id}
                type="button"
                data-science-node={node.id}
                className={cls}
                style={{ left: node.x, top: node.y }}
                title={title}
                aria-expanded={node.expandable ? Boolean(node.expanded) : undefined}
                onClick={() => onNodeClick?.(node.id)}
              >
                {inner}
              </button>
            );
          }

          return (
            <div
              key={node.id}
              data-science-node={node.id}
              className={cls}
              style={{ left: node.x, top: node.y }}
              title={title}
            >
              {inner}
            </div>
          );
        })}
      </div>
      {caption ? <p className="knowledge-map-caption">{caption}</p> : null}
    </div>
  );
}

export function KnowledgeMapPage({ onBack }: { onBack: () => void }) {
  const { user, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<MapTab>('cooccur');
  const [graph, setGraph] = useState<GraphPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [aiMd, setAiMd] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !user) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch<GraphPayload>('/api/knowledge/graph');
        if (!cancelled) setGraph(data);
      } catch (e: unknown) {
        if (!cancelled) setErr(e instanceof Error ? e.message : '加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  const runAi = async () => {
    setAiErr(null);
    setAiBusy(true);
    try {
      const data = await apiFetch<{ markdown: string }>('/api/knowledge/ai-insight', { method: 'POST', body: '{}' });
      setAiMd(data.markdown);
    } catch (e: unknown) {
      setAiErr(e instanceof Error ? e.message : '生成失败');
    } finally {
      setAiBusy(false);
    }
  };

  if (!user) {
    return (
      <PageChrome title="知识关联" subtitle="登录后查看共现分析与知识树" onBack={onBack}>
        <div className="rounded-2xl border border-slate-200 bg-white/90 p-8 text-center text-slate-600 shadow-sm">
          请先登录后查看知识点关联与掌握度。
        </div>
      </PageChrome>
    );
  }

  const topNodes = graph?.nodes ? [...graph.nodes].sort((a, b) => b.count - a.count).slice(0, 24) : [];
  const topEdges = graph?.edges ? [...graph.edges].sort((a, b) => b.weight - a.weight).slice(0, 40) : [];
  const hasCooccurData = Boolean(graph && graph.nodes.length > 0);
  const cooccurCanvas = hasCooccurData ? buildCooccurCanvas(graph!.nodes, graph!.edges) : null;

  return (
    <PageChrome
      title="知识关联"
      subtitle="错题知识点共现 · 浙教版初中科学知识树与掌握度"
      onBack={onBack}
      subNav={
        <div className="mx-auto flex max-w-6xl flex-wrap gap-1 px-4">
          <button
            type="button"
            onClick={() => setTab('cooccur')}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === 'cooccur'
                ? 'border-indigo-600 text-indigo-700 bg-white'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Network size={18} />
            共现分析
          </button>
          <button
            type="button"
            onClick={() => setTab('science')}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === 'science'
                ? 'border-emerald-600 text-emerald-800 bg-white'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <TreeDeciduous size={18} />
            初中科学知识树
          </button>
          <button
            type="button"
            onClick={() => setTab('zhongkao')}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === 'zhongkao'
                ? 'border-rose-600 text-rose-800 bg-white'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <FolderOpen size={18} />
            中考专题
          </button>
        </div>
      }
    >
      <div className="space-y-8">
        {tab === 'cooccur' && (
          <>
            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="animate-spin text-indigo-600" size={32} />
              </div>
            ) : err ? (
              <p className="text-rose-600 text-sm">{err}</p>
            ) : (
              <>
                <section>
                  {hasCooccurData && cooccurCanvas ? (
                    <KnowledgeGraphCanvas
                      nodes={cooccurCanvas.canvasNodes}
                      edges={cooccurCanvas.canvasEdges}
                      caption={`基于 ${topNodes.length} 个高频知识点与 ${topEdges.length} 条共现关系生成；绿色表示当前复习主线，蓝色表示关联考点，灰色表示待补足方向。`}
                    />
                  ) : (
                    <CooccurEmptyState />
                  )}
                </section>

                <section className="rounded-lg border border-indigo-100 bg-white/85 p-4 space-y-3 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                        <h2 className="text-sm font-bold text-indigo-950 flex items-center gap-2">
                          <Sparkles size={16} className="text-indigo-600" />
                      AI 归纳（可选）
                    </h2>
                    <button
                      type="button"
                      disabled={aiBusy}
                      onClick={() => void runAi()}
                      className="text-sm font-medium rounded-lg bg-indigo-600 text-white px-3 py-2 hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2"
                    >
                      {aiBusy ? <Loader2 className="animate-spin" size={16} /> : null}
                      生成复习建议
                    </button>
                  </div>
                  <p className="text-xs text-indigo-900/70">
                    需在服务器环境变量中配置 <code className="font-mono">GEMINI_API_KEY</code>（与前端分析可共用）。
                  </p>
                  {aiErr && <p className="text-sm text-rose-600">{aiErr}</p>}
                  {aiMd && (
                    <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
                      <MarkdownRenderer content={aiMd} density="relaxed" />
                    </div>
                  )}
                </section>
              </>
            )}
          </>
        )}

        {tab === 'science' && <JuniorScienceTreeSection />}

        {tab === 'zhongkao' && <ZhongkaoTopicSection />}
      </div>
    </PageChrome>
  );
}

/**
 * 将数据库中已有掌握度与树结构结合，父节点取「自报 + 子平均」的折中，用于展示。
 */
function buildDisplayMastery(roots: JuniorScienceTreeNode[], raw: Record<string, number>): Record<string, number> {
  const get = (id: string) => raw[id];
  const out: Record<string, number> = {};

  function walk(n: JuniorScienceTreeNode): number {
    const ch = n.children || [];
    if (ch.length === 0) {
      const v = Math.round(get(n.id) ?? DEFAULT_MASTERY_SCORE);
      out[n.id] = v;
      return v;
    }
    const vals = ch.map(walk);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const self = get(n.id);
    const v =
      self !== undefined ? Math.round((Math.round(self) + avg) / 2) : Math.round(avg);
    out[n.id] = v;
    return v;
  }

  for (const r of roots) walk(r);
  return out;
}

function findScienceNodePath(roots: JuniorScienceTreeNode[], targetId: string): string[] | null {
  function walk(n: JuniorScienceTreeNode, path: string[]): string[] | null {
    const next = [...path, n.id];
    if (n.id === targetId) return next;
    for (const c of n.children || []) {
      const hit = walk(c, next);
      if (hit) return hit;
    }
    return null;
  }
  for (const r of roots) {
    const hit = walk(r, []);
    if (hit) return hit;
  }
  return null;
}

/** 掌握度 0–100 → 胶囊配色 */
function masteryTierScore(m: number): 'gray' | 'blue' | 'green' {
  if (m < 38) return 'gray';
  if (m < 72) return 'blue';
  return 'green';
}

function ScienceTreePill({
  node,
  mastery,
  wrong,
  correct,
  branch,
  onToggleBranch,
  highlighted,
}: {
  node: JuniorScienceTreeNode;
  mastery: number;
  wrong?: number;
  correct?: number;
  /** 有子树时可点击展开/收起 */
  branch?: { expanded: boolean };
  onToggleBranch?: () => void;
  highlighted?: boolean;
}) {
  const tier = masteryTierScore(mastery);
  const pct = Math.max(0, Math.min(100, Math.round(mastery)));

  const pill =
    tier === 'gray'
      ? 'border-slate-300 bg-slate-100/95 text-slate-600 shadow-sm'
      : tier === 'blue'
        ? 'border-sky-500 bg-sky-50 text-sky-950 shadow-sm ring-1 ring-sky-200/70'
        : 'border-emerald-500 bg-emerald-50 text-emerald-950 shadow-md ring-1 ring-emerald-300/80';

  const bar =
    tier === 'gray' ? 'bg-slate-300/90' : tier === 'blue' ? 'bg-sky-500' : 'bg-emerald-500';

  const interactive = Boolean(branch && onToggleBranch);

  return (
    <div
      data-science-node={node.id}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      className={`rounded-full border-2 px-4 py-2.5 text-center transition-all ${pill} max-w-[13rem] ${
        interactive ? 'cursor-pointer select-none hover:brightness-[1.02] active:scale-[0.99]' : ''
      } ${highlighted ? 'ring-2 ring-emerald-400 ring-offset-2' : ''}`}
      onClick={interactive ? () => onToggleBranch?.() : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onToggleBranch?.();
              }
            }
          : undefined
      }
    >
      <span className="flex items-center justify-center gap-1 text-xs font-semibold leading-snug">
        {branch ? (
          <span className="shrink-0 text-slate-500" aria-hidden>
            {branch.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        ) : null}
        {node.label}
      </span>
      <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-black/[0.06]">
        <div className={`h-full rounded-full transition-all duration-500 ${bar}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="mt-1.5 block text-[10px] font-semibold tabular-nums opacity-90">掌握度 {pct}</span>
      {(wrong || correct) && (
        <span className="mt-0.5 block text-[9px] text-slate-500">
          错 {wrong ?? 0} · 对 {correct ?? 0}
        </span>
      )}
    </div>
  );
}

/**
 * 自下而上建树（参考图：根在屏幕下方，向上分叉）。
 * DOM 顺序：上=子树区域，下=当前节点胶囊。
 */
function UpsideTower({
  node,
  displayMastery,
  stat,
  expanded,
  onToggle,
  highlightId,
}: {
  node: JuniorScienceTreeNode;
  displayMastery: Record<string, number>;
  stat: Record<string, { wrong: number; correct: number }>;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  highlightId?: string | null;
}) {
  const children = node.children || [];
  const m = displayMastery[node.id] ?? DEFAULT_MASTERY_SCORE;
  const st = stat[node.id];
  const isOpen = children.length > 0 && expanded.has(node.id);

  if (children.length === 0) {
    return (
      <ScienceTreePill
        node={node}
        mastery={m}
        wrong={st?.wrong}
        correct={st?.correct}
        highlighted={highlightId === node.id}
      />
    );
  }

  if (!isOpen) {
    return (
      <ScienceTreePill
        node={node}
        mastery={m}
        wrong={st?.wrong}
        correct={st?.correct}
        branch={{ expanded: false }}
        onToggleBranch={() => onToggle(node.id)}
        highlighted={highlightId === node.id}
      />
    );
  }

  return (
    <div className="flex flex-col items-center">
      <div className="flex flex-row flex-wrap items-end justify-center gap-x-12 gap-y-8 px-2">
        {children.map((c) => (
          <div key={c.id} className="flex flex-col items-center">
            <UpsideTower
              node={c}
              displayMastery={displayMastery}
              stat={stat}
              expanded={expanded}
              onToggle={onToggle}
              highlightId={highlightId}
            />
          </div>
        ))}
      </div>

      {children.length > 1 ? (
        <div className="relative mx-auto mt-0 flex h-7 w-full min-w-[10rem] max-w-2xl shrink-0 justify-center">
          <div className="absolute left-[5%] right-[5%] top-0 h-px bg-sky-500/90" aria-hidden />
          <div
            className="absolute left-1/2 top-0 h-7 w-px -translate-x-1/2 bg-gradient-to-b from-sky-500 via-teal-500 to-teal-600"
            aria-hidden
          />
        </div>
      ) : (
        <div
          className="mx-auto h-7 w-px shrink-0 bg-gradient-to-b from-sky-500 via-teal-500 to-teal-600"
          aria-hidden
        />
      )}

      <div className="mt-0 shrink-0 pt-0.5">
        <ScienceTreePill
          node={node}
          mastery={m}
          wrong={st?.wrong}
          correct={st?.correct}
          branch={{ expanded: true }}
          onToggleBranch={() => onToggle(node.id)}
          highlighted={highlightId === node.id}
        />
      </div>
    </div>
  );
}

/** 多根并列「森林」，自下而上树状布局 */
function OjReferenceStyleForest({
  tree,
  displayMastery,
  stat,
  expanded,
  onToggle,
  highlightId,
}: {
  tree: JuniorScienceTreeNode[];
  displayMastery: Record<string, number>;
  stat: Record<string, { wrong: number; correct: number }>;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  highlightId?: string | null;
}) {
  return (
    <div className="oj-knowledge-canvas relative st-oj-scroll rounded-2xl border border-slate-200/90 py-8 shadow-inner">
      <p className="mb-6 px-4 text-center text-[11px] leading-relaxed text-slate-500">
        自下而上展开 · 进度条为<strong>掌握度 0–100</strong>（错题命中扣分、做对加分；父节点为子树综合评估）。
        <span className="block mt-1 text-slate-400">点击带箭头的节点可展开/收起子知识点。</span>
      </p>
      <div className="flex min-w-max flex-row items-end justify-center gap-20 px-10 pb-2">
        {tree.map((root) => (
          <div key={root.id} className="flex flex-col items-center">
            <UpsideTower
              node={root}
              displayMastery={displayMastery}
              stat={stat}
              expanded={expanded}
              onToggle={onToggle}
              highlightId={highlightId}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function flattenScienceRows(roots: JuniorScienceTreeNode[]): { id: string; label: string; depth: number }[] {
  const out: { id: string; label: string; depth: number }[] = [];
  function walk(n: JuniorScienceTreeNode, depth: number) {
    out.push({ id: n.id, label: n.label, depth });
    for (const c of n.children || []) walk(c, depth + 1);
  }
  roots.forEach((r) => walk(r, 0));
  return out;
}

async function downloadScienceMasteryExport(): Promise<void> {
  const r = await fetch('/api/knowledge/export/science-mastery', { credentials: 'include' });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(txt.slice(0, 200) || `导出失败 (${r.status})`);
  }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'science-mastery.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function PracticeStrip({
  nodeId,
  nodeLabel,
  onRefresh,
  onClose,
}: {
  nodeId: string | null;
  nodeLabel?: string;
  onRefresh: () => Promise<void>;
  onClose: () => void;
}) {
  const [items, setItems] = useState<PracticeCandidateRow[]>([]);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!nodeId) {
      setItems([]);
      setIdx(0);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await apiFetch<{ items: PracticeCandidateRow[] }>(
          `/api/knowledge/practice-candidates?nodeId=${encodeURIComponent(nodeId)}&limit=12`,
        );
        if (!cancelled) {
          setItems(data.items);
          setIdx(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nodeId]);

  const current = items[idx];

  const submit = async (correct: boolean) => {
    if (!nodeId || !current) return;
    setBusy(true);
    try {
      await apiFetch<{ ok: boolean; duplicate?: boolean }>('/api/knowledge/practice', {
        method: 'POST',
        body: JSON.stringify({
          nodeIds: [nodeId],
          correct,
          clientDedupeKey: `p-${current.id}-${nodeId}-${correct}`,
        }),
      });
      await onRefresh();
      setIdx((i) => {
        if (items.length <= 1) return 0;
        return i + 1 >= items.length ? 0 : i + 1;
      });
    } catch (e: unknown) {
      try {
        const raw = localStorage.getItem('zhishitree_practice_queue');
        const prev = raw ? (JSON.parse(raw) as unknown[]) : [];
        prev.push({ nodeId, questionId: current.id, correct, at: Date.now() });
        localStorage.setItem('zhishitree_practice_queue', JSON.stringify(prev.slice(-40)));
      } catch {
        /* ignore */
      }
      alert(e instanceof Error ? e.message : '提交失败，已尝试记入本地队列');
    } finally {
      setBusy(false);
    }
  };

  if (!nodeId) return null;

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 space-y-3 shadow-sm">
      <div className="flex flex-wrap justify-between items-center gap-2">
        <h3 className="text-sm font-bold text-emerald-950">针对性练习 · {nodeLabel ?? nodeId}</h3>
        <button type="button" onClick={onClose} className="text-xs text-slate-500 hover:text-slate-800">
          关闭
        </button>
      </div>
      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="animate-spin text-emerald-600" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-xs leading-relaxed text-slate-600">
          题库中暂无自动关联题目。可在题库题目 JSON 中加入 <code className="font-mono text-[11px]">scienceNodeIds</code>{' '}
          数组包含当前知识点 id，或通过题干关键词命中知识树。
        </p>
      ) : (
        <>
          <p className="text-[11px] text-slate-500">
            第 {idx + 1} / {items.length} 题 · #{current.id}
          </p>
          <div className="text-sm text-slate-800 whitespace-pre-wrap rounded-lg border border-white bg-white p-3 shadow-inner">
            {current.stem}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit(true)}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              做对
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit(false)}
              className="rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            >
              做错
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ScienceDirectoryPanel({
  rows,
  displayMastery,
  detail,
  search,
  onSearchChange,
  filterBand,
  onFilterChange,
  highlightId,
  onPickPractice,
}: {
  rows: { id: string; label: string; depth: number }[];
  displayMastery: Record<string, number>;
  detail: ScienceMasteryPayload['detail'] | undefined;
  search: string;
  onSearchChange: (v: string) => void;
  filterBand: 'all' | 'weak' | 'strong';
  onFilterChange: (v: 'all' | 'weak' | 'strong') => void;
  highlightId: string | null;
  onPickPractice: (id: string, label: string) => void;
}) {
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !r.label.toLowerCase().includes(q) && !r.id.toLowerCase().includes(q)) return false;
      const eff = detail?.[r.id]?.effective ?? displayMastery[r.id] ?? DEFAULT_MASTERY_SCORE;
      if (filterBand === 'weak' && eff >= 55) return false;
      if (filterBand === 'strong' && eff < 72) return false;
      return true;
    });
  }, [rows, search, filterBand, detail, displayMastery]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-inner space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <Search size={16} className="text-slate-400 shrink-0" />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="flex-1 min-w-[12rem] rounded-lg border border-slate-200 px-3 py-2 text-sm"
          placeholder="搜索名称或节点 id…"
        />
        <select
          value={filterBand}
          onChange={(e) => onFilterChange(e.target.value as 'all' | 'weak' | 'strong')}
          className="rounded-lg border border-slate-200 px-2 py-2 text-sm shrink-0"
        >
          <option value="all">全部掌握度</option>
          <option value="weak">薄弱（eff {'<'} 55）</option>
          <option value="strong">熟练（eff ≥ 72）</option>
        </select>
      </div>
      <ul className="max-h-[420px] overflow-auto text-sm space-y-0 border border-slate-100 rounded-lg divide-y divide-slate-50">
        {filtered.map((r) => {
          const eff = Math.round(detail?.[r.id]?.effective ?? displayMastery[r.id] ?? DEFAULT_MASTERY_SCORE);
          const conf = detail?.[r.id]?.confidence;
          return (
            <li
              key={r.id}
              data-science-node={r.id}
              className={`flex flex-wrap items-center gap-2 px-3 py-2 ${highlightId === r.id ? 'bg-amber-50 ring-1 ring-amber-300' : ''}`}
              style={{ paddingLeft: `${12 + r.depth * 14}px` }}
            >
              <span className="flex-1 text-slate-800">{r.label}</span>
              <span className="tabular-nums text-xs text-slate-600">eff {eff}</span>
              {conf !== undefined ? (
                <span className="text-[10px] text-slate-400">置信 {Math.round(conf * 100)}%</span>
              ) : null}
              <button
                type="button"
                className="text-xs font-medium text-emerald-700 hover:underline"
                onClick={() => onPickPractice(r.id, r.label)}
              >
                练习
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type ScienceViewMode = 'graph' | 'list';

function JuniorScienceTreeSection() {
  const [tree, setTree] = useState<JuniorScienceTreeNode[] | null>(null);
  const [treeVersion, setTreeVersion] = useState<string | null>(null);
  const [masteryPayload, setMasteryPayload] = useState<ScienceMasteryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [probe, setProbe] = useState('');
  const [probeBusy, setProbeBusy] = useState(false);
  const [probeRes, setProbeRes] = useState<ScienceMatchRow[] | null>(null);
  const [probeErr, setProbeErr] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ScienceViewMode>('graph');
  const [listSearch, setListSearch] = useState('');
  const [listFilter, setListFilter] = useState<'all' | 'weak' | 'strong'>('all');
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [practiceNodeId, setPracticeNodeId] = useState<string | null>(null);
  const [practiceLabel, setPracticeLabel] = useState<string | undefined>();
  const [exportBusy, setExportBusy] = useState(false);
  const [branchExpanded, setBranchExpanded] = useState<Set<string>>(() => new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const forestScrollRef = useRef<HTMLDivElement>(null);

  const reloadMastery = useCallback(async () => {
    const m = await apiFetch<ScienceMasteryPayload>('/api/knowledge/science-mastery');
    setMasteryPayload(m);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const [t, m] = await Promise.all([
          apiFetch<JuniorScienceTreePayload>('/api/knowledge/junior-science-tree'),
          apiFetch<ScienceMasteryPayload>('/api/knowledge/science-mastery'),
        ]);
        if (!cancelled) {
          setTree(t.tree);
          setTreeVersion(t.version);
          setMasteryPayload(m);
          const synced = await syncPracticeQueue(apiFetch);
          if (synced > 0 && !cancelled) {
            setMasteryPayload(await apiFetch<ScienceMasteryPayload>('/api/knowledge/science-mastery'));
          }
        }
      } catch (e: unknown) {
        if (!cancelled) setErr(e instanceof Error ? e.message : '加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const scoreMapForRollup = useMemo(() => {
    if (!masteryPayload) return {};
    const out: Record<string, number> = {};
    if (masteryPayload.detail) {
      for (const [id, d] of Object.entries(masteryPayload.detail)) {
        out[id] = d.effective;
      }
    }
    for (const [id, v] of Object.entries(masteryPayload.mastery || {})) {
      if (out[id] === undefined) out[id] = v;
    }
    return out;
  }, [masteryPayload]);

  const displayMastery = useMemo(() => {
    if (!tree || !masteryPayload) return {};
    return buildDisplayMastery(tree, scoreMapForRollup);
  }, [tree, masteryPayload, scoreMapForRollup]);

  const flatRows = useMemo(() => (tree ? flattenScienceRows(tree) : []), [tree]);

  const toggleBranch = useCallback(
    (id: string) => {
      if (!tree) return;
      const index = indexScienceTree(tree);
      setHighlightId(id);
      setSelectedNodeId(id);
      if (!scienceNodeHasChildren(id, index)) return;
      setBranchExpanded((prev) => accordionToggleExpanded(index, id, prev));
    },
    [tree],
  );

  const selectNode = useCallback((id: string, _node: OjPlacedNode) => {
    setSelectedNodeId(id);
    setHighlightId(id);
  }, []);

  const practiceFromNode = useCallback((id: string, label: string) => {
    setPracticeNodeId(id);
    setPracticeLabel(label);
    setSelectedNodeId(id);
    setHighlightId(id);
  }, []);

  const revealPath = useCallback((pathIds: string[]) => {
    setBranchExpanded(new Set(pathIds));
  }, []);

  const runProbe = async () => {
    setProbeErr(null);
    setProbeBusy(true);
    try {
      const data = await apiFetch<{ matches: ScienceMatchRow[] }>('/api/knowledge/match-science', {
        method: 'POST',
        body: JSON.stringify({ text: probe, labels: [] }),
      });
      setProbeRes(data.matches);
    } catch (e: unknown) {
      setProbeErr(e instanceof Error ? e.message : '检测失败');
    } finally {
      setProbeBusy(false);
    }
  };

  const onExport = async () => {
    setExportBusy(true);
    try {
      await downloadScienceMasteryExport();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '导出失败');
    } finally {
      setExportBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="animate-spin text-emerald-600" size={32} />
      </div>
    );
  }

  if (err || !tree || !masteryPayload) {
    return <p className="text-rose-600 text-sm">{err || '数据异常'}</p>;
  }

  const verLabel = masteryPayload.treeVersion || treeVersion || '—';

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <p className="text-xs text-slate-500">
          课纲数据版本：<span className="font-mono text-slate-800">{verLabel}</span>
          <span className="mx-2 text-slate-300">|</span>
          知识树节点显示<strong>完成度 0–100</strong>（未学习为 0；错题扣分、练习做对加分；父节点综合子树）。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setViewMode('graph')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium ${
              viewMode === 'graph' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <LayoutGrid size={14} />
            知识树
          </button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium ${
              viewMode === 'list' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <List size={14} />
            目录索引
          </button>
          <button
            type="button"
            disabled={exportBusy}
            onClick={() => void onExport()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Download size={14} />
            {exportBusy ? '导出中…' : '导出 CSV'}
          </button>
        </div>
      </div>

      {viewMode === 'graph' && tree ? (
        <section className="space-y-3" ref={forestScrollRef}>
          <OjStyleKnowledgeTreeCanvas
            tree={tree}
            displayMastery={displayMastery}
            expandedIds={branchExpanded}
            highlightId={highlightId}
            selectedId={selectedNodeId}
            onToggleBranch={toggleBranch}
            onSelectNode={selectNode}
            onPracticeNode={practiceFromNode}
            onRevealPath={revealPath}
            caption={`参考 AI-OJ 知识树：干线侧枝布局 · 滚轮缩放拖拽平移 · ± 展开子节点 · 单击查看详情 · 双击叶子练习。同级手风琴仅展开一条主枝。已保存错题 ${masteryPayload.mistakeCount} 条。`}
          />
        </section>
      ) : null}

      {viewMode === 'list' && (
        <section>
          <ScienceDirectoryPanel
            rows={flatRows}
            displayMastery={displayMastery}
            detail={masteryPayload.detail}
            search={listSearch}
            onSearchChange={setListSearch}
            filterBand={listFilter}
            onFilterChange={setListFilter}
            highlightId={highlightId}
            onPickPractice={(id, label) => {
              setPracticeNodeId(id);
              setPracticeLabel(label);
              setHighlightId(id);
            }}
          />
        </section>
      )}

      <PracticeStrip
        nodeId={practiceNodeId}
        nodeLabel={practiceLabel}
        onRefresh={reloadMastery}
        onClose={() => {
          setPracticeNodeId(null);
          setPracticeLabel(undefined);
        }}
      />

      {viewMode === 'graph' && !practiceNodeId ? (
        <p className="text-xs text-slate-500">
          针对性练习：在知识树中<strong>双击叶子节点</strong>，或在节点详情中点「针对性练习」；也可在「目录索引」中点「练习」。
        </p>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-3 shadow-sm">
        <h2 className="text-sm font-bold text-slate-800">文本检测试测</h2>
        <p className="text-xs text-slate-500">
          粘贴一段题干或解析，查看会被映射到树上哪些节点（不写入错题库）。返回结果含简要命中依据。
        </p>
        <textarea
          className="w-full min-h-[100px] rounded-lg border border-slate-200 px-3 py-2 text-sm"
          value={probe}
          onChange={(e) => setProbe(e.target.value)}
          placeholder="例如：求固体密度、利用排水法测体积…"
        />
        <button
          type="button"
          disabled={probeBusy || !probe.trim()}
          onClick={() => void runProbe()}
          className="text-sm font-medium rounded-lg bg-emerald-600 text-white px-3 py-2 hover:bg-emerald-700 disabled:opacity-50"
        >
          {probeBusy ? '检测中…' : '映射到知识树'}
        </button>
        {probeErr && <p className="text-sm text-rose-600">{probeErr}</p>}
        {probeRes && probeRes.length === 0 && (
          <p className="text-sm text-slate-500">未匹配到节点，可尝试更贴近课纲的表述，或扩充 keywords。</p>
        )}
        {probeRes && probeRes.length > 0 && (
          <ul className="space-y-2 text-sm">
            {probeRes.slice(0, 16).map((m) => (
              <li key={m.id} className="border border-slate-100 rounded-lg px-3 py-2 bg-slate-50/80">
                <span className="font-medium text-slate-900">{m.label}</span>
                <span className="text-slate-400 text-xs ml-2">score {m.score}</span>
                <p className="text-xs text-slate-500 mt-0.5">{m.path}</p>
                {m.reasons && m.reasons.length > 0 ? (
                  <ul className="mt-2 list-disc pl-4 text-[11px] text-slate-600 space-y-0.5">
                    {m.reasons.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** 中考专题树：由本地资料目录生成，完成度与课纲树共用掌握度数据 */
function ZhongkaoTopicSection() {
  const [tree, setTree] = useState<JuniorScienceTreeNode[] | null>(null);
  const [treeVersion, setTreeVersion] = useState<string | null>(null);
  const [rootExists, setRootExists] = useState(true);
  const [rootLabel, setRootLabel] = useState('10.中考浙江科学');
  const [masteryPayload, setMasteryPayload] = useState<ScienceMasteryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [branchExpanded, setBranchExpanded] = useState<Set<string>>(() => new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [pickedRelPath, setPickedRelPath] = useState<string | null>(null);
  const [pickedLabel, setPickedLabel] = useState<string | null>(null);
  const forestScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const [t, m] = await Promise.all([
          apiFetch<JuniorScienceTreePayload>('/api/knowledge/zhongkao-topic-tree'),
          apiFetch<ScienceMasteryPayload>('/api/knowledge/science-mastery'),
        ]);
        if (!cancelled) {
          setTree(t.tree);
          setTreeVersion(t.version);
          setRootExists(t.rootExists !== false);
          setRootLabel(t.rootLabel || '10.中考浙江科学');
          setMasteryPayload(m);
        }
      } catch (e: unknown) {
        if (!cancelled) setErr(e instanceof Error ? e.message : '加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const scoreMapForRollup = useMemo(() => {
    if (!masteryPayload) return {};
    const out: Record<string, number> = {};
    if (masteryPayload.detail) {
      for (const [id, d] of Object.entries(masteryPayload.detail)) {
        out[id] = d.effective;
      }
    }
    for (const [id, v] of Object.entries(masteryPayload.mastery || {})) {
      if (out[id] === undefined) out[id] = v;
    }
    return out;
  }, [masteryPayload]);

  const displayMastery = useMemo(() => {
    if (!tree || !masteryPayload) return {};
    return buildDisplayMastery(tree, scoreMapForRollup);
  }, [tree, masteryPayload, scoreMapForRollup]);

  const toggleBranch = useCallback(
    (id: string) => {
      if (!tree) return;
      const index = indexScienceTree(tree);
      setSelectedNodeId(id);
      if (!scienceNodeHasChildren(id, index)) return;
      setBranchExpanded((prev) => accordionToggleExpanded(index, id, prev));
      setPickedRelPath(null);
      setPickedLabel(null);
    },
    [tree],
  );

  const selectNode = useCallback(
    (id: string, node: OjPlacedNode) => {
      setSelectedNodeId(id);
      if (node.relPath) {
        setPickedRelPath(node.relPath);
        setPickedLabel(node.label);
      } else {
        setPickedRelPath(null);
        setPickedLabel(null);
      }
    },
    [],
  );

  const revealPath = useCallback((pathIds: string[]) => {
    setBranchExpanded(new Set(pathIds));
  }, []);

  const openInMaterials = () => {
    if (pickedRelPath) {
      sessionStorage.setItem('zhongkaoOpenPath', pickedRelPath);
    }
    window.location.hash = '#/zhongkao';
  };

  const openFileLeaf = useCallback(
    (id: string, label: string) => {
      if (!tree) return;
      const node = indexScienceTree(tree).byId.get(id);
      const rel = node?.relPath;
      if (rel) {
        sessionStorage.setItem('zhongkaoOpenPath', rel);
        window.location.hash = '#/zhongkao';
        return;
      }
      setPickedRelPath(null);
      setPickedLabel(label);
    },
    [tree],
  );

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="animate-spin text-rose-600" size={32} />
      </div>
    );
  }

  if (err || !tree || !masteryPayload) {
    return <p className="text-rose-600 text-sm">{err || '数据异常'}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-100 bg-white px-4 py-3 shadow-sm">
        <p className="text-xs text-slate-600">
          专题树版本 <span className="font-mono text-slate-800">{treeVersion || '—'}</span>
          <span className="mx-2 text-slate-300">|</span>
          目录 <strong>{rootLabel}</strong>
          {!rootExists ? (
            <span className="ml-2 text-rose-600">（目录不存在，请放入项目根目录）</span>
          ) : null}
        </p>
        <button
          type="button"
          onClick={() => {
            window.location.hash = '#/zhongkao';
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-900 hover:bg-rose-100"
        >
          <FolderOpen size={14} />
          打开资料索引
        </button>
      </div>

      {!rootExists || tree.length === 0 ? (
        <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50/50 px-6 py-12 text-center text-sm text-slate-600">
          未扫描到资料目录。请将模考卷、专题等放入 <code className="font-mono text-xs">10.中考浙江科学</code> 后刷新。
        </div>
      ) : tree ? (
        <section className="space-y-3" ref={forestScrollRef}>
          <OjStyleKnowledgeTreeCanvas
            tree={tree}
            displayMastery={displayMastery}
            expandedIds={branchExpanded}
            selectedId={selectedNodeId}
            onToggleBranch={toggleBranch}
            onSelectNode={selectNode}
            onPracticeNode={openFileLeaf}
            onRevealPath={revealPath}
            caption="参考 AI-OJ 布局：按资料目录分层展示；单击文件节点可在下方跳转资料库。"
          />
        </section>
      ) : null}

      {pickedRelPath ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-900">{pickedLabel || pickedRelPath.split('/').pop()}</p>
            <p className="text-xs text-slate-500 font-mono break-all">{pickedRelPath}</p>
          </div>
          <button
            type="button"
            onClick={openInMaterials}
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
          >
            在资料库中打开
          </button>
        </div>
      ) : null}
    </div>
  );
}
