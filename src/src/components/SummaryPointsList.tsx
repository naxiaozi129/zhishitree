import { formatMcqOptionsPerLine } from '../utils/formatExamDisplay';
import { parseSummarySections, summarySectionStyle, type SummarySection } from './mistakeAnalysisDisplay';

function SummarySectionBlock({ section }: { section: SummarySection }) {
  const style = summarySectionStyle(section.label);
  const multi = section.items.length > 1;

  return (
    <div className={`border-l-2 pl-2.5 py-0.5 ${style.border}`}>
      <p className={`text-[10px] font-semibold ${style.accent} mb-1`}>{section.label}</p>
      {multi ? (
        <ol className="space-y-1">
          {section.items.map((item, idx) => (
            <li key={`${section.label}-${idx}`} className="flex gap-1.5 text-[13px] leading-snug text-slate-700">
              <span className={`shrink-0 font-medium tabular-nums ${style.accent} opacity-60`}>{idx + 1}.</span>
              <span className="min-w-0 break-words">{item}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[13px] leading-snug text-slate-700 break-words">{section.items[0]}</p>
      )}
    </div>
  );
}

export function SummaryPointsList({ summary }: { summary: string }) {
  const sections = parseSummarySections(formatMcqOptionsPerLine(summary));
  if (sections.length === 0) {
    return <p className="text-[13px] text-slate-500">暂无摘要</p>;
  }
  return (
    <div className="space-y-2.5">
      {sections.map((section) => (
        <SummarySectionBlock key={section.label} section={section} />
      ))}
    </div>
  );
}
