import { Check } from 'lucide-react';
import { parseMistakeCauses } from './mistakeAnalysisDisplay';

export type MistakeCauseSelectorProps = {
  specificMistake: string;
  selectedIndices: number[];
  onChange: (indices: number[]) => void;
  otherCause?: string;
  onOtherCauseChange?: (text: string) => void;
  disabled?: boolean;
  saveHint?: string | null;
};

export function MistakeCauseSelector({
  specificMistake,
  selectedIndices,
  onChange,
  otherCause = '',
  onOtherCauseChange,
  disabled = false,
  saveHint,
}: MistakeCauseSelectorProps) {
  const { causes } = parseMistakeCauses(specificMistake);

  const toggle = (idx: number) => {
    if (disabled) return;
    if (selectedIndices.includes(idx)) {
      onChange(selectedIndices.filter((i) => i !== idx));
    } else {
      onChange([...selectedIndices, idx].sort((a, b) => a - b));
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium text-amber-900/85">可能原因是：</p>
      {causes.length === 0 ? (
        <p className="text-[13px] text-slate-600 leading-snug whitespace-pre-wrap">
          {specificMistake.trim() || '暂无错因分析'}
        </p>
      ) : (
        <ul className="space-y-1" role="listbox" aria-label="选择你认为的错因">
          {causes.map((cause, idx) => {
            const selected = selectedIndices.includes(idx);
            return (
              <li key={`cause-${idx}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={disabled}
                  onClick={() => toggle(idx)}
                  className={`w-full text-left flex gap-2 rounded-md border px-2 py-1.5 text-[13px] leading-snug transition-colors ${
                    selected
                      ? 'border-amber-400/80 bg-amber-50 text-amber-950'
                      : 'border-transparent bg-slate-50/80 text-slate-700 hover:bg-amber-50/60 hover:border-amber-200/60'
                  } ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <span
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      selected ? 'border-amber-500 bg-amber-500 text-white' : 'border-slate-300 bg-white'
                    }`}
                  >
                    {selected ? <Check size={10} strokeWidth={3} /> : null}
                  </span>
                  <span className="flex-1 min-w-0 break-words">
                    <span className="text-amber-800/60 mr-0.5">{idx + 1}.</span>
                    {cause}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {onOtherCauseChange ? (
        <div className="pt-0.5">
          <label className="text-[10px] text-slate-500" htmlFor="mistake-other-cause">
            其他原因
          </label>
          <textarea
            id="mistake-other-cause"
            rows={1}
            disabled={disabled}
            value={otherCause}
            onChange={(e) => onOtherCauseChange(e.target.value)}
            placeholder="用自己的话补充…"
            className="mt-0.5 w-full resize-none rounded border border-slate-200 bg-white px-2 py-1 text-[13px] text-slate-800 placeholder:text-slate-400 focus:border-amber-300 focus:outline-none disabled:opacity-60"
          />
        </div>
      ) : null}

      <p className="text-[10px] text-slate-400 leading-tight">
        {selectedIndices.length > 0 || otherCause.trim()
          ? `已选 ${selectedIndices.length} 项${saveHint ? ` · ${saveHint}` : ''}`
          : '勾选符合你的错因'}
      </p>
    </div>
  );
}
