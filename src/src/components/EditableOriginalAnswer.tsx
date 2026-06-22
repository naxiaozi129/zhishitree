import React, { useEffect, useState } from 'react';
import { Check, Pencil, RotateCcw, X } from 'lucide-react';

export type HandwrittenAnswerKind = 'original' | 'corrected';

const KIND_UI: Record<
  HandwrittenAnswerKind,
  {
    label: string;
    editHint: string;
    emptyText: string;
    placeholder: string;
    border: string;
    bg: string;
    text: string;
    ring: string;
    btn: string;
    btnHover: string;
    saveBtn: string;
    saveBtnHover: string;
  }
> = {
  original: {
    label: '黑色手写 · 原始作答',
    editHint: '学生最初做题时写的答案（选项、填空、计算过程等）',
    emptyText: '未识别到黑色手写答案（可点击编辑手动填写）',
    placeholder: '如：B、3.14、或计算过程…',
    border: 'border-amber-100',
    bg: 'bg-amber-50/60',
    text: 'text-amber-950',
    ring: 'focus:ring-amber-300',
    btn: 'hover:border-amber-200 hover:bg-amber-50 hover:text-amber-900',
    btnHover: '',
    saveBtn: 'border-amber-200 bg-amber-600',
    saveBtnHover: 'hover:bg-amber-700',
  },
  corrected: {
    label: '红色手写 · 批改答案',
    editHint: '事后用红笔标注的正确答案或订正（老师批改或学生改错）',
    emptyText: '未识别到红色批改笔迹（可点击编辑手动填写）',
    placeholder: '如：A、正确答案、订正后的数值…',
    border: 'border-rose-100',
    bg: 'bg-rose-50/60',
    text: 'text-rose-950',
    ring: 'focus:ring-rose-300',
    btn: 'hover:border-rose-200 hover:bg-rose-50 hover:text-rose-900',
    btnHover: '',
    saveBtn: 'border-rose-200 bg-rose-600',
    saveBtnHover: 'hover:bg-rose-700',
  },
};

type Props = {
  kind?: HandwrittenAnswerKind;
  value: string;
  onSave: (next: string) => void | Promise<void>;
  saving?: boolean;
  className?: string;
};

export function EditableOriginalAnswer({
  kind = 'original',
  value,
  onSave,
  saving = false,
  className,
}: Props) {
  const ui = KIND_UI[kind];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const startEdit = () => {
    setDraft(value);
    setEditing(true);
  };

  const cancelEdit = () => {
    setDraft(value);
    setEditing(false);
  };

  const saveEdit = async () => {
    const next = draft.trim();
    await onSave(next);
    setEditing(false);
  };

  const dirty = editing && draft.trim() !== value.trim();
  const display = value.trim();

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <p className="text-[11px] text-slate-500">{editing ? ui.editHint : ui.label}</p>
        <div className="flex items-center gap-1.5">
          {editing ? (
            <>
              <button
                type="button"
                onClick={() => setDraft(value)}
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
                disabled={!dirty || saving}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40 ${ui.saveBtn} ${ui.saveBtnHover}`}
              >
                <Check size={12} />
                {saving ? '保存中…' : '保存'}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={startEdit}
              className={`inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 ${ui.btn}`}
            >
              <Pencil size={12} />
              编辑
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          className={`w-full min-h-[72px] resize-y rounded-lg border bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-800 shadow-inner focus:outline-none focus:ring-2 ${ui.ring} ${
            kind === 'corrected' ? 'border-rose-200' : 'border-amber-200'
          }`}
          placeholder={ui.placeholder}
        />
      ) : (
        <div
          className={`rounded-lg border px-3 py-2.5 text-sm leading-relaxed ${
            display ? `${ui.border} ${ui.bg} ${ui.text}` : 'border-slate-100 bg-slate-50/80 text-slate-400'
          }`}
        >
          {display || ui.emptyText}
        </div>
      )}
    </div>
  );
}
