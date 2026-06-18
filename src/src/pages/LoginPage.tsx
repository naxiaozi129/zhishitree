import React, { useState } from 'react';
import { BookOpen, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { PendingApprovalPage } from './PendingApprovalPage';
import { canUseApp, roleLabel, roleBadgeClass } from '../utils/roles';

export function LoginPage({ onDone }: { onDone: () => void }) {
  const { user, login, register, logout, loading } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [registeredPending, setRegisteredPending] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin text-indigo-600" size={36} />
      </div>
    );
  }

  if (user && !canUseApp(user)) {
    return <PendingApprovalPage onBack={onDone} />;
  }

  if (user) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-sm p-8 space-y-6">
          <div className="flex items-center gap-2 text-slate-900 font-bold text-lg">
            <BookOpen className="text-indigo-600" size={22} />
            已登录
          </div>
          <p className="text-slate-600 text-sm">
            当前用户：<span className="font-mono font-medium text-slate-900">{user.username}</span>
            <span className={`ml-2 text-xs px-2 py-0.5 rounded ${roleBadgeClass(user.role)}`}>
              {roleLabel(user.role)}
            </span>
          </p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={onDone}
              className="w-full py-3 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700"
            >
              返回分析首页
            </button>
            <button
              type="button"
              onClick={() => void logout().then(onDone)}
              className="w-full py-3 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-50"
            >
              退出登录
            </button>
          </div>
        </div>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setRegisteredPending(false);
    setBusy(true);
    try {
      if (mode === 'login') {
        const { pendingApproval } = await login(username, password);
        if (pendingApproval) return;
      } else {
        const { pendingApproval } = await register(username, password);
        if (pendingApproval) {
          setRegisteredPending(true);
          return;
        }
      }
      onDone();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '请求失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-sm p-8 space-y-6">
        <div className="flex items-center gap-2 text-slate-900 font-bold text-xl">
          <BookOpen className="text-indigo-600" size={26} />
          账号登录
        </div>
        <p className="text-sm text-slate-500">
          登录后，每次分析完成的错题会自动保存到云端，并参与知识点关联统计。新注册用户需超级管理员审核通过后方可使用。
        </p>

        <div className="flex rounded-lg bg-slate-100 p-1">
          <button
            type="button"
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
              mode === 'login' ? 'bg-white shadow text-slate-900' : 'text-slate-500'
            }`}
            onClick={() => setMode('login')}
          >
            登录
          </button>
          <button
            type="button"
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
              mode === 'register' ? 'bg-white shadow text-slate-900' : 'text-slate-500'
            }`}
            onClick={() => setMode('register')}
          >
            注册
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">用户名</label>
            <input
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">密码</label>
            <input
              type="password"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={6}
            />
          </div>
          {err && <p className="text-sm text-rose-600">{err}</p>}
          {registeredPending ? (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
              注册成功，请等待超级管理员审核。审核通过后再登录即可使用全部功能。
            </p>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="w-full py-3 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 className="animate-spin" size={18} /> : null}
            {mode === 'login' ? '登录' : '注册'}
          </button>
        </form>

        <button type="button" onClick={onDone} className="w-full text-sm text-slate-500 hover:text-slate-800">
          暂不登录，返回首页
        </button>
      </div>
    </div>
  );
}
