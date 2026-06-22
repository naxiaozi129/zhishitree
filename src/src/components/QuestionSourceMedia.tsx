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
};

export function QuestionSourceMedia({
  uri,
  mime,
  fileName,
  alt = '原题',
  className = 'max-w-full object-contain',
  embedClassName = 'w-full min-h-[120px] max-h-[200px] rounded border border-slate-200 bg-white',
  emptyClassName = 'flex flex-col items-center justify-center gap-1 text-slate-400 p-4',
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
    return (
      <div className="flex flex-col gap-2 min-w-0">
        <div className="flex items-center gap-2 text-xs text-slate-600 min-w-0">
          <FileText size={16} className="shrink-0 text-indigo-500" />
          <span className="truncate">{fileName || 'PDF 文件'}</span>
        </div>
        <embed src={uri} type="application/pdf" title={alt} className={embedClassName} />
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 flex justify-center">
      <img src={uri} alt={alt} className={className} />
    </div>
  );
}
