import React from 'react';
import {
  BookOpen,
  Camera,
  FileStack,
  FolderOpen,
  GitBranch,
  Home,
  LogIn,
  Shield,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { canAccessAdminPanel, canUseApp, roleLabel } from '../utils/roles';

const menu = [
  {
    id: 'paper' as const,
    title: '试卷分析',
    desc: '说明整卷录入与考点标注入口；题库录入与审核请在管理员后台「试卷导入」完成。',
    icon: FileStack,
    gradient: 'from-violet-500 to-indigo-600',
    ring: 'ring-violet-200/80',
  },
  {
    id: 'entry' as const,
    title: '错题录入',
    desc: '拍照上传错题，AI 拆解考点、错因与知识网络，并支持自述思路的深度对话。',
    icon: Camera,
    gradient: 'from-emerald-500 to-teal-600',
    ring: 'ring-emerald-200/80',
  },
  {
    id: 'records' as const,
    title: '错题本',
    desc: '云端同步的错题记录；点击题目可回到完整解析页，保留思维交流过程。',
    icon: BookOpen,
    gradient: 'from-sky-500 to-blue-600',
    ring: 'ring-sky-200/80',
  },
  {
    id: 'map' as const,
    title: '知识树',
    desc: '浙教版初中科学知识树、掌握度与共现分析，目录检索与微练习闭环。',
    icon: GitBranch,
    gradient: 'from-amber-500 to-orange-600',
    ring: 'ring-amber-200/80',
  },
  {
    id: 'zhongkao' as const,
    title: '中考资料',
    desc: '浏览本地模考卷、专题与押题 docx/pdf，管理员可拆题入库待审核。',
    icon: FolderOpen,
    gradient: 'from-rose-500 to-pink-600',
    ring: 'ring-rose-200/80',
  },
];

export function HomePage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { user } = useAuth();

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-50 via-white to-emerald-50/50">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage: `radial-gradient(at 20% 20%, rgba(16, 185, 129, 0.15) 0px, transparent 50%),
            radial-gradient(at 80% 0%, rgba(99, 102, 241, 0.12) 0px, transparent 45%),
            radial-gradient(at 50% 80%, rgba(14, 165, 233, 0.1) 0px, transparent 50%)`,
        }}
      />

      <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-10 sm:pt-14">
        <header className="mb-12 flex flex-col gap-6 sm:mb-16 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-2xl space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200/80 bg-emerald-50/90 px-3 py-1 text-xs font-medium text-emerald-900 shadow-sm">
              <Sparkles size={14} className="text-emerald-600" />
              错题分析 · 知识追溯 · 初中科学
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl md:text-5xl">
              错题分析追溯
            </h1>
            <p className="text-base leading-relaxed text-slate-600 sm:text-lg">
              面向初中科学学习的错题工作台：从拍照分析、试卷拆题到知识树掌握度与映射纠错，把「错一次」变成「可追溯、可复习、可验证」的闭环。
            </p>
            <ul className="flex flex-wrap gap-3 text-sm text-slate-600">
              <li className="rounded-lg bg-white/80 px-3 py-1.5 shadow-sm ring-1 ring-slate-200/80">考点自动归纳</li>
              <li className="rounded-lg bg-white/80 px-3 py-1.5 shadow-sm ring-1 ring-slate-200/80">思维交流与盲区检测</li>
              <li className="rounded-lg bg-white/80 px-3 py-1.5 shadow-sm ring-1 ring-slate-200/80">浙教版知识树</li>
            </ul>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:items-end">
            {user ? (
              <span className="rounded-xl border border-slate-200 bg-white/90 px-4 py-2 text-sm text-slate-700 shadow-sm">
                已登录：<strong className="text-slate-900">{user.username}</strong>
                {!canUseApp(user) ? (
                  <span className="ml-2 text-xs text-amber-800 bg-amber-100 px-2 py-0.5 rounded">待审核</span>
                ) : (
                  <span className="ml-2 text-xs text-slate-500">{roleLabel(user.role)}</span>
                )}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate('login')}
                className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-white px-4 py-2.5 text-sm font-semibold text-indigo-800 shadow-sm transition hover:bg-indigo-50"
              >
                <LogIn size={18} />
                登录使用云端错题库
              </button>
            )}
            {user && canAccessAdminPanel(user.role) && canUseApp(user) ? (
              <button
                type="button"
                onClick={() => onNavigate('admin')}
                className="inline-flex items-center gap-2 text-xs font-medium text-slate-500 hover:text-amber-700"
              >
                <Shield size={14} />
                管理后台
              </button>
            ) : null}
          </div>
        </header>

        <section aria-label="功能菜单">
          <h2 className="mb-6 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-500">
            <Home size={16} className="text-emerald-600" />
            功能入口
          </h2>
          <div className="grid gap-5 sm:grid-cols-2">
            {menu.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  className={`group relative overflow-hidden rounded-2xl border border-white/60 bg-white/90 p-6 text-left shadow-lg shadow-slate-200/50 ring-2 transition hover:-translate-y-0.5 hover:shadow-xl ${item.ring}`}
                >
                  <div
                    className={`absolute -right-8 -top-8 h-32 w-32 rounded-full bg-gradient-to-br opacity-20 blur-2xl transition group-hover:opacity-30 ${item.gradient}`}
                  />
                  <div
                    className={`mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md ${item.gradient}`}
                  >
                    <Icon size={24} strokeWidth={2} />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.desc}</p>
                  <span className="mt-4 inline-flex items-center text-sm font-semibold text-emerald-700 opacity-0 transition group-hover:opacity-100">
                    进入 →
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <footer className="mt-16 border-t border-slate-200/80 pt-8 text-center text-xs text-slate-500">
          本地分析依赖浏览器环境变量中的 Gemini；云端功能需启动 API 并登录。
        </footer>
      </div>
    </div>
  );
}
