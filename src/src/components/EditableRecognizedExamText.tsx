import React, { useEffect, useState } from 'react';
import { Check, Pencil, RotateCcw, X } from 'lucide-react';
import { RecognizedExamTextView } from './RecognizedExamTextView';

type Props = {
  /** 原始 OCR 文本（可含 Markdown 表格、fig-circuit 占位等） */
  rawText: string;
  /** 预览用 Markdown（含配图 data URL 替换） */
  previewMarkdown: string;
  onSave: (nextRaw: string) => void | Promise<void>;
  saving?: boolean;
  className?: string;
};

export function EditableRecognizedExamText({
  rawText,
  previewMarkdown,
  onSave,
  saving = false,
  className,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(rawText);

  useEffect(() => {
    if (!editing) setDraft(rawText);
  }, [rawText, editing]);

  const startEdit = () => {
    setDraft(rawText);
    setEditing(true);
  };

  const cancelEdit = () => {
    setDraft(rawText);
    setEditing(false);
  };

  const saveEdit = async () => {
    const next = draft.trim();
    if (!next) return;
    await onSave(next);
    setEditing(false);
  };

  const dirty = editing && draft.trim() !== rawText.trim();

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <p className="text-[11px] text-slate-500">
          {editing ? '可直接修改识别结果，支持 Markdown 表格与选项分行' : '识别结果预览'}
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
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40"
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
          ) : (
            <button
              type="button"
              onClick={startEdit}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-800"
            >
              <Pencil size={12} />
              编辑识别文本
            </button>
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
        <div className="recognized-exam-scroll max-h-[min(480px,55vh)] overflow-y-auto overflow-x-hidden rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5">
          <RecognizedExamTextView markdown={previewMarkdown} />
        </div>
      )}
    </div>
  );
}
