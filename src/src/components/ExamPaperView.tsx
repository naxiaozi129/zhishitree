import React, { useMemo } from 'react';
import { cn } from './MarkdownRenderer';
import { AdaptiveExamFigure } from './AdaptiveExamFigure';
import { expandQuestionStemImages, questionImagesFromBody } from '../utils/questionImages';
import {
  classifyExamLine,
  formatExamDisplayText,
  splitExamContentSegments,
} from '../utils/formatExamDisplay';

function ExamTextBlock({ text, variant = 'question' }: { text: string; variant?: 'question' | 'answer' }) {
  const lines = useMemo(() => formatExamDisplayText(text).split('\n'), [text]);

  return (
    <div className={cn('exam-paper-body', variant === 'answer' && 'exam-paper-body--answer')}>
      {lines.map((line, i) => {
        const kind = classifyExamLine(line);
        const empty = !line.trim();
        return (
          <p
            key={i}
            className={cn(
              'exam-paper-line',
              kind === 'option' && 'exam-paper-line--option',
              kind === 'subq' && 'exam-paper-line--subq',
              kind === 'qno' && 'exam-paper-line--qno',
              empty && 'exam-paper-line--empty',
            )}
          >
            {empty ? '\u00A0' : line}
          </p>
        );
      })}
    </div>
  );
}

function ExamInlineContent({
  content,
  body,
  variant = 'question',
}: {
  content: string;
  body?: Record<string, unknown>;
  variant?: 'question' | 'answer';
}) {
  const expanded = body && variant === 'question' ? expandQuestionStemImages(content, body) : content;
  const imgMap = useMemo(() => {
    const m = new Map<string, { src: string; alt: string }>();
    if (variant === 'question' && body) {
      for (const img of questionImagesFromBody(body)) {
        m.set(img.id, { src: img.src, alt: img.alt });
      }
    }
    return m;
  }, [body, variant]);

  const segments = useMemo(() => splitExamContentSegments(expanded), [expanded]);

  return (
    <>
      {segments.map((seg, idx) => {
        const ph = seg.match(/^\{\{image:([a-zA-Z0-9_-]+)\}\}$/);
        if (ph) {
          const img = imgMap.get(ph[1]);
          if (img) {
            return (
              <AdaptiveExamFigure
                key={`img-${idx}`}
                src={img.src}
                alt={img.alt}
                caption={img.alt && img.alt !== ph[1] ? img.alt : undefined}
                maxLines={6}
              />
            );
          }
          return (
            <p key={`img-${idx}`} className="exam-paper-line exam-paper-line--placeholder">
              [插图：{ph[1]}]
            </p>
          );
        }

        const md = seg.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
        if (md) {
          const src = md[2];
          if (
            src.startsWith('data:') ||
            src.startsWith('http://') ||
            src.startsWith('https://') ||
            src.startsWith('blob:')
          ) {
            return (
              <AdaptiveExamFigure
                key={`img-${idx}`}
                src={src}
                alt={md[1] || '插图'}
                maxLines={6}
              />
            );
          }
        }

        return <ExamTextBlock key={`t-${idx}`} text={seg} variant={variant} />;
      })}
    </>
  );
}

export type ExamPaperViewProps = {
  title?: string | null;
  paperTitle?: string | null;
  subject?: string | null;
  question: string;
  answer?: string | null;
  body?: Record<string, unknown>;
  className?: string;
};

/** 试卷式阅读布局：题号 → 题干（含内嵌图）→ 答案解析 */
export function ExamPaperView({
  title,
  paperTitle,
  subject,
  question,
  answer,
  body,
  className,
}: ExamPaperViewProps) {
  const displayTitle = title?.trim() || null;
  const qNoFromStem = !displayTitle ? question.match(/^([1-9]\d{0,2}[．.、])/)?.[1] : null;

  return (
    <article className={cn('exam-paper-sheet', className)}>
      {(paperTitle || subject) && (
        <header className="exam-paper-header">
          {paperTitle ? <p className="exam-paper-header-title">{paperTitle}</p> : null}
          {subject ? <p className="exam-paper-header-sub">{subject}</p> : null}
        </header>
      )}

      <section className="exam-paper-section exam-paper-section--question">
        {displayTitle ? (
          <h2 className="exam-paper-qno">{displayTitle}</h2>
        ) : qNoFromStem ? (
          <h2 className="exam-paper-qno">{qNoFromStem}</h2>
        ) : null}
        <ExamInlineContent content={question} body={body} variant="question" />
      </section>

      {answer?.trim() ? (
        <section className="exam-paper-section exam-paper-section--answer">
          <h3 className="exam-paper-answer-label">【答案及解析】</h3>
          <ExamInlineContent content={answer} variant="answer" />
        </section>
      ) : null}
    </article>
  );
}

export type PendingReviewAiMeta = {
  examPoints: string[];
  tagLabels: string[];
  preview: {
    label?: string;
    path?: string;
    score?: number;
    reasons?: string[];
  }[];
};

export function PendingReviewAiSidebar({ meta }: { meta: PendingReviewAiMeta }) {
  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="shrink-0 px-4 py-2.5 border-b border-slate-100 bg-slate-50/90">
        <h3 className="text-xs font-bold text-slate-700">AI 考点与知识树</h3>
        <p className="text-[10px] text-slate-500 mt-0.5">审核参考，不影响试卷正文排版</p>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {meta.examPoints.length > 0 ? (
          <div>
            <p className="text-[11px] font-semibold text-slate-500 mb-1.5">考点摘要</p>
            <ul className="list-disc pl-4 text-sm text-slate-700 space-y-1.5 leading-relaxed">
              {meta.examPoints.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-xs text-slate-400">无 AI 考点摘要</p>
        )}

        {meta.tagLabels.length > 0 ? (
          <div>
            <p className="text-[11px] font-semibold text-slate-500 mb-1.5">标签</p>
            <div className="flex flex-wrap gap-1.5">
              {meta.tagLabels.map((t, i) => (
                <span key={i} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">
                  {t}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {meta.preview.length > 0 ? (
          <div>
            <p className="text-[11px] font-semibold text-slate-500 mb-2">知识树映射候选</p>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="text-left px-2 py-1.5 font-medium">节点</th>
                    <th className="text-left px-2 py-1.5 font-medium w-10">分</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {meta.preview.map((m, i) => (
                    <tr key={i} className="hover:bg-slate-50/80">
                      <td className="px-2 py-2 text-slate-800 align-top">
                        <p className="font-medium">{m.label}</p>
                        <p className="mt-0.5 text-[10px] text-slate-500 leading-snug">{m.path}</p>
                        {m.reasons && m.reasons.length > 0 ? (
                          <p className="mt-1 text-[10px] text-slate-400">{m.reasons.slice(0, 2).join(' · ')}</p>
                        ) : null}
                      </td>
                      <td className="px-2 py-2 tabular-nums text-slate-600 align-top">{m.score ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2 border border-amber-100 leading-relaxed">
            未匹配到知识树节点，通过后请人工核对或驳回。
          </p>
        )}
      </div>
    </div>
  );
}
