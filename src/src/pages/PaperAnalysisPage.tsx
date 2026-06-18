import React from 'react';
import { FileStack, LayoutDashboard } from 'lucide-react';
import { PageChrome } from '../components/PageChrome';
import { useAuth } from '../context/AuthContext';
import { isStaff } from '../utils/roles';

/**
 * 试卷分析（前台）：仅说明与入口指引；整卷录入题库功能在管理后台「试卷导入」。
 */
export function PaperAnalysisPage({
  onBack,
  onNavigate,
}: {
  onBack: () => void;
  onNavigate?: (path: string) => void;
}) {
  const { user, loading } = useAuth();
  const isAdmin = user ? isStaff(user.role) : false;

  return (
    <PageChrome
      title="试卷分析"
      subtitle="整卷录入题库已整合至管理后台，此处为说明与指引"
      onBack={onBack}
      headerExtra={
        <div className="hidden rounded-lg border border-violet-100 bg-violet-50/80 px-2 py-1 text-xs text-violet-800 sm:block">
          <FileStack size={14} className="mr-1 inline" />
          题库录入 · 仅管理员后台
        </div>
      }
    >
      {!loading && !user ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-6 text-sm text-amber-950">
          登录后可查看完整说明。管理员登录后可从此页跳转到管理后台进行试卷导入。
        </div>
      ) : null}

      <div className="mx-auto max-w-2xl space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">整卷录入题库在哪里？</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            <strong>整张试卷</strong>的文本粘贴、规则或 AI 拆题、校对批量入库，以及
            <strong> AI 考点标注并写入待审核队列</strong>
            等功能，均已放在<strong>管理员后台 → 试卷导入</strong>（另有<strong>待审核</strong>
            标签页用于逐条通过或驳回）。
          </p>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            这样可避免与普通「错题录入」混淆，并统一题库治理权限。
          </p>
        </div>

        {user && isAdmin && onNavigate ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/90 p-6 shadow-sm">
            <p className="text-sm font-medium text-emerald-950">你是管理员</p>
            <p className="mt-2 text-sm text-emerald-900/90">
              请在后台打开「试卷导入」完成整卷操作；「待审核」中可处理入库前的题目与标签。
            </p>
            <button
              type="button"
              onClick={() => {
                sessionStorage.setItem('zhishitree_admin_tab', 'import');
                onNavigate('admin');
              }}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700"
            >
              <LayoutDashboard size={18} />
              前往管理后台
            </button>
          </div>
        ) : null}

        {user && !isAdmin ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50/90 p-6 text-sm text-slate-700">
            <p className="font-medium text-slate-900">需要录入试卷？</p>
            <p className="mt-2 leading-relaxed">
              请联系管理员在<strong>管理后台</strong>完成试卷导入与审核发布；若你被授予管理员账号，登录后即可看到「前往管理后台」入口。
            </p>
          </div>
        ) : null}
      </div>
    </PageChrome>
  );
}
