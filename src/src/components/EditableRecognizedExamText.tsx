import React, { useEffect, useState } from 'react';
import { Check, Layout, Pencil, RotateCcw, X } from 'lucide-react';
import { InteractiveExamContent } from './InteractiveExamContent';
import type { OcrContentLayout } from '../utils/examContentLayout';
import { mergeOcrLayout, parseExamMarkdownBlocks } from '../utils/examContentLayout';

type Props = {
  rawText: string;
  previewMarkdown: string;
  onSave: (nextRaw: string) => void | Promise<void>;
  ocrLayout?: OcrContentLayout | null;
  onLayoutSave?: (layout: OcrContentLayout) => void | Promise<void>;
  saving?: boolean;
  className?: string;
  previewMaxHeightPx?: number;
  /** 原题完整截图 URI，用于内嵌配图按比例缩放 */
  sourceImageUri?: string | null;
};

export function EditableRecognizedExamText({
  rawText,
  previewMarkdown,
  onSave,
  ocrLayout,
  onLayoutSave,
  saving = false,
  className,
  previewMaxHeightPx,
  sourceImageUri,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [layoutEdit, setLayoutEdit] = useState(false);
  const [draft, setDraft] = useState(rawText);
  const [localLayout, setLocalLayout] = useState<OcrContentLayout | null>(ocrLayout ?? null);

  useEffect(() => {
    if (!editing) setDraft(rawText);
  }, [rawText, editing]);

  useEffect(() => {
    if (!layoutEdit) setLocalLayout(ocrLayout ?? null);
  }, [ocrLayout, layoutEdit]);

  const startEdit = () => {
    setLayoutEdit(false);
    setDraft(rawText);
    setEditing(true);
  };

  const startLayoutEdit = () => {
    setEditing(false);
    const blocks = parseExamMarkdownBlocks(previewMarkdown);
    setLocalLayout(mergeOcrLayout(ocrLayout, blocks));
    setLayoutEdit(true);
  };

  const cancelEdit = () => {
    setDraft(rawText);
    setEditing(false);
  };

  const cancelLayoutEdit = () => {
    setLocalLayout(ocrLayout ?? null);
    setLayoutEdit(false);
  };

  const saveEdit = async () => {
    const next = draft.trim();
    if (!next) return;
    await onSave(next);
    setEditing(false);
  };

  const saveLayout = async () => {
    if (!localLayout || !onLayoutSave) return;
    await onLayoutSave(localLayout);
    setLayoutEdit(false);
  };

  const dirty = editing && draft.trim() !== rawText.trim();
  const layoutDirty =
    layoutEdit &&
    JSON.stringify(localLayout) !== JSON.stringify(ocrLayout ?? null);

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <p className="text-[11px] text-slate-500">
          {editing
            ? '修改识别文字（Markdown）'
            : layoutEdit
              ? '拖动排序 · 调整配图大小与文字字号'
              : '识别结果预览（含内嵌配图）'}
        </p>
        <div className="flex items-center gap-1.5">
          {editing ? (
            <>
              <button
                type="button"
                onClick={() => setDraft(rawText)}
                disabled={!dirty || saving}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                <RotateCcw size={12} />
                还原
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                disabled={saving}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
              >
                <X size={12} />
                取消
              </button>
              <button
                type="button"
                onClick={() => void saveEdit()}
                disabled={!dirty || saving || !draft.trim()}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
              >
                <Check size={12} />
                {saving ? '保存中…' : '保存'}
              </button>
            </>
          ) : layoutEdit ? (
            <>
              <button
                type="button"
                onClick={cancelLayoutEdit}
                disabled={saving}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
              >
                <X size={12} />
                取消
              </button>
              <button
                type="button"
                onClick={() => void saveLayout()}
                disabled={!layoutDirty || saving || !onLayoutSave}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
              >
                <Check size={12} />
                {saving ? '保存中…' : '保存排版'}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={startLayoutEdit}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-800"
              >
                <Layout size={12} />
                排版调整
              </button>
              <button
                type="button"
                onClick={startEdit}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-800"
              >
                <Pencil size={12} />
                编辑文字
              </button>
            </>
          )}
        </div>
      </div>

      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          className="w-full min-h-[min(420px,50vh)] resize-y rounded-lg border border-indigo-200 bg-white px-3 py-2.5 font-mono text-sm leading-relaxed text-slate-800 shadow-inner focus:outline-none focus:ring-2 focus:ring-indigo-300"
          placeholder="在此修正 OCR 错字、补全表格、调整选项分行…"
        />
      ) : (
        <div
          className="recognized-exam-scroll overflow-y-auto overflow-x-hidden rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5"
          style={{
            maxHeight: previewMaxHeightPx
              ? `${previewMaxHeightPx}px`
              : 'min(480px, 55vh)',
            minHeight: previewMaxHeightPx ? Math.min(previewMaxHeightPx, 200) : undefined,
          }}
        >
          <InteractiveExamContent
            markdown={previewMarkdown}
            layout={layoutEdit ? localLayout : ocrLayout}
            onLayoutChange={layoutEdit ? setLocalLayout : undefined}
            layoutEdit={layoutEdit}
            maxHeightPx={layoutEdit ? undefined : previewMaxHeightPx}
            sourceImageUri={sourceImageUri}
          />
        </div>
      )}
    </div>
  );
}
