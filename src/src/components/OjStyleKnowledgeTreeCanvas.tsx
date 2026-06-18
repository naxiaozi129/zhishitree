import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, ZoomIn } from 'lucide-react';
import type { JuniorScienceTreeNode } from '../services/api';
import {
  OJ_MASTERY_LIT,
  OJ_NODE_H,
  OJ_NODE_W,
  findNodePath,
  flattenSearchRows,
  layoutOjKnowledgeTree,
  type OjPlacedNode,
} from './ojTreeLayout';

const TRACK_W = 80;

function masteryStyle(score: number) {
  if (score >= OJ_MASTERY_LIT) {
    return { fill: '#d1fae5', stroke: '#34d399', bar: '#34d399', link: '#34d399', text: '#065f46' };
  }
  if (score >= 50) {
    return { fill: '#dbeafe', stroke: '#60a5fa', bar: '#60a5fa', link: '#60a5fa', text: '#1e3a8a' };
  }
  if (score >= 20) {
    return { fill: '#f8fafc', stroke: '#cbd5e1', bar: '#94a3b8', link: '#cbd5e1', text: '#475569' };
  }
  return { fill: '#f8fafc', stroke: '#e2e8f0', bar: '#cbd5e1', link: '#e2e8f0', text: '#64748b' };
}

function linkPath(x1: number, y1: number, x2: number, y2: number): string {
  const midY = (y1 + y2) / 2;
  return `M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`;
}

function clampLabel(label: string, max = 16): string {
  return label.length > max ? `${label.slice(0, max)}…` : label;
}

export type OjStyleKnowledgeTreeCanvasProps = {
  tree: JuniorScienceTreeNode[];
  displayMastery: Record<string, number>;
  expandedIds: Set<string>;
  highlightId?: string | null;
  selectedId?: string | null;
  onToggleBranch: (id: string) => void;
  onSelectNode: (id: string, node: OjPlacedNode) => void;
  onPracticeNode: (id: string, label: string) => void;
  onRevealPath?: (pathIds: string[]) => void;
  caption?: string;
};

