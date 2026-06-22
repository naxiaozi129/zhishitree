import React from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function markdownUrlTransform(url: string): string {
  if (url.startsWith('data:image/')) return url;
  return defaultUrlTransform(url);
}

interface MarkdownRendererProps {
  content: string;
  className?: string;
  /** relaxed：段落与列表间距更大，适合长文阅读 */
  density?: 'normal' | 'relaxed';
}

/**
 * 与「导出 Markdown」一致：不对 content 做二次改写（sanitize 会破坏 $ 配对，导致与 Typora 等表现不一致）。
 * remark-math 必须在 remark-gfm 之前，否则正文里的 _ 会被 GFM 当成强调，拆坏 LaTeX 下标。
 * KaTeX 默认 output 为 html+MathML；MathML 本应被 CSS 裁切隐藏，但 Tailwind Preflight 等可能破坏 clip，
 * 导致页面上与 .katex-html 叠成「每个公式像显示两遍」。导出 Markdown 在其它编辑器里只渲染一轨，故无此现象。
 */
export function MarkdownRenderer({ content, className, density = 'normal' }: MarkdownRendererProps) {
  const relaxed = density === 'relaxed';

  return (
    <div className={cn('markdown-body max-w-none', relaxed && 'markdown-body-relaxed', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        urlTransform={markdownUrlTransform}
        rehypePlugins={[
          [
            rehypeKatex,
            {
              strict: 'ignore',
              errorColor: '#b91c1c',
              output: 'html',
            },
          ],
        ]}
        components={{
          p: ({ node, ...props }) => (
            <p
              className={cn(
                'last:mb-0',
                relaxed ? 'mb-5 leading-[1.75] text-slate-700' : 'mb-4 leading-relaxed',
              )}
              {...props}
            />
          ),
          h1: ({ node, ...props }) => (
            <h1 className={cn('font-bold text-slate-900', relaxed ? 'text-xl mt-8 mb-4' : 'text-2xl mt-6 mb-4')} {...props} />
          ),
          h2: ({ node, ...props }) => (
            <h2 className={cn('font-bold text-slate-900', relaxed ? 'text-lg mt-7 mb-3' : 'text-xl mt-5 mb-3')} {...props} />
          ),
          h3: ({ node, ...props }) => (
            <h3 className={cn('font-bold text-slate-900', relaxed ? 'text-base mt-6 mb-2.5' : 'text-lg mt-4 mb-2')} {...props} />
          ),
          ul: ({ node, ...props }) => (
            <ul
              className={cn(
                'list-disc pl-5 mb-4',
                relaxed ? 'space-y-2.5 marker:text-indigo-500' : 'space-y-1',
              )}
              {...props}
            />
          ),
          ol: ({ node, ...props }) => (
            <ol
              className={cn(
                'list-decimal pl-5 mb-4',
                relaxed ? 'space-y-2.5 marker:font-semibold marker:text-indigo-600' : 'space-y-1',
              )}
              {...props}
            />
          ),
          li: ({ node, ...props }) => <li className={cn(relaxed ? 'leading-[1.75] pl-1' : 'leading-relaxed')} {...props} />,
          hr: () => <hr className="my-6 border-t border-slate-200" />,
          table: ({ node, ...props }) => (
            <div className="mb-4 overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-sm text-left" {...props} />
            </div>
          ),
          thead: ({ node, ...props }) => <thead className="bg-slate-100 text-slate-800" {...props} />,
          th: ({ node, ...props }) => <th className="px-3 py-2 font-semibold border-b border-slate-200" {...props} />,
          td: ({ node, ...props }) => <td className="px-3 py-2 border-b border-slate-100 text-slate-700" {...props} />,
          blockquote: ({ node, ...props }) => (
            <blockquote
              className={cn(
                'border-l-4 border-indigo-400 bg-indigo-50/50 pl-4 py-2 my-4 rounded-r-lg text-slate-700 not-italic',
                relaxed && 'leading-[1.75]',
              )}
              {...props}
            />
          ),
          code: ({ node, inline, ...props }: any) => {
            return inline ? (
              <code className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-sm font-mono text-indigo-600 dark:text-indigo-400" {...props} />
            ) : (
              <pre className="bg-slate-100 dark:bg-slate-800 p-4 rounded-lg overflow-x-auto mb-4">
                <code className="text-sm font-mono" {...props} />
              </pre>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
