import React from 'react';
import { Clock, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { roleLabel } from '../utils/roles';

export function PendingApprovalPage({ onBack }: { onBack?: () => void }) {
  const { user, logout, refresh } = useAuth();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md bg-white rounded-2xl border border-amber-200 shadow-sm p-8 space-y-6">
        <div className="flex items-center gap-3 text-amber-900">
          <div className="rounded-full bg-amber-100 p-3">
            <Clock size={24} className="text-amber-700" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">等待管理员审核</h1>
            <p className="text-sm text-slate-600 mt-0.5">
              账号 <span className="font-mono font-medium">{user?.username}</span> 已注册
            </p>
          </div>
        </div>

        <p className="text-sm text-slate-600 leading-relaxed">
          新用户需由<strong className="text-slate-800">超级管理员</strong>审核通过后才能使用错题分析、云端同步与知识树等功能。审核通过后请重新登录或点击下方刷新状态。
        </p>

        {user ? (
          <p className="text-xs text-slate-500 rounded-lg bg-slate-50 px-3 py-2 border border-slate-100">
            当前角色：{roleLabel(user.role)}
            {!user.approved ? ' · 未审核' : ' · 已通过'}
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            className="w-full py-3 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700"
          >
            刷新审核状态
          </button>
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="w-full py-3 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-50"
            >
              返回首页
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void logout()}
            className="w-full py-3 rounded-xl border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 inline-flex items-center justify-center gap-2"
          >
            <LogOut size={16} />
            退出登录
          </button>
        </div>
      </div>
    </div>
  );
}