export function OjStyleKnowledgeTreeCanvas({
  tree,
  displayMastery,
  expandedIds,
  highlightId,
  selectedId,
  onToggleBranch,
  onSelectNode,
  onPracticeNode,
  onRevealPath,
  caption,
}: OjStyleKnowledgeTreeCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ w: 960, h: 640 });
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 0.85 });
  const [search, setSearch] = useState('');
  const [searchHits, setSearchHits] = useState<{ id: string; label: string; path: string }[]>([]);
  const dragRef = useRef<{ px: number; py: number; tx: number; ty: number } | null>(null);

  const searchRows = useMemo(() => flattenSearchRows(tree), [tree]);

  const layout = useMemo(
    () => layoutOjKnowledgeTree(tree, expandedIds, displayMastery),
    [tree, expandedIds, displayMastery],
  );

  const byId = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout.nodes]);

  const contentOffset = useMemo(() => {
    if (!layout.nodes.length) return { ox: 480, oy: layout.height - 100 };
    const xs = layout.nodes.map((n) => n.x);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const maxDepth = Math.max(...layout.nodes.map((n) => n.depth));
    return {
      ox: (minX + maxX) / 2,
      oy: maxDepth * 42 + 60,
    };
  }, [layout]);

  const toSvg = useCallback(
    (n: OjPlacedNode) => ({
      x: n.x - contentOffset.ox,
      y: contentOffset.oy - n.y,
    }),
    [contentOffset],
  );

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setViewport({ w: Math.max(320, el.clientWidth), h: Math.max(420, el.clientHeight || 640) });
    });
    ro.observe(el);
    setViewport({ w: Math.max(320, el.clientWidth), h: Math.max(420, el.clientHeight || 640) });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setTransform((t) => ({
      ...t,
      x: viewport.w / 2,
      y: viewport.h - 80,
    }));
  }, [viewport.w, viewport.h, layout.width]);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    setTransform((t) => ({
      ...t,
      k: Math.max(0.15, Math.min(2.5, t.k * factor)),
    }));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.oj-tree-node-group')) return;
    dragRef.current = { px: e.clientX, py: e.clientY, tx: transform.x, ty: transform.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setTransform((t) => ({
      ...t,
      x: d.tx + (e.clientX - d.px),
      y: d.ty + (e.clientY - d.py),
    }));
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const runSearch = (q: string) => {
    setSearch(q);
    const needle = q.trim().toLowerCase();
    if (!needle) {
      setSearchHits([]);
      return;
    }
    const hits = searchRows
      .filter(
        (r) =>
          r.label.toLowerCase().includes(needle) ||
          r.id.toLowerCase().includes(needle) ||
          r.path.toLowerCase().includes(needle),
      )
      .slice(0, 12);
    setSearchHits(hits);
  };

  const pickSearch = (id: string) => {
    setSearch('');
    setSearchHits([]);
    const path = findNodePath(tree, id);
    if (path && onRevealPath) onRevealPath(path.slice(0, -1));
    const node = byId.get(id);
    if (node) onSelectNode(id, node);
  };

  const selectedNode = selectedId ? byId.get(selectedId) : null;

  return (
    <div className="oj-tree-panel space-y-3">
      <div className="oj-tree-toolbar">
        <div className="relative flex-1 min-w-[12rem] max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => runSearch(e.target.value)}
            placeholder="搜索知识点名称或 id…"
            className="oj-tree-search"
          />
          {searchHits.length > 0 ? (
            <ul className="oj-tree-search-dropdown">
              {searchHits.map((h) => (
                <li key={h.id}>
                  <button type="button" onClick={() => pickSearch(h.id)}>
                    <span className="font-medium text-slate-800">{h.label}</span>
                    <span className="block text-[11px] text-slate-400 truncate">{h.path}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="oj-tree-legend">
          <span><i className="dot dim" />0–20</span>
          <span><i className="dot mid" />20–50</span>
          <span><i className="dot bright" />50–85</span>
          <span><i className="dot lit" />≥85</span>
          <span className="oj-tree-zoom-tip">
            <ZoomIn size={14} />
            滚轮缩放 · 拖拽平移
          </span>
        </div>
      </div>

      <div
        ref={wrapRef}
        className="oj-tree-wrap"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <svg width={viewport.w} height={viewport.h} className="oj-tree-svg">
          <defs>
            <pattern id="oj-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1.5" fill="#e2e8f0" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#oj-grid)" />
          <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
            {layout.edges.map((edge) => {
              const a = byId.get(edge.fromId);
              const b = byId.get(edge.toId);
              if (!a || !b) return null;
              const pa = toSvg(a);
              const pb = toSvg(b);
              const style = masteryStyle(edge.mastery);
              return (
                <path
                  key={edge.id}
                  d={linkPath(pa.x, pa.y + OJ_NODE_H / 2, pb.x, pb.y - OJ_NODE_H / 2)}
                  fill="none"
                  stroke={style.link}
                  strokeWidth={2}
                  opacity={0.85}
                />
              );
            })}
            {layout.nodes.map((node) => {
              const pos = toSvg(node);
              const style = masteryStyle(node.mastery);
              const isHi = highlightId === node.id || selectedId === node.id;
              const pct = Math.max(0, Math.min(100, node.mastery)) / 100;
              return (
                <g
                  key={node.id}
                  className="oj-tree-node-group"
                  transform={`translate(${pos.x - OJ_NODE_W / 2},${pos.y - OJ_NODE_H / 2})`}
                  data-science-node={node.id}
                >
                  <rect
                    rx={26}
                    ry={26}
                    width={OJ_NODE_W}
                    height={OJ_NODE_H}
                    fill={style.fill}
                    stroke={isHi ? '#2563eb' : style.stroke}
                    strokeWidth={isHi ? 2.5 : 1.5}
                    className="cursor-pointer"
                    onClick={() => onSelectNode(node.id, node)}
                    onDoubleClick={() => {
                      if (node.childCount === 0) onPracticeNode(node.id, node.label);
                    }}
                  />
                  <text
                    x={OJ_NODE_W / 2}
                    y={18}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={600}
                    fill={style.text}
                    pointerEvents="none"
                  >
                    {clampLabel(node.label)}
                  </text>
                  <rect x={40} y={28} width={TRACK_W} height={4} rx={2} fill="#e2e8f0" pointerEvents="none" />
                  <rect
                    x={40}
                    y={28}
                    width={TRACK_W * pct}
                    height={4}
                    rx={2}
                    fill={style.bar}
                    pointerEvents="none"
                  />
                  <text x={OJ_NODE_W / 2} y={46} textAnchor="middle" fontSize={9} fill="#64748b" pointerEvents="none">
                    完成度 {node.mastery}
                  </text>
                  {node.childCount > 0 ? (
                    <g
                      className="cursor-pointer"
                      transform={`translate(${OJ_NODE_W - 8},${OJ_NODE_H / 2})`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleBranch(node.id);
                      }}
                    >
                      <circle r={11} fill={node.expanded ? '#f1f5f9' : '#dbeafe'} stroke={node.expanded ? '#94a3b8' : '#3b82f6'} strokeWidth={1.5} />
                      <text textAnchor="middle" dominantBaseline="central" fontSize={14} fontWeight={700} fill={node.expanded ? '#475569' : '#1e3a8a'}>
                        {node.expanded ? '−' : '+'}
                      </text>
                    </g>
                  ) : null}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {selectedNode ? (
        <div className="oj-tree-detail rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-slate-900">{selectedNode.label}</p>
              <p className="mt-1 text-xs text-slate-500 font-mono">{selectedNode.id}</p>
              <p className="mt-2 text-xs text-slate-600">
                完成度 <strong>{selectedNode.mastery}</strong>
                {selectedNode.childCount > 0 ? (
                  <span className="ml-2 text-slate-400">· 点击右侧 ± 展开子节点</span>
                ) : (
                  <span className="ml-2 text-slate-400">· 双击节点开始练习</span>
                )}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedNode.childCount > 0 ? (
                <button
                  type="button"
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
                  onClick={() => onToggleBranch(selectedNode.id)}
                >
                  {selectedNode.expanded ? '收起' : '展开'}子树
                </button>
              ) : null}
              {selectedNode.childCount === 0 ? (
                <button
                  type="button"
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                  onClick={() => onPracticeNode(selectedNode.id, selectedNode.label)}
                >
                  针对性练习
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {caption ? <p className="text-xs text-slate-500 leading-relaxed">{caption}</p> : null}
    </div>
  );
}
