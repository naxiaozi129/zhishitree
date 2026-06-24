import React, { useMemo } from 'react';
import { useImageNaturalSize, useViewportHeight } from '../hooks/useImageNaturalSize';
import { computeExamPanelLayout, isCircuitOrInlineFigure } from '../utils/examMarkdownPreview';
import { figureDataUriIfValid, isSameImageUri, resolveAnalysisImageUri } from '../services/geminiService';
import type { QuestionAnalysis } from '../services/geminiService';
import { isPdfMime } from '../utils/uploadQuestionMedia';
import { QuestionSourceMedia } from './QuestionSourceMedia';

type Props = {
  analysis: QuestionAnalysis;
  fallbackImage?: string | null;
  mimeType: string;
  uploadFileName?: string | null;
  children: (layout: { previewMaxHeightPx: number }) => React.ReactNode;
};

export function QuestionOriginalPanel({
  analysis,
  fallbackImage,
  mimeType,
  uploadFileName,
  children,
}: Props) {
  const fullUri = resolveAnalysisImageUri(analysis, fallbackImage);
  const sourceMime = analysis.sourceImage?.mime || mimeType;
  const natural = useImageNaturalSize(fullUri);
  const viewportH = useViewportHeight();

  const layout = useMemo(
    () => computeExamPanelLayout(natural, viewportH),
    [natural, viewportH],
  );

  const showOnlyFullImage = Boolean(fullUri);
  const supplementalFigures = showOnlyFullImage
    ? []
    : (analysis.figures ?? []).filter((fig) => {
        if (isCircuitOrInlineFigure(fig)) return false;
        const figUri = figureDataUriIfValid(fig);
        if (!figUri) return false;
        if (fullUri && isSameImageUri(figUri, fullUri)) return false;
        return true;
      });

  return (
    <div
      className="grid gap-3 lg:items-start"
      style={{
        gridTemplateColumns: fullUri
          ? `minmax(120px, ${layout.leftColPx}px) minmax(0, 1fr)`
          : '1fr',
      }}
    >
      {fullUri ? (
        <div className="lg:sticky lg:top-2 min-w-0">
          <p className="text-[10px] font-medium text-slate-500 mb-1">
            {isPdfMime(sourceMime) ? '原题 PDF' : '原题完整截图'}
          </p>
          <QuestionSourceMedia
            uri={fullUri}
            mime={sourceMime}
            fileName={uploadFileName}
            alt="原题"
            displayHeight={layout.imageDisplayHeightPx}
          />
          {supplementalFigures.map((fig) => (
            <div key={fig.id} className="mt-2">
              <p className="text-[10px] font-medium text-slate-500 mb-1">{fig.label}</p>
              <img
                src={figureDataUriIfValid(fig)!}
                alt={fig.label}
                className="w-full max-h-32 object-contain rounded border border-slate-200 bg-white"
              />
            </div>
          ))}
        </div>
      ) : null}

      <div className={`min-h-0 min-w-0 space-y-2 ${fullUri ? '' : 'col-span-1'}`}>
        {children({ previewMaxHeightPx: layout.previewScrollMaxPx })}
      </div>
    </div>
  );
}
