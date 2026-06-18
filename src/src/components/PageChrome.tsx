import React from 'react';
import { ArrowLeft } from 'lucide-react';

type PageChromeProps = {
  title: string;
  subtitle?: string;
  onBack: () => void;
  /** 置于标题行右侧，例如 Tab */
  headerExtra?: React.ReactNode;
  /** 置于主导航下方的二级条（如分段 Tab） */
  subNav?: React.ReactNode;
  children: React.ReactNode;
};

/**
 * 内页统一外壳：渐变背景 + 玻璃顶栏，与各功能页风格一致。
 */
export function PageChrome({ title, subtitle, onBack, headerExtra, subNav, children }: PageChromeProps) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-teal-50/40">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/85 backdrop-blur-md shadow-sm shadow-slate-200/40">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <button
            type="button"
            onClick={onBack}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200/80 bg-white text-slate-600 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"
            aria-label="返回首页"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold tracking-tight text-slate-900">{title}</h1>
            {subtitle ? <p className="truncate text-xs text-slate-500">{subtitle}</p> : null}
          </div>
          {headerExtra ? <div className="flex shrink-0 items-center gap-2">{headerExtra}</div> : null}
        </div>
        {subNav ? (
          <div className="border-t border-slate-100/90 bg-slate-50/90">{subNav}</div>
        ) : null}
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
