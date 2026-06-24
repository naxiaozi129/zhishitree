import React from 'react';
import { FileText, ImageOff } from 'lucide-react';
import { isPdfMime } from '../utils/uploadQuestionMedia';

type QuestionSourceMediaProps = {
  uri: string | null;
  mime?: string | null;
  fileName?: string | null;
  alt?: string;
  className?: string;
  embedClassName?: string;
  emptyClassName?: string;
  /** 按原图比例在固定高度内完整显示 */
  displayHeight?: number;
};

export function QuestionSourceMedia({
  uri,
  mime,
  fileName,
  alt = '原题',
  className = 'max-w-full object-contain',
  embedClassName = 'w-full min-h-[120px] max-h-[200px] rounded border border-slate-200 bg-white',
  emptyClassName = 'flex flex-col items-center justify-center gap-1 text-slate-400 p-4',
  displayHeight,
}: QuestionSourceMediaProps) {
  if (!uri) {
    return (
      <div className={emptyClassName}>
        <ImageOff size={20} />
        <span className="text-xs">无预览</span>
      </div>
    );
  }

  if (isPdfMime(mime || '')) {
    const pdfStyle = displayHeight ? { height: displayHeight, minHeight: 200 } : undefined;
    return (
      <div className="flex flex-col gap-2 min-w-0">
        <div className="flex items-center gap-2 text-xs text-slate-600 min-w-0">
          <FileText size={16} className="shrink-0 text-indigo-500" />
          <span className="truncate">{fileName || 'PDF 文件'}</span>
        </div>
        <embed
          src={uri}
          type="application/pdf"
          title={alt}
          className={embedClassName}
          style={pdfStyle}
        />
      </div>
    );
  }

  const imgStyle: React.CSSProperties | undefined = displayHeight
    ? { height: displayHeight, width: '100%', objectFit: 'contain' }
    : undefined;

  return (
    <div
      className="w-full min-w-0 flex justify-center rounded border border-slate-200 bg-slate-50/80"
      style={displayHeight ? { height: displayHeight } : undefined}
    >
      <img
        src={uri}
        alt={alt}
        className={displayHeight ? 'max-w-full h-full object-contain' : className}
        style={imgStyle}
      />
    </div>
  );
}
