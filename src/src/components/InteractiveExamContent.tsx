import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, GripVertical, Move } from 'lucide-react';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ocrTextHasMarkdownTable } from '../../../shared/formatMcq';
import { useImageNaturalSize } from '../hooks/useImageNaturalSize';
import {
  BASE_FONT_PX,
  computeProportionalImageStyle,
  mergeOcrLayout,
  parseExamMarkdownBlocks,
  reorderBlockIds,
  type OcrBlockStyle,
  type OcrContentLayout,
  type ParsedExamBlock,
} from '../utils/examContentLayout';

function ocrTextHasMarkdownImage(text: string): boolean {
  return /!\[[^\]]*\]\([^)]+\)/.test(text);
}

type Props = {
  markdown: string;
  layout?: OcrContentLayout | null;
  onLayoutChange?: (layout: OcrContentLayout) => void;
  layoutEdit?: boolean;
  maxHeightPx?: number;
  sourceImageUri?: string | null;
};

function alignClass(align?: OcrBlockStyle['align']): string {
  if (align === 'center') return 'mx-auto';
  if (align === 'right') return 'ml-auto mr-0';
  return 'mr-auto';
}

function BlockPositionControls({
  style,
  layoutEdit,
  onStyleChange,
  showAlign,
}: {
  style: OcrBlockStyle;
  layoutEdit: boolean;
  onStyleChange: (patch: Partial<OcrBlockStyle>) => void;
  showAlign?: boolean;
}) {
  if (!layoutEdit) return null;
  const marginTop = style.marginTop ?? 0;
  const offsetX = style.offsetXPct ?? 0;

  return (
    <div className="mt-1.5 space-y-1.5 border-t border-slate-100 pt-1.5">
      <div className="flex items-center gap-2 text-[10px] text-slate-500">
        <span className="w-8 shrink-0">间距</span>
        <input
          type="range"
          min={0}
          max={40}
          value={marginTop}
          onChange={(e) => onStyleChange({ marginTop: Number(e.target.value) })}
          className="flex-1 h-1 accent-indigo-500"
        />
        <span className="w-8 text-right tabular-nums">{marginTop}px</span>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-slate-500">
        <span className="w-8 shrink-0">横移</span>
        <input
          type="range"
          min={-20}
          max={20}
          value={offsetX}
          onChange={(e) => onStyleChange({ offsetXPct: Number(e.target.value) })}
          className="flex-1 h-1 accent-indigo-500"
        />
        <span className="w-8 text-right tabular-nums">{offsetX}%</span>
      </div>
      {showAlign ? (
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-slate-500 mr-1">对齐</span>
          {(
            [
              ['left', AlignLeft],
              ['center', AlignCenter],
              ['right', AlignRight],
            ] as const
          ).map(([key, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => onStyleChange({ align: key })}
              className={`rounded p-1 ${style.align === key || (!style.align && key === 'center') ? 'bg-indigo-100 text-indigo-700' : 'text-slate-400 hover:bg-slate-100'}`}
            >
              <Icon size={12} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ResizableImageBlock({
  block,
  style,
  layoutEdit,
  sourceImageUri,
  containerW,
  onStyleChange,
}: {
  block: Extract<ParsedExamBlock, { kind: 'image' }>;
  style: OcrBlockStyle;
  layoutEdit: boolean;
  sourceImageUri?: string | null;
  containerW: number;
  onStyleChange: (patch: Partial<OcrBlockStyle>) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const figNatural = useImageNaturalSize(block.src);
  const sourceNatural = useImageNaturalSize(sourceImageUri);

  const autoStyle = useMemo(() => {
    if (!figNatural || containerW <= 0) return null;
    return computeProportionalImageStyle(figNatural, sourceNatural, containerW, BASE_FONT_PX);
  }, [figNatural, sourceNatural, containerW]);

  const widthPct =
    style.widthPctManual && style.widthPct != null
      ? style.widthPct
      : style.widthPct ?? autoStyle?.widthPct ?? 48;

  const align = style.align ?? autoStyle?.align ?? 'center';
  const marginTop = style.marginTop ?? autoStyle?.marginTop ?? 6;
  const offsetX = style.offsetXPct ?? 0;

  const markManual = (patch: Partial<OcrBlockStyle>) => {
    onStyleChange({
      ...patch,
      widthPctManual: patch.widthPct != null ? true : style.widthPctManual,
    });
  };

  const onResizePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!layoutEdit || !wrapRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      const parent = wrapRef.current.parentElement;
      if (!parent) return;
      const startX = e.clientX;
      const startW = wrapRef.current.offsetWidth;
      const parentW = parent.clientWidth || 1;

      const onMove = (ev: PointerEvent) => {
        const delta = ev.clientX - startX;
        const nextPx = Math.max(40, Math.min(parentW, startW + delta));
        const nextPct = Math.round((nextPx / parentW) * 100);
        markManual({ widthPct: Math.min(100, Math.max(15, nextPct)) });
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [layoutEdit, onStyleChange, style.widthPctManual],
  );

  return (
    <div>
      <div
        ref={wrapRef}
        className={`relative transition-[width,margin] ${alignClass(align)}`}
        style={{
          width: `${widthPct}%`,
          marginTop,
          transform: offsetX ? `translateX(${offsetX}%)` : undefined,
        }}
      >
        <img
          src={block.src}
          alt={block.alt || '配图'}
          className="w-full h-auto object-contain rounded border border-slate-200/80 bg-white"
          draggable={false}
        />
        {layoutEdit ? (
          <div
            className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize rounded-tl bg-indigo-500/85 border border-white shadow"
            onPointerDown={onResizePointerDown}
            title="拖动调整大小"
          />
        ) : null}
      </div>
      {layoutEdit ? (
        <>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
            <span>宽度 {widthPct}%</span>
            {!style.widthPctManual && autoStyle ? (
              <span className="text-indigo-500/80">（已按原图比例）</span>
            ) : null}
            <input
              type="range"
              min={15}
              max={100}
              value={widthPct}
              onChange={(e) => markManual({ widthPct: Number(e.target.value) })}
              className="flex-1 min-w-[80px] h-1 accent-indigo-500"
            />
            {style.widthPctManual ? (
              <button
                type="button"
                className="text-indigo-600 hover:underline"
                onClick={() =>
                  onStyleChange({
                    widthPct: autoStyle?.widthPct,
                    widthPctManual: false,
                    align: autoStyle?.align,
                  })
                }
              >
                重置
              </button>
            ) : null}
          </div>
          <BlockPositionControls
            style={{ ...style, align, marginTop, offsetXPct: offsetX }}
            layoutEdit
            onStyleChange={onStyleChange}
            showAlign
          />
        </>
      ) : null}
    </div>
  );
}

function TextBlock({
  block,
  style,
  layoutEdit,
  onStyleChange,
}: {
  block: Extract<ParsedExamBlock, { kind: 'text' }>;
  style: OcrBlockStyle;
  layoutEdit: boolean;
  onStyleChange: (patch: Partial<OcrBlockStyle>) => void;
}) {
  const fontScale = style.fontScale ?? 1;
  const fontSize = Math.round(BASE_FONT_PX * fontScale);
  const marginTop = style.marginTop ?? 0;
  const offsetX = style.offsetXPct ?? 0;

  const body =
    ocrTextHasMarkdownTable(block.content) || ocrTextHasMarkdownImage(block.content) ? (
      <MarkdownRenderer content={block.content} density="normal" highlightMcqOptions />
    ) : (
      <div className="whitespace-pre-wrap leading-snug text-slate-800">{block.content}</div>
    );

  return (
    <div
      style={{
        marginTop,
        fontSize,
        textAlign: style.align ?? 'left',
        transform: offsetX ? `translateX(${offsetX}%)` : undefined,
      }}
    >
      {body}
      {layoutEdit ? (
        <>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500">
            <span>字号</span>
            <input
              type="range"
              min={75}
              max={130}
              value={Math.round(fontScale * 100)}
              onChange={(e) => onStyleChange({ fontScale: Number(e.target.value) / 100 })}
              className="flex-1 h-1 accent-indigo-500"
            />
            <span className="tabular-nums">{Math.round(fontScale * 100)}%</span>
          </div>
          <BlockPositionControls style={style} layoutEdit onStyleChange={onStyleChange} />
        </>
      ) : null}
    </div>
  );
}

export function InteractiveExamContent({
  markdown,
  layout,
  onLayoutChange,
  layoutEdit = false,
  maxHeightPx,
  sourceImageUri,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  const blocks = useMemo(() => parseExamMarkdownBlocks(markdown), [markdown]);
  const merged = useMemo(() => mergeOcrLayout(layout, blocks), [layout, blocks]);
  const [dragId, setDragId] = useState<string | null>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const update = () => setContainerW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const orderedBlocks = useMemo(() => {
    const map = new Map(blocks.map((b) => [b.id, b]));
    return (merged.order ?? []).map((id) => map.get(id)).filter(Boolean) as ParsedExamBlock[];
  }, [blocks, merged.order]);

  const patchStyle = (id: string, patch: Partial<OcrBlockStyle>) => {
    onLayoutChange?.({
      ...merged,
      styles: {
        ...merged.styles,
        [id]: { ...merged.styles[id], ...patch },
      },
    });
  };

  const onDropOn = (targetId: string) => {
    if (!dragId || !onLayoutChange) return;
    onLayoutChange({
      ...merged,
      order: reorderBlockIds(merged.order ?? [], dragId, targetId),
    });
    setDragId(null);
  };

  if (!orderedBlocks.length) {
    return <p className="text-sm text-slate-500">暂无识别内容</p>;
  }

  return (
    <div
      ref={rootRef}
      className={`space-y-1.5 ${layoutEdit ? 'select-none' : ''}`}
      style={
        maxHeightPx && !layoutEdit
          ? { maxHeight: maxHeightPx, overflowY: 'auto' }
          : undefined
      }
    >
      {layoutEdit ? (
        <p className="text-[10px] text-indigo-600 flex items-center gap-1 pb-1 border-b border-indigo-100">
          <Move size={11} />
          配图默认按原图与字号比例显示；可拖动排序、右下角调大小，滑块微调位置
        </p>
      ) : null}

      {orderedBlocks.map((block) => {
        const style = merged.styles[block.id] ?? {};
        return (
          <div
            key={block.id}
            className={`group rounded-md ${layoutEdit ? 'border border-dashed border-slate-200 bg-white/90 px-2 py-1.5 hover:border-indigo-200' : ''}`}
            onDragOver={(e) => {
              if (layoutEdit) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (layoutEdit) onDropOn(block.id);
            }}
          >
            <div className="flex gap-1.5">
              {layoutEdit ? (
                <button
                  type="button"
                  draggable
                  onDragStart={() => setDragId(block.id)}
                  onDragEnd={() => setDragId(null)}
                  className="mt-1 shrink-0 cursor-grab text-slate-400 hover:text-indigo-500 active:cursor-grabbing"
                  title="拖动调整顺序"
                >
                  <GripVertical size={14} />
                </button>
              ) : null}
              <div className="min-w-0 flex-1">
                {block.kind === 'image' ? (
                  <ResizableImageBlock
                    block={block}
                    style={style}
                    layoutEdit={layoutEdit}
                    sourceImageUri={sourceImageUri}
                    containerW={containerW}
                    onStyleChange={(patch) => patchStyle(block.id, patch)}
                  />
                ) : (
                  <TextBlock
                    block={block}
                    style={style}
                    layoutEdit={layoutEdit}
                    onStyleChange={(patch) => patchStyle(block.id, patch)}
                  />
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
