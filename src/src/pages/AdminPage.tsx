import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BookMarked,
  ClipboardCheck,
  FileStack,
  Loader2,
  Shield,
  FileCode,
  Users,
  Save,
  Upload,
  FileText,
  Sparkles,
  CheckCircle2,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Settings,
  Plus,
  Pencil,
  Star,
  Zap,
  ScanText,
} from 'lucide-react';
import { apiFetch, apiUploadForm, type AdminUserRow, type PreviewSplitResponse, type PaperIngestPendingResponse, type PaperExtractFileResponse, type PaperIngestUploadResponse, type QuestionApiRow, type AiModelsListResponse, type AiModelConfigRow, type AiProvider, type AiModelTestResponse, type QuestionYamlImportResponse, type MineruSettingsResponse, type MineruTestResponse, type MineruSettingsPublic, type MineruApiMode } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { canUseApp, canAccessAdminPanel, canManageUsers, canManageSystemSettings, roleLabel, ROLES } from '../utils/roles';
import { getQuestionAnswerFromRow, splitQuestionAndAnswer } from '../utils/examContentSplit';
import { ExamPaperView, PendingReviewAiSidebar } from '../components/ExamPaperView';

type AdminTab = 'users' | 'draft' | 'import' | 'pending' | 'yaml' | 'settings';

const ADMIN_TAB_STORAGE_KEY = 'zhishitree_admin_tab';

export function AdminPage({ onBack }: { onBack: () => void }) {
  const { user, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<AdminTab>('users');

  useEffect(() => {
    if (!user || !canAccessAdminPanel(user.role)) return;
    const v = sessionStorage.getItem(ADMIN_TAB_STORAGE_KEY);
    if (v === 'import' || v === 'pending' || v === 'draft' || v === 'users' || v === 'yaml' || v === 'settings') {
      setTab(v);
      sessionStorage.removeItem(ADMIN_TAB_STORAGE_KEY);
    } else if (canManageUsers(user.role)) {
      setTab('users');
    } else {
      setTab('draft');
    }
  }, [user]);

  if (!user || !canAccessAdminPanel(user.role) || !canUseApp(user)) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 gap-4">
        <p className="text-slate-600">需要题目管理员或超级管理员权限才能访问后台。</p>
        <button type="button" onClick={onBack} className="text-indigo-600 font-medium">
          返回
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-600"
            aria-label="返回"
          >
            <ArrowLeft size={20} />
          </button>
          <Shield size={20} className="text-amber-600 shrink-0" />
          <h1 className="text-lg font-bold text-slate-900">管理后台</h1>
        </div>
        <nav className="max-w-5xl mx-auto px-4 flex gap-1 border-t border-slate-100 bg-slate-50/80 overflow-x-auto">
          {(
            [
              { id: 'users' as const, label: '账户', icon: Users, show: canManageUsers(user.role) },
              { id: 'draft' as const, label: '题库录入', icon: BookMarked, show: true },
              { id: 'import' as const, label: '试卷导入', icon: FileStack, show: true },
              { id: 'pending' as const, label: '待审核', icon: ClipboardCheck, show: true },
              { id: 'yaml' as const, label: '题库 YAML', icon: FileCode, show: true },
              { id: 'settings' as const, label: '系统设置', icon: Settings, show: canManageSystemSettings(user.role) },
            ] as const
          )
            .filter((t) => t.show)
            .map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === id
                  ? 'border-indigo-600 text-indigo-700 bg-white'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className={`mx-auto px-4 py-8 ${tab === 'pending' ? 'max-w-[min(1600px,100%)]' : 'max-w-5xl'}`}>
        {tab === 'users' && canManageUsers(user.role) ? <AdminUsersPanel authLoading={authLoading} /> : null}
        {tab === 'draft' && <QuestionDraftPanel />}
        {tab === 'import' && <PaperImportPanel />}
        {tab === 'pending' && <PendingReviewPanel />}
        {tab === 'yaml' && <QuestionYamlPanel />}
        {tab === 'settings' && canManageSystemSettings(user.role) ? <SystemSettingsPanel /> : null}
      </main>
    </div>
  );
}

function AdminUsersPanel({ authLoading }: { authLoading: boolean }) {
  const { user, refresh: refreshAuth } = useAuth();
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const data = await apiFetch<{ users: AdminUserRow[] }>('/api/admin/users');
      setUsers(data.users);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || !user || !canManageUsers(user.role)) {
      setLoading(false);
      return;
    }
    void load();
  }, [user, authLoading, load]);

  const patchUser = async (id: number, body: { role?: string; approved?: boolean }) => {
    setBusyId(id);
    setErr(null);
    try {
      await apiFetch(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      await load();
      if (user?.id === id) await refreshAuth();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '更新失败');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="animate-spin text-indigo-600" size={32} />
      </div>
    );
  }
  if (err) {
    return <p className="text-rose-600 text-sm">{err}</p>;
  }

  const pendingCount = users.filter((u) => !u.approved && u.role !== ROLES.SUPER_ADMIN && u.role !== 'admin').length;

  return (
    <div className="space-y-4">
      {pendingCount > 0 ? (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
          有 <strong>{pendingCount}</strong> 个账号待审核，通过后用户方可使用系统。
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm text-left min-w-[720px]">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 font-medium">ID</th>
              <th className="px-4 py-3 font-medium">用户名</th>
              <th className="px-4 py-3 font-medium">角色</th>
              <th className="px-4 py-3 font-medium">审核</th>
              <th className="px-4 py-3 font-medium">错题数</th>
              <th className="px-4 py-3 font-medium">注册时间</th>
              <th className="px-4 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => {
              const isSelf = user?.id === u.id;
              const busy = busyId === u.id;
              return (
                <tr key={u.id} className={`hover:bg-slate-50/80 ${!u.approved ? 'bg-amber-50/40' : ''}`}>
                  <td className="px-4 py-3 font-mono text-slate-500">{u.id}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{u.username}</td>
                  <td className="px-4 py-3">
                    <select
                      value={u.role === 'admin' ? ROLES.SUPER_ADMIN : u.role}
                      disabled={busy || isSelf}
                      onChange={(e) => void patchUser(u.id, { role: e.target.value })}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs disabled:opacity-50"
                    >
                      <option value={ROLES.USER}>{roleLabel(ROLES.USER)}</option>
                      <option value={ROLES.QUESTION_ADMIN}>{roleLabel(ROLES.QUESTION_ADMIN)}</option>
                      <option value={ROLES.SUPER_ADMIN}>{roleLabel(ROLES.SUPER_ADMIN)}</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    {u.approved ? (
                      <span className="text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">已通过</span>
                    ) : (
                      <span className="text-xs text-amber-800 bg-amber-100 px-2 py-0.5 rounded">待审核</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{u.mistake_count}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{u.created_at}</td>
                  <td className="px-4 py-3">
                    {!u.approved ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void patchUser(u.id, { approved: true })}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {busy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                        通过
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy || isSelf}
                        onClick={() => {
                          if (window.confirm(`确定撤销 ${u.username} 的使用权限？`)) {
                            void patchUser(u.id, { approved: false });
                          }
                        }}
                        className="text-xs text-slate-500 hover:text-rose-700 disabled:opacity-40"
                      >
                        撤销
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function QuestionDraftPanel() {
  const [draftId, setDraftId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [stem, setStem] = useState('');
  const [subject, setSubject] = useState('');
  const [difficulty, setDifficulty] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const savingRef = useRef(false);

  const persist = useCallback(async () => {
    if (draftId === null) {
      const hasContent =
        stem.trim().length > 0 || title.trim().length > 0 || notes.trim().length > 0 || difficulty !== '';
      if (!hasContent) return;
    }

    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = {};
      if (notes.trim()) body.notes = notes.trim();

      let diff: number | null = null;
      if (difficulty !== '') {
        const n = Number(difficulty);
        if (!Number.isNaN(n) && n >= 1 && n <= 5) diff = Math.round(n);
      }

      if (draftId !== null) {
        await apiFetch(`/api/questions/${draftId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            title: title.trim() || null,
            stem: stem.trim() || '(未输入题干)',
            subject: subject.trim() || null,
            difficulty: diff,
            body: Object.keys(body).length ? body : {},
          }),
        });
      } else {
        const res = await apiFetch<{ id: number }>('/api/questions', {
          method: 'POST',
          body: JSON.stringify({
            status: 'draft',
            source: 'manual',
            title: title.trim() || null,
            stem: stem.trim() || '(未输入题干)',
            subject: subject.trim() || null,
            difficulty: diff,
            body: Object.keys(body).length ? body : {},
          }),
        });
        setDraftId(res.id);
      }
      setLastSaved(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '保存失败');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [draftId, stem, title, subject, difficulty, notes]);

  useEffect(() => {
    if (draftId === null) {
      const hasContent =
        stem.trim().length > 0 || title.trim().length > 0 || notes.trim().length > 0 || difficulty !== '';
      if (!hasContent) return;
    }

    const t = window.setTimeout(() => {
      void persist();
    }, 1100);
    return () => clearTimeout(t);
  }, [stem, title, subject, difficulty, notes, draftId, persist]);

  const publish = async () => {
    setErr(null);
    try {
      let id = draftId;
      if (id === null) {
        const hasContent =
          stem.trim().length > 0 || title.trim().length > 0 || notes.trim().length > 0 || difficulty !== '';
        if (!hasContent) {
          setErr('请先输入题干、标题或备注后再发布');
          return;
        }
        savingRef.current = true;
        setSaving(true);
        const body: Record<string, unknown> = {};
        if (notes.trim()) body.notes = notes.trim();
        let diff: number | null = null;
        if (difficulty !== '') {
          const n = Number(difficulty);
          if (!Number.isNaN(n) && n >= 1 && n <= 5) diff = Math.round(n);
        }
        const res = await apiFetch<{ id: number }>('/api/questions', {
          method: 'POST',
          body: JSON.stringify({
            status: 'draft',
            source: 'manual',
            title: title.trim() || null,
            stem: stem.trim() || '(未输入题干)',
            subject: subject.trim() || null,
            difficulty: diff,
            body: Object.keys(body).length ? body : {},
          }),
        });
        id = res.id;
        setDraftId(id);
        savingRef.current = false;
        setSaving(false);
      }
      await apiFetch(`/api/questions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'published' }),
      });
      setLastSaved(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setDraftId(null);
      setTitle('');
      setStem('');
      setSubject('');
      setDifficulty('');
      setNotes('');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '发布失败');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const newDraft = () => {
    setDraftId(null);
    setTitle('');
    setStem('');
    setSubject('');
    setDifficulty('');
    setNotes('');
    setLastSaved(null);
    setErr(null);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">单题录入</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              编辑内容会在约 1 秒后自动保存为草稿；完成后点击「发布到题库」。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {saving && (
              <span className="text-xs text-slate-500 flex items-center gap-1">
                <Loader2 size={14} className="animate-spin" /> 保存中…
              </span>
            )}
            {lastSaved && !saving && (
              <span className="text-xs text-emerald-600 flex items-center gap-1">
                <Save size={14} /> 已保存 {lastSaved}
              </span>
            )}
            {draftId !== null && (
              <span className="text-xs font-mono text-slate-400">草稿 #{draftId}</span>
            )}
          </div>
        </div>

        {err && <p className="text-sm text-rose-600">{err}</p>}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="text-xs font-medium text-slate-600">标题（可选）</span>
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="如：串联电路 · 基础"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">学科</span>
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="物理"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">难度 1～5（可选）</span>
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
              placeholder="留空表示未标注"
              inputMode="numeric"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-xs font-medium text-slate-600">题干 *</span>
            <textarea
              className="mt-1 w-full min-h-[140px] rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono leading-relaxed"
              value={stem}
              onChange={(e) => setStem(e.target.value)}
              placeholder="输入题目全文（含选项、图序说明等）"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-xs font-medium text-slate-600">备注 / 解析草稿（可选，保存在 body）</span>
            <textarea
              className="mt-1 w-full min-h-[72px] rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="教师备注，可先写要点再发布"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-3 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={() => void publish()}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <CheckCircle2 size={18} />
            发布到题库
          </button>
          <button
            type="button"
            onClick={newDraft}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            新建一空草稿
          </button>
        </div>
      </div>
    </div>
  );
}

function parsePendingBody(row: QuestionApiRow) {
  const body = row.body || {};
  const examPoints = Array.isArray(body.examPoints)
    ? (body.examPoints as unknown[]).map((x) => String(x))
    : [];
  const tagLabels = Array.isArray(body.tagLabels)
    ? (body.tagLabels as unknown[]).map((x) => String(x))
    : [];
  const preview = Array.isArray(body.scienceMatchPreview)
    ? (body.scienceMatchPreview as {
        label?: string;
        path?: string;
        score?: number;
        reasons?: string[];
      }[])
    : [];
  return {
    examPoints,
    tagLabels,
    preview,
    batch: typeof body.paperBatchKey === 'string' ? body.paperBatchKey : '',
    paperTitle: typeof body.paperTitle === 'string' ? body.paperTitle : '',
    sourceRelPath: typeof body.sourceRelPath === 'string' ? body.sourceRelPath : '',
    answerText: typeof body.answerText === 'string' ? body.answerText : '',
  };
}

function stemPreview(row: QuestionApiRow, max = 56): string {
  const { question } = getQuestionAnswerFromRow(row.stem, row.body);
  const t = question.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function PendingReviewPanel() {
  const [items, setItems] = useState<QuestionApiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [batchFilter, setBatchFilter] = useState<string>('');
  const [checkedIds, setCheckedIds] = useState<Set<number>>(() => new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const data = await apiFetch<{ items: QuestionApiRow[] }>('/api/questions?status=pending&limit=200');
      setItems(data.items);
      setSelectedId((prev) => {
        if (prev && data.items.some((x) => x.id === prev)) return prev;
        return data.items[0]?.id ?? null;
      });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const batches = useMemo(() => {
    const set = new Set<string>();
    for (const row of items) {
      const b = parsePendingBody(row).batch;
      if (b) set.add(b);
    }
    return [...set].sort();
  }, [items]);

  const filtered = useMemo(() => {
    if (!batchFilter) return items;
    return items.filter((row) => parsePendingBody(row).batch === batchFilter);
  }, [items, batchFilter]);

  const selectedIndex = selectedId != null ? filtered.findIndex((r) => r.id === selectedId) : -1;
  const selected = selectedIndex >= 0 ? filtered[selectedIndex] : filtered[0] ?? null;

  useEffect(() => {
    if (filtered.length === 0) {
      setSelectedId(null);
      return;
    }
    if (selectedId == null || !filtered.some((r) => r.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  useEffect(() => {
    setCheckedIds((prev) => {
      const allowed = new Set(filtered.map((r) => r.id));
      const next = new Set([...prev].filter((id) => allowed.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [filtered]);

  const toggleChecked = (id: number) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllFiltered = () => {
    setCheckedIds(new Set(filtered.map((r) => r.id)));
  };

  const clearChecked = () => setCheckedIds(new Set());

  const batchDelete = async () => {
    const ids = [...checkedIds];
    if (ids.length === 0) return;
    if (!window.confirm(`确定批量删除选中的 ${ids.length} 条待审核题目？此操作不可恢复。`)) return;
    setBatchDeleting(true);
    setErr(null);
    try {
      await apiFetch<{ ok: boolean; count: number }>('/api/questions/batch-delete', {
        method: 'POST',
        body: JSON.stringify({ ids, onlyPending: true }),
      });
      setCheckedIds(new Set());
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '批量删除失败');
    } finally {
      setBatchDeleting(false);
    }
  };

  const goRelative = (delta: number) => {
    if (!filtered.length || selectedIndex < 0) return;
    const next = Math.max(0, Math.min(filtered.length - 1, selectedIndex + delta));
    setSelectedId(filtered[next].id);
  };

  const approve = async (id: number) => {
    setBusyId(id);
    setErr(null);
    const idx = filtered.findIndex((r) => r.id === id);
    try {
      await apiFetch(`/api/questions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'published' }),
      });
      const data = await apiFetch<{ items: QuestionApiRow[] }>('/api/questions?status=pending&limit=200');
      setItems(data.items);
      const nextFiltered = batchFilter
        ? data.items.filter((r) => parsePendingBody(r).batch === batchFilter)
        : data.items;
      if (nextFiltered.length === 0) setSelectedId(null);
      else setSelectedId(nextFiltered[Math.min(idx, nextFiltered.length - 1)]?.id ?? nextFiltered[0].id);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (id: number) => {
    if (!window.confirm('确定驳回并删除该条待审核题目？')) return;
    setBusyId(id);
    setErr(null);
    const idx = filtered.findIndex((r) => r.id === id);
    try {
      await apiFetch(`/api/questions/${id}`, { method: 'DELETE' });
      const data = await apiFetch<{ items: QuestionApiRow[] }>('/api/questions?status=pending&limit=200');
      setItems(data.items);
      const nextFiltered = batchFilter
        ? data.items.filter((r) => parsePendingBody(r).batch === batchFilter)
        : data.items;
      if (nextFiltered.length === 0) setSelectedId(null);
      else setSelectedId(nextFiltered[Math.min(idx, nextFiltered.length - 1)]?.id ?? nextFiltered[0].id);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '删除失败');
    } finally {
      setBusyId(null);
    }
  };

  const goRelativeRef = useRef(goRelative);
  goRelativeRef.current = goRelative;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const approveRef = useRef(approve);
  approveRef.current = approve;
  const rejectRef = useRef(reject);
  rejectRef.current = reject;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (tabTargetIsInput(e.target)) return;
      if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        goRelativeRef.current(-1);
      } else if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        goRelativeRef.current(1);
      } else if (e.key === 'a' && selectedRef.current) {
        e.preventDefault();
        void approveRef.current(selectedRef.current.id);
      } else if (e.key === 'd' && selectedRef.current) {
        e.preventDefault();
        void rejectRef.current(selectedRef.current.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (loading && items.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="animate-spin text-indigo-600" size={32} />
      </div>
    );
  }

  const meta = selected ? parsePendingBody(selected) : null;
  const contentBlocks = selected ? getQuestionAnswerFromRow(selected.stem, selected.body) : null;
  const posLabel =
    selected && selectedIndex >= 0 ? `${selectedIndex + 1} / ${filtered.length}` : '—';

  return (
    <div className="admin-pending-review flex flex-col gap-3 min-h-[calc(100vh-10rem)]">
      <div className="rounded-lg border border-amber-200 bg-amber-50/90 px-4 py-2.5 text-xs text-amber-950 flex flex-wrap items-center justify-between gap-2">
        <p>
          <strong>待审核队列</strong>
          <span className="mx-2 text-amber-300">|</span>
          左侧选题；右侧按<strong>试卷顺序</strong>纵向阅读（题干 → 答案），右侧栏为 AI 参考；快捷键 ↑↓ 切换，<kbd className="admin-kbd">A</kbd> 通过，<kbd className="admin-kbd">D</kbd> 驳回
        </p>
        <div className="flex items-center gap-2">
          <select
            value={batchFilter}
            onChange={(e) => setBatchFilter(e.target.value)}
            className="rounded-lg border border-amber-200 bg-white px-2 py-1 text-xs"
          >
            <option value="">全部批次 ({items.length})</option>
            {batches.map((b) => (
              <option key={b} value={b}>
                {b.slice(0, 36)}…
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium hover:bg-slate-50"
          >
            刷新
          </button>
          {filtered.length > 0 ? (
            <>
              <button
                type="button"
                onClick={selectAllFiltered}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium hover:bg-slate-50"
              >
                全选({filtered.length})
              </button>
              <button
                type="button"
                disabled={checkedIds.size === 0 || batchDeleting}
                onClick={() => void batchDelete()}
                className="inline-flex items-center gap-1 rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-800 hover:bg-rose-100 disabled:opacity-40"
              >
                {batchDeleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                批量删除{checkedIds.size > 0 ? ` (${checkedIds.size})` : ''}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {err ? <p className="text-sm text-rose-600">{err}</p> : null}

      {filtered.length === 0 ? (
        <p className="text-sm text-slate-500 py-16 text-center">暂无待审核题目。</p>
      ) : (
        <div className="flex flex-1 min-h-0 gap-0 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {/* 左侧队列 — 参考 OJ 表格扫视 */}
          <aside className="w-[min(360px,38%)] shrink-0 border-r border-slate-200 flex flex-col min-h-0">
            <div className="grid grid-cols-[28px_52px_1fr] gap-0 border-b border-slate-100 bg-slate-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500 items-center">
              <input
                type="checkbox"
                checked={filtered.length > 0 && filtered.every((r) => checkedIds.has(r.id))}
                ref={(el) => {
                  if (el) {
                    el.indeterminate =
                      checkedIds.size > 0 && checkedIds.size < filtered.length;
                  }
                }}
                onChange={(e) => {
                  if (e.target.checked) selectAllFiltered();
                  else clearChecked();
                }}
                aria-label="全选当前列表"
                className="rounded border-slate-300"
              />
              <span>ID</span>
              <span>题干摘要</span>
            </div>
            <ul className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {filtered.map((row) => {
                const active = selected?.id === row.id;
                const b = parsePendingBody(row);
                const checked = checkedIds.has(row.id);
                return (
                  <li
                    key={row.id}
                    className={`grid grid-cols-[28px_1fr] items-start ${
                      active ? 'bg-indigo-50/80' : checked ? 'bg-rose-50/40' : ''
                    }`}
                  >
                    <div className="flex items-start justify-center pt-3 pl-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleChecked(row.id)}
                        aria-label={`选中 #${row.id}`}
                        className="rounded border-slate-300"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedId(row.id)}
                      className={`w-full text-left px-3 py-2.5 transition-colors grid grid-cols-[52px_1fr] gap-2 items-start ${
                        active ? 'ring-1 ring-inset ring-indigo-200' : 'hover:bg-slate-50'
                      }`}
                    >
                      <span className="font-mono text-xs text-slate-500">#{row.id}</span>
                      <span className="min-w-0">
                        {row.title ? (
                          <span className="block text-xs font-medium text-indigo-700 truncate">{row.title}</span>
                        ) : null}
                        <span className="block text-xs text-slate-700 line-clamp-2 leading-snug">
                          {stemPreview(row)}
                        </span>
                        {b.batch ? (
                          <span className="mt-1 block font-mono text-[10px] text-slate-400 truncate">{b.batch}</span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>

          {/* 右侧详情 — 参考 OJ 错题审核分栏 */}
          {selected && meta ? (
            <div className="flex-1 flex flex-col min-w-0 min-h-0">
              <div className="shrink-0 border-b border-slate-200 bg-slate-50/90 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 text-xs text-slate-600 space-y-0.5">
                  <p>
                    <span className="font-mono font-semibold text-slate-800">#{selected.id}</span>
                    <span className="mx-2 text-slate-300">·</span>
                    第 <strong>{posLabel}</strong> 条
                    {selected.subject ? (
                      <>
                        <span className="mx-2 text-slate-300">·</span>
                        {selected.subject}
                      </>
                    ) : null}
                  </p>
                  {meta.paperTitle ? (
                    <p className="truncate text-indigo-800 font-medium">{meta.paperTitle}</p>
                  ) : null}
                  {meta.sourceRelPath ? (
                    <p className="truncate font-mono text-[10px] text-slate-400">{meta.sourceRelPath}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={selectedIndex <= 0}
                    onClick={() => goRelative(-1)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs disabled:opacity-40"
                  >
                    <ChevronLeft size={14} />
                    上一条
                  </button>
                  <button
                    type="button"
                    disabled={busyId === selected.id}
                    onClick={() => void approve(selected.id)}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {busyId === selected.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <CheckCircle2 size={14} />
                    )}
                    通过发布
                  </button>
                  <button
                    type="button"
                    disabled={busyId === selected.id}
                    onClick={() => void reject(selected.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-800 hover:bg-rose-100 disabled:opacity-50"
                  >
                    <Trash2 size={14} />
                    驳回
                  </button>
                  <button
                    type="button"
                    disabled={selectedIndex >= filtered.length - 1}
                    onClick={() => goRelative(1)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs disabled:opacity-40"
                  >
                    下一条
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>

              <div className="flex-1 flex flex-col xl:flex-row min-h-0">
                <div className="flex-1 min-h-0 overflow-y-auto exam-paper-scroll px-4 py-5 sm:px-6">
                  <ExamPaperView
                    title={selected.title}
                    paperTitle={meta.paperTitle}
                    subject={selected.subject}
                    question={contentBlocks?.question ?? selected.stem}
                    answer={contentBlocks?.answer}
                    body={selected.body}
                  />
                </div>
                <aside className="shrink-0 border-t xl:border-t-0 xl:border-l border-slate-200 bg-white flex flex-col min-h-0 max-h-[42vh] xl:max-h-none xl:w-[min(340px,32%)]">
                  <PendingReviewAiSidebar meta={meta} />
                </aside>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function tabTargetIsInput(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

type ImportRow = {
  title: string | null;
  stem: string;
  body: Record<string, unknown>;
  selected: boolean;
  subject: string;
};

const PAPER_UPLOAD_ACCEPT = '.docx,.doc,.pdf,.txt,.md';
const PAPER_UPLOAD_RE = /\.(docx|doc|pdf|txt|md)$/i;

export function PaperImportPanel() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [raw, setRaw] = useState('');
  const [paperTitle, setPaperTitle] = useState('');
  const [useAi, setUseAi] = useState(true);
  const [analyzeExamWithAi, setAnalyzeExamWithAi] = useState(true);
  const [splitting, setSplitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [ingestPending, setIngestPending] = useState(false);
  const [extractingFile, setExtractingFile] = useState(false);
  const [uploadIngestBusy, setUploadIngestBusy] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [uploadCharCount, setUploadCharCount] = useState<number | null>(null);
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [method, setMethod] = useState<string | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [defaultSubject, setDefaultSubject] = useState('');
  const [publish, setPublish] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [lastBatchKey, setLastBatchKey] = useState<string | null>(null);
  const [extractedImages, setExtractedImages] = useState<
    Record<string, { id: string; mime: string; data: string; alt?: string | null }> | null
  >(null);
  const [extractedImageCount, setExtractedImageCount] = useState(0);

  const ingestFormFields = () => ({
    paperTitle: paperTitle.trim() || undefined,
    defaultSubject: defaultSubject.trim() || undefined,
    useAiSplit: useAi,
    analyzeWithAi: analyzeExamWithAi,
  });

  const handlePaperFile = async (file: File | null) => {
    if (!file) return;
    if (!PAPER_UPLOAD_RE.test(file.name)) {
      setErr('仅支持 docx / pdf / txt 格式');
      return;
    }
    setErr(null);
    setExtractingFile(true);
    setPendingUploadFile(file);
    const localBaseName = file.name.replace(/\.(docx|doc|pdf|txt|md)$/i, '');
    setUploadedFileName(file.name);
    try {
      const data = await apiUploadForm<PaperExtractFileResponse>('/api/questions/paper-extract-file', file);
      setRaw(data.text);
      setUploadedFileName(data.originalName || file.name);
      setUploadCharCount(data.charCount);
      setPaperTitle(data.fileName || localBaseName);
      setRows([]);
      setMethod(null);
      setExtractedImages(data.images ?? null);
      setExtractedImageCount(data.imageCount ?? (data.images ? Object.keys(data.images).length : 0));
    } catch (e: unknown) {
      setPendingUploadFile(null);
      setUploadedFileName(null);
      setUploadCharCount(null);
      setExtractedImages(null);
      setExtractedImageCount(0);
      setErr(e instanceof Error ? e.message : '文件解析失败');
    } finally {
      setExtractingFile(false);
    }
  };

  const runUploadIngest = async (file: File) => {
    setErr(null);
    setUploadIngestBusy(true);
    try {
      const data = await apiUploadForm<PaperIngestUploadResponse>(
        '/api/questions/paper-ingest-upload',
        file,
        ingestFormFields(),
      );
      setLastBatchKey(data.batchKey);
      setUploadedFileName(data.originalName);
      alert(
        `已从文件入库 ${data.count} 道题（待审核）。\n文件：${data.originalName}\n批次：${data.batchKey}\n拆题方式：${data.splitMethod}\n请在「待审核」中逐条通过或驳回。`,
      );
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '上传入库失败');
    } finally {
      setUploadIngestBusy(false);
    }
  };

  const runSplit = async () => {
    setErr(null);
    setSplitting(true);
    try {
      const data = await apiFetch<PreviewSplitResponse>('/api/questions/preview-split', {
        method: 'POST',
        body: JSON.stringify({ text: raw, useAi }),
      });
      setMethod(data.method);
      setRows(
        data.items.map((it) => ({
          title: it.title,
          stem: it.stem,
          body: it.body,
          selected: true,
          subject: defaultSubject.trim(),
        })),
      );
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '拆分失败');
    } finally {
      setSplitting(false);
    }
  };

  /** 拆题 + AI 考点 + 知识树标签 → 后台 pending，待人审 */
  const runIngestPending = async () => {
    if (!raw.trim()) {
      setErr('请先粘贴试卷正文');
      return;
    }
    setErr(null);
    setIngestPending(true);
    try {
      const data = await apiFetch<PaperIngestPendingResponse>('/api/questions/paper-ingest-pending', {
        method: 'POST',
        body: JSON.stringify({
          text: raw,
          paperTitle: paperTitle.trim() || null,
          defaultSubject: defaultSubject.trim() || null,
          useAiSplit: useAi,
          analyzeWithAi: analyzeExamWithAi,
          images: extractedImages ?? undefined,
        }),
      });
      setLastBatchKey(data.batchKey);
      alert(
        `已写入待审核题库 ${data.count} 道题。\n批次：${data.batchKey}\n拆题方式：${data.splitMethod}\n请在管理后台「待审核」中逐条通过或驳回。`,
      );
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '入库失败');
    } finally {
      setIngestPending(false);
    }
  };

  const updateRow = (index: number, patch: Partial<ImportRow>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const runImport = async () => {
    const items = rows
      .filter((r) => r.selected && r.stem.trim())
      .map((r) => ({
        title: r.title,
        stem: r.stem.trim(),
        subject: r.subject.trim() || defaultSubject.trim() || null,
        body: r.body,
      }));
    if (items.length === 0) {
      setErr('请至少勾选并保留一道有效题目（题干非空）');
      return;
    }
    setErr(null);
    setImporting(true);
    try {
      await apiFetch('/api/questions/import-batch', {
        method: 'POST',
        body: JSON.stringify({
          items,
          publish,
          defaultSubject: defaultSubject.trim() || null,
        }),
      });
      setRows([]);
      setRaw('');
      setMethod(null);
      alert(`已成功入库 ${items.length} 道题`);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '入库失败');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {err ? <p className="text-sm text-rose-600">{err}</p> : null}

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <h2 className="text-base font-semibold text-slate-900">整卷录入 · 粘贴或上传</h2>
        <p className="text-sm text-slate-500">
          支持<strong>粘贴整卷文本</strong>，或直接<strong>上传 docx / pdf / txt</strong> 自动提取正文。可使用规则拆题或 AI
          拆题（需在 <strong>系统设置</strong> 配置 AI 模型，或设置环境变量{' '}
          <code className="rounded bg-slate-100 px-1 text-xs">GEMINI_API_KEY</code>
          ）。拆分后可在表格中校对，再批量入库。
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept={PAPER_UPLOAD_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            void handlePaperFile(f);
            e.target.value = '';
          }}
        />

        <div
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
          }}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            e.currentTarget.classList.add('border-indigo-400', 'bg-indigo-50/40');
          }}
          onDragLeave={(e) => {
            e.currentTarget.classList.remove('border-indigo-400', 'bg-indigo-50/40');
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.currentTarget.classList.remove('border-indigo-400', 'bg-indigo-50/40');
            const f = e.dataTransfer.files?.[0] ?? null;
            void handlePaperFile(f);
          }}
          className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/50 px-4 py-8 text-center cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors"
        >
          {extractingFile ? (
            <>
              <Loader2 size={28} className="animate-spin text-indigo-500" />
              <p className="text-sm text-slate-600">正在提取文件正文…</p>
            </>
          ) : (
            <>
              <Upload size={28} className="text-indigo-500" />
              <p className="text-sm font-medium text-slate-700">点击或拖拽上传试卷文件</p>
              <p className="text-xs text-slate-500">docx · pdf · txt，单文件最大 15MB</p>
            </>
          )}
        </div>

        {uploadedFileName ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs text-indigo-900">
            <FileText size={14} />
            <span className="font-medium truncate max-w-[280px]" title={uploadedFileName}>
              {uploadedFileName}
            </span>
            {uploadCharCount != null ? <span className="text-indigo-700/80">· {uploadCharCount.toLocaleString()} 字</span> : null}
            {extractedImageCount > 0 ? (
              <span className="text-emerald-700/90">· 已提取 {extractedImageCount} 张图片</span>
            ) : null}
            <button
              type="button"
              className="ml-auto text-indigo-600 hover:underline"
              onClick={() => {
                setUploadedFileName(null);
                setUploadCharCount(null);
      setExtractedImages(null);
      setExtractedImageCount(0);
                setPendingUploadFile(null);
              }}
            >
              清除
            </button>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs">
            <span className="text-slate-600">试卷名称（可选，写入题目元数据）</span>
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={paperTitle}
              onChange={(e) => setPaperTitle(e.target.value)}
              placeholder="例如：2024 某某区一模 科学"
            />
          </label>
          <label className="block text-xs">
            <span className="text-slate-600">默认学科（可选）</span>
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={defaultSubject}
              onChange={(e) => setDefaultSubject(e.target.value)}
              placeholder="科学"
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
          <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />
          <Sparkles size={16} className="text-amber-500" />
          规则拆题异常时使用 AI 拆题（默认按题号 1．2．3． 逐题拆分，不会把整段选择题/填空题合成一块）
        </label>

        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={analyzeExamWithAi}
            onChange={(e) => setAnalyzeExamWithAi(e.target.checked)}
          />
          <Sparkles size={16} className="text-violet-500" />
          AI 归纳考点并匹配知识树标签（关闭则仅用语干关键词匹配树）
        </label>

        <textarea
          className="w-full min-h-[200px] rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="在此粘贴整卷文本…"
        />

        <div className="rounded-lg border border-emerald-200 bg-emerald-50/80 px-4 py-3 space-y-2">
          <p className="text-sm font-medium text-emerald-900">整卷录入 → 待审核题库（推荐）</p>
          <p className="text-xs text-emerald-800/90 leading-relaxed">
            自动拆题后，逐题调用模型写出<strong>考查要点</strong>与<strong>标签</strong>，并与内置初中科学知识树对齐写入{' '}
            <code className="rounded bg-white/80 px-1">scienceNodeIds</code>。题目与标签均为<strong>待审核</strong>
            ，通过后才会出现在学生可见题库。
          </p>
          <button
            type="button"
            disabled={ingestPending || splitting || !raw.trim()}
            onClick={() => void runIngestPending()}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {ingestPending ? <Loader2 size={18} className="animate-spin" /> : <ClipboardCheck size={18} />}
            整卷解析并写入待审核
          </button>
          {pendingUploadFile ? (
            <button
              type="button"
              disabled={uploadIngestBusy || extractingFile || ingestPending}
              onClick={() => void runUploadIngest(pendingUploadFile)}
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-600 bg-white px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
            >
              {uploadIngestBusy ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
              上传文件并直接写入待审核
            </button>
          ) : null}
          {lastBatchKey ? (
            <p className="text-[11px] text-emerald-800 font-mono break-all">上一批次：{lastBatchKey}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-3 pt-1 border-t border-slate-100">
          <button
            type="button"
            disabled={splitting || !raw.trim()}
            onClick={() => void runSplit()}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {splitting ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
            仅解析试卷（校对后手动入库）
          </button>
          {method && (
            <span className="text-xs text-slate-500 self-center">
              上次方式：<strong>{method}</strong>，共 {rows.length} 块
            </span>
          )}
        </div>
      </div>

      {rows.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
          <h3 className="text-sm font-semibold text-slate-800">校对并入题库</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs">
              <span className="text-slate-600">默认学科（逐题可改）</span>
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={defaultSubject}
                onChange={(e) => setDefaultSubject(e.target.value)}
                placeholder="物理"
              />
            </label>
            <label className="flex items-center gap-2 text-sm mt-6 sm:mt-0 sm:items-end pb-2">
              <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
              入库后直接发布（关闭则保存为草稿）
            </label>
          </div>

          <div className="space-y-4 max-h-[520px] overflow-y-auto pr-1">
            {rows.map((row, i) => (
              <div key={i} className="rounded-lg border border-slate-100 bg-slate-50/80 p-4 space-y-2">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={row.selected}
                    onChange={(e) => updateRow(i, { selected: e.target.checked })}
                  />
                  <span className="text-xs font-mono text-slate-400">#{i + 1}</span>
                  {row.title && (
                    <span className="text-xs text-indigo-600 truncate max-w-[200px]">{row.title}</span>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-1 lg:grid-cols-2">
                  <label className="block text-xs">
                    <span className="text-slate-600 font-medium">题目</span>
                    <textarea
                      className="mt-1 w-full min-h-[120px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                      value={row.stem}
                      onChange={(e) => updateRow(i, { stem: e.target.value })}
                    />
                  </label>
                  {typeof row.body.answerText === 'string' && row.body.answerText.trim() ? (
                    <label className="block text-xs">
                      <span className="text-amber-800 font-medium">答案解析</span>
                      <textarea
                        className="mt-1 w-full min-h-[120px] rounded-lg border border-amber-200 bg-amber-50/50 px-2 py-1.5 text-sm"
                        value={String(row.body.answerText)}
                        onChange={(e) =>
                          updateRow(i, { body: { ...row.body, answerText: e.target.value } })
                        }
                      />
                    </label>
                  ) : null}
                </div>
                <input
                  className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
                  placeholder="本题学科（可空则用默认）"
                  value={row.subject}
                  onChange={(e) => updateRow(i, { subject: e.target.value })}
                />
              </div>
            ))}
          </div>

          <button
            type="button"
            disabled={importing}
            onClick={() => void runImport()}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {importing ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
            将勾选题目批量入库
          </button>
        </div>
      )}
    </div>
  );
}

function QuestionYamlPanel() {
  const yamlFileRef = useRef<HTMLInputElement>(null);
  const [exportStatus, setExportStatus] = useState<'all' | 'published' | 'pending' | 'draft'>('all');
  const [importStatus, setImportStatus] = useState<'published' | 'pending' | 'draft'>('published');
  const [importSubject, setImportSubject] = useState('');
  const [yamlText, setYamlText] = useState('');
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const downloadExport = async () => {
    setExporting(true);
    setErr(null);
    setMessage('');
    try {
      const q = exportStatus === 'all' ? '' : `?status=${exportStatus}`;
      const r = await fetch(`/api/questions/export/yaml${q}`, { credentials: 'include' });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || r.statusText);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `questions-${new Date().toISOString().slice(0, 10)}.yaml`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage('YAML 已下载（图片在 images 字段中以 base64 保存）');
    } catch (e) {
      setErr(e instanceof Error ? e.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const runImport = async () => {
    if (!yamlText.trim()) {
      setErr('请先粘贴或上传 YAML 文件');
      return;
    }
    setImporting(true);
    setErr(null);
    setMessage('');
    try {
      const data = await apiFetch<QuestionYamlImportResponse>('/api/questions/import-yaml', {
        method: 'POST',
        body: JSON.stringify({
          yaml: yamlText,
          defaultStatus: importStatus,
          defaultSubject: importSubject.trim() || null,
        }),
      });
      setMessage(`已导入 ${data.count} 道题${data.skippedErrors?.length ? `（${data.skippedErrors.length} 条跳过）` : ''}`);
      if (data.skippedErrors?.length) setErr(data.skippedErrors.join('\n'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : '导入失败');
    } finally {
      setImporting(false);
    }
  };

  const onYamlFile = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setYamlText(String(reader.result ?? ''));
      setErr(null);
    };
    reader.readAsText(file, 'utf-8');
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <FileCode size={18} className="text-indigo-600" />
            题库 YAML 管理
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            题目导出为 YAML 便于版本管理与批量编辑；<strong>图片</strong>保存在每题的{' '}
            <code className="rounded bg-slate-100 px-1 text-xs">images</code> 字段（base64），题干内用{' '}
            <code className="rounded bg-slate-100 px-1 text-xs">{'{{image:img0}}'}</code> 占位。从 docx 导入试卷时会自动提取图片。
          </p>
        </div>

        {err ? <p className="text-sm text-rose-600 whitespace-pre-wrap">{err}</p> : null}
        {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-100 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-slate-800">导出</h3>
            <label className="block text-sm">
              <span className="text-slate-600">题目范围</span>
              <select
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 bg-white"
                value={exportStatus}
                onChange={(e) => setExportStatus(e.target.value as typeof exportStatus)}
              >
                <option value="all">全部</option>
                <option value="published">已发布</option>
                <option value="pending">待审核</option>
                <option value="draft">草稿</option>
              </select>
            </label>
            <button
              type="button"
              disabled={exporting}
              onClick={() => void downloadExport()}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {exporting ? <Loader2 size={16} className="animate-spin" /> : <FileCode size={16} />}
              下载 YAML
            </button>
          </div>

          <div className="rounded-lg border border-slate-100 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-slate-800">导入</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-slate-600">默认状态</span>
                <select
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 bg-white"
                  value={importStatus}
                  onChange={(e) => setImportStatus(e.target.value as typeof importStatus)}
                >
                  <option value="published">已发布</option>
                  <option value="pending">待审核</option>
                  <option value="draft">草稿</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-slate-600">默认学科</span>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={importSubject}
                  onChange={(e) => setImportSubject(e.target.value)}
                  placeholder="初中科学"
                />
              </label>
            </div>
            <input
              ref={yamlFileRef}
              type="file"
              accept=".yaml,.yml,text/yaml"
              className="hidden"
              onChange={(e) => onYamlFile(e.target.files?.[0] ?? null)}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => yamlFileRef.current?.click()}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"
              >
                选择 YAML 文件
              </button>
              <button
                type="button"
                disabled={importing}
                onClick={() => void runImport()}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {importing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                导入 YAML
              </button>
            </div>
          </div>
        </div>

        <label className="block text-sm">
          <span className="text-slate-600 font-medium">YAML 内容（可粘贴编辑后导入）</span>
          <textarea
            className="mt-1 w-full min-h-[280px] rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs leading-relaxed"
            value={yamlText}
            onChange={(e) => setYamlText(e.target.value)}
            placeholder={`format: zhishitree-questions\nversion: 1\nquestions:\n  - title: "1．"\n    stem: |\n      如图 {{image:img0}} …\n    images:\n      - id: img0\n        mime: image/png\n        data: "…base64…"`}
          />
        </label>
      </section>
    </div>
  );
}

const AI_PROVIDER_OPTIONS: { value: AiProvider; label: string; defaultModelId?: string; defaultBaseUrl?: string }[] = [
  { value: 'gemini', label: 'Google Gemini', defaultModelId: 'gemini-2.5-flash' },
  {
    value: 'zhipu',
    label: '智谱 AI（GLM）',
    defaultModelId: 'glm-4-flash',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  },
  { value: 'openai', label: 'OpenAI', defaultModelId: 'gpt-4o-mini', defaultBaseUrl: 'https://api.openai.com/v1' },
  { value: 'deepseek', label: 'DeepSeek', defaultModelId: 'deepseek-chat', defaultBaseUrl: 'https://api.deepseek.com/v1' },
  { value: 'moonshot', label: 'Moonshot / Kimi', defaultModelId: 'moonshot-v1-8k', defaultBaseUrl: 'https://api.moonshot.cn/v1' },
  { value: 'custom', label: '自定义 OpenAI 兼容' },
];

type AiModelFormState = {
  name: string;
  provider: AiProvider;
  modelId: string;
  apiKey: string;
  baseUrl: string;
  enabled: boolean;
  isDefault: boolean;
  note: string;
};

const emptyAiForm = (): AiModelFormState => ({
  name: '',
  provider: 'gemini',
  modelId: 'gemini-2.0-flash',
  apiKey: '',
  baseUrl: '',
  enabled: true,
  isDefault: false,
  note: '',
});

function SystemSettingsPanel() {
  const [section, setSection] = useState<'ai' | 'mineru'>('ai');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setSection('ai')}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium border transition-colors ${
            section === 'ai'
              ? 'border-indigo-600 bg-indigo-50 text-indigo-800'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          <Sparkles size={16} />
          AI 大模型
        </button>
        <button
          type="button"
          onClick={() => setSection('mineru')}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium border transition-colors ${
            section === 'mineru'
              ? 'border-indigo-600 bg-indigo-50 text-indigo-800'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          <ScanText size={16} />
          MinerU OCR
        </button>
      </div>
      {section === 'ai' ? <AiModelsSettingsSection /> : <MineruSettingsSection />}
    </div>
  );
}

function AiModelsSettingsSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [data, setData] = useState<AiModelsListResponse | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<AiModelFormState>(emptyAiForm);
  const [testing, setTesting] = useState(false);
  const [testingRowId, setTestingRowId] = useState<number | null>(null);
  const [formTestResult, setFormTestResult] = useState<AiModelTestResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<AiModelsListResponse>('/api/admin/ai-models');
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyAiForm());
    setShowForm(true);
    setMessage('');
    setError('');
    setFormTestResult(null);
  };

  const openEdit = (row: AiModelConfigRow) => {
    setEditingId(row.id);
    setForm({
      name: row.name,
      provider: row.provider,
      modelId: row.modelId,
      apiKey: '',
      baseUrl: row.baseUrl || '',
      enabled: row.enabled,
      isDefault: row.isDefault,
      note: row.note || '',
    });
    setShowForm(true);
    setMessage('');
    setError('');
    setFormTestResult(null);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyAiForm());
    setFormTestResult(null);
  };

  const submitForm = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const payload = {
        name: form.name.trim(),
        provider: form.provider,
        modelId: form.modelId.trim(),
        baseUrl: form.baseUrl.trim() || null,
        enabled: form.enabled,
        isDefault: form.isDefault,
        note: form.note.trim() || null,
        ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
      };
      if (editingId) {
        await apiFetch(`/api/admin/ai-models/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setMessage('已更新模型配置');
      } else {
        if (!form.apiKey.trim()) {
          throw new Error('新建配置必须填写 API Key');
        }
        await apiFetch('/api/admin/ai-models', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setMessage('已添加模型配置');
      }
      closeForm();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const testFormConfig = async () => {
    setTesting(true);
    setFormTestResult(null);
    setError('');
    try {
      if (!form.modelId.trim()) {
        throw new Error('请先填写模型 ID');
      }
      if (!editingId && !form.apiKey.trim()) {
        throw new Error('新建配置请先填写 API Key');
      }
      const result = await apiFetch<AiModelTestResponse>('/api/admin/ai-models/test', {
        method: 'POST',
        body: JSON.stringify({
          configId: editingId ?? undefined,
          provider: form.provider,
          modelId: form.modelId.trim(),
          apiKey: form.apiKey.trim() || undefined,
          baseUrl: form.baseUrl.trim() || null,
        }),
      });
      setFormTestResult(result);
    } catch (e) {
      setFormTestResult({
        ok: false,
        message: e instanceof Error ? e.message : '检测失败',
      });
    } finally {
      setTesting(false);
    }
  };

  const testSavedModel = async (id: number) => {
    setTestingRowId(id);
    setError('');
    setMessage('');
    try {
      const result = await apiFetch<AiModelTestResponse>(`/api/admin/ai-models/${id}/test`, {
        method: 'POST',
      });
      if (result.ok) {
        setMessage(`「${data?.models.find((m) => m.id === id)?.name ?? id}」检测通过：${result.message}`);
      } else {
        setError(`检测失败：${result.message}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '检测失败');
    } finally {
      setTestingRowId(null);
    }
  };

  const setDefault = async (id: number) => {
    setError('');
    try {
      await apiFetch(`/api/admin/ai-models/${id}/set-default`, { method: 'POST' });
      setMessage('已设为默认模型');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    }
  };

  const removeModel = async (id: number) => {
    if (!window.confirm('确定删除该模型配置？')) return;
    setError('');
    try {
      await apiFetch(`/api/admin/ai-models/${id}`, { method: 'DELETE' });
      setMessage('已删除');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    }
  };

  const toggleEnabled = async (row: AiModelConfigRow) => {
    setError('');
    try {
      await apiFetch(`/api/admin/ai-models/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !row.enabled }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新失败');
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Sparkles size={20} className="text-indigo-600" />
              AI 大模型调用管理
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              可添加多个模型 API；服务端拆题、考点分析、错题思维交流、图片分析等将优先使用<strong>默认且已启用</strong>的配置。
              未配置时回退到环境变量 <code className="rounded bg-slate-100 px-1 text-xs">ZHIPU_API_KEY</code> /{' '}
              <code className="rounded bg-slate-100 px-1 text-xs">GEMINI_API_KEY</code>。
            </p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <Plus size={16} />
            添加模型
          </button>
        </div>

        {data?.active ? (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-900">
            当前生效：
            {data.active.source === 'db' ? (
              <>
                {' '}
                <strong>{data.active.configName || '数据库配置'}</strong>（{data.active.provider} / {data.active.modelId}）
              </>
            ) : (
              <>
                {' '}
                环境变量（{data.active.provider} / {data.active.modelId}）
              </>
            )}
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            尚未配置可用 AI 模型，请在下方添加，或在服务器 .env.local 中设置 ZHIPU_API_KEY / GEMINI_API_KEY。
          </div>
        )}

        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        {message ? <p className="mt-3 text-sm text-emerald-700">{message}</p> : null}

        {loading ? (
          <div className="mt-6 flex items-center gap-2 text-slate-500 text-sm">
            <Loader2 size={18} className="animate-spin" />
            加载中…
          </div>
        ) : (
          <div className="mt-6 overflow-x-auto">
            {(data?.models.length ?? 0) === 0 ? (
              <p className="text-sm text-slate-500 py-8 text-center border border-dashed border-slate-200 rounded-lg">
                暂无模型配置，点击「添加模型」开始。
                {data?.envFallback?.zhipu || data?.envFallback?.gemini
                  ? `（检测到环境变量回退：${[
                      data.envFallback.zhipu ? 'ZHIPU_API_KEY' : '',
                      data.envFallback.gemini ? 'GEMINI_API_KEY' : '',
                    ]
                      .filter(Boolean)
                      .join('、')}）`
                  : null}
              </p>
            ) : (
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="py-2 pr-3 font-medium">名称</th>
                    <th className="py-2 pr-3 font-medium">提供商</th>
                    <th className="py-2 pr-3 font-medium">模型 ID</th>
                    <th className="py-2 pr-3 font-medium">API Key</th>
                    <th className="py-2 pr-3 font-medium">状态</th>
                    <th className="py-2 font-medium text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.models.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 align-middle">
                      <td className="py-3 pr-3">
                        <div className="font-medium text-slate-900 flex items-center gap-1.5">
                          {row.name}
                          {row.isDefault ? (
                            <span className="inline-flex items-center gap-0.5 text-[10px] bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded">
                              <Star size={10} fill="currentColor" />
                              默认
                            </span>
                          ) : null}
                        </div>
                        {row.note ? <div className="text-xs text-slate-500 mt-0.5">{row.note}</div> : null}
                      </td>
                      <td className="py-3 pr-3 text-slate-700">{row.provider}</td>
                      <td className="py-3 pr-3 font-mono text-xs text-slate-700">{row.modelId}</td>
                      <td className="py-3 pr-3 font-mono text-xs text-slate-600">{row.apiKeyMasked || '—'}</td>
                      <td className="py-3 pr-3">
                        <button
                          type="button"
                          onClick={() => void toggleEnabled(row)}
                          className={`text-xs px-2 py-0.5 rounded ${
                            row.enabled
                              ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          {row.enabled ? '已启用' : '已停用'}
                        </button>
                      </td>
                      <td className="py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          {!row.isDefault ? (
                            <button
                              type="button"
                              title="设为默认"
                              onClick={() => void setDefault(row.id)}
                              className="p-1.5 rounded hover:bg-amber-50 text-amber-700"
                            >
                              <Star size={16} />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            title="检测连接"
                            disabled={testingRowId === row.id}
                            onClick={() => void testSavedModel(row.id)}
                            className="p-1.5 rounded hover:bg-sky-50 text-sky-700 disabled:opacity-50"
                          >
                            {testingRowId === row.id ? (
                              <Loader2 size={16} className="animate-spin" />
                            ) : (
                              <Zap size={16} />
                            )}
                          </button>
                          <button
                            type="button"
                            title="编辑"
                            onClick={() => openEdit(row)}
                            className="p-1.5 rounded hover:bg-slate-100 text-slate-600"
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            type="button"
                            title="删除"
                            onClick={() => void removeModel(row.id)}
                            className="p-1.5 rounded hover:bg-red-50 text-red-600"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>

      {showForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-lg rounded-xl bg-white shadow-xl border border-slate-200 max-h-[90vh] overflow-y-auto"
          >
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-bold text-slate-900">{editingId ? '编辑模型配置' : '添加模型配置'}</h3>
              <button type="button" onClick={closeForm} className="text-slate-500 hover:text-slate-800 text-sm">
                关闭
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <label className="block text-sm">
                <span className="text-slate-700 font-medium">配置名称</span>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  placeholder="如：Gemini 生产环境"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </label>
              <label className="block text-sm">
                <span className="text-slate-700 font-medium">提供商</span>
                <select
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 bg-white"
                  value={form.provider}
                  onChange={(e) => {
                    const provider = e.target.value as AiProvider;
                    const opt = AI_PROVIDER_OPTIONS.find((o) => o.value === provider);
                    setForm((f) => ({
                      ...f,
                      provider,
                      modelId: opt?.defaultModelId || f.modelId,
                      baseUrl: provider === 'gemini' ? '' : opt?.defaultBaseUrl || (provider === 'custom' ? f.baseUrl : ''),
                    }));
                    setFormTestResult(null);
                  }}
                >
                  {AI_PROVIDER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {form.provider === 'zhipu' ? (
                  <p className="mt-1 text-xs text-slate-600">
                    图片 OCR 须用<strong>视觉模型</strong>：<code className="rounded bg-slate-100 px-1">glm-4.6v</code> 或{' '}
                    <code className="rounded bg-slate-100 px-1">glm-4v-flash</code>（<strong>glm-5.2 / glm-4-flash 不能识图</strong>，仅适合文字分析）。可另建一条「智谱 OCR」配置并设为默认。
                  </p>
                ) : form.provider === 'gemini' ? (
                  <p className="mt-1 text-xs text-slate-600">
                    国内服务器访问 Google 常失败（fetch failed）。可在 <code className="rounded bg-slate-100 px-1">.env.local</code> 设{' '}
                    <code className="rounded bg-slate-100 px-1">GEMINI_HTTP_PROXY=http://127.0.0.1:7890</code> 后重启；或直接用智谱{' '}
                    <code className="rounded bg-slate-100 px-1">glm-4.6v</code> 识图。
                  </p>
                ) : form.provider !== 'custom' ? (
                  <p className="mt-1 text-xs text-slate-600">已自动填入该提供商默认 Base URL，可按需修改。</p>
                ) : null}
              </label>
              <label className="block text-sm">
                <span className="text-slate-700 font-medium">模型 ID</span>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
                  placeholder="gemini-2.0-flash"
                  value={form.modelId}
                  onChange={(e) => setForm((f) => ({ ...f, modelId: e.target.value }))}
                />
              </label>
              <label className="block text-sm">
                <span className="text-slate-700 font-medium">
                  API Key {editingId ? '（留空则不修改）' : ''}
                </span>
                <input
                  type="password"
                  autoComplete="off"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
                  placeholder="sk-… 或 AIza…"
                  value={form.apiKey}
                  onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                />
              </label>
              <label className="block text-sm">
                <span className="text-slate-700 font-medium">Base URL（可选）</span>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm disabled:bg-slate-100 disabled:text-slate-400"
                  placeholder={form.provider === 'gemini' ? 'Gemini 请留空' : 'OpenAI 兼容接口地址'}
                  value={form.provider === 'gemini' ? '' : form.baseUrl}
                  disabled={form.provider === 'gemini'}
                  onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
                />
              </label>
              <label className="block text-sm">
                <span className="text-slate-700 font-medium">备注</span>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={form.note}
                  onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                />
              </label>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
                  />
                  启用
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.isDefault}
                    onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))}
                  />
                  设为默认
                </label>
              </div>

              {formTestResult ? (
                <div
                  className={`rounded-lg border px-3 py-2 text-sm ${
                    formTestResult.ok
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                      : 'border-red-200 bg-red-50 text-red-800'
                  }`}
                >
                  <p className="font-medium">{formTestResult.ok ? '检测通过' : '检测未通过'}</p>
                  <p className="mt-0.5">{formTestResult.message}</p>
                  {formTestResult.replyPreview ? (
                    <p className="mt-1 text-xs opacity-80">
                      模型回复：{formTestResult.replyPreview}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="px-5 py-4 border-t border-slate-100 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={closeForm}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="button"
                disabled={testing || saving}
                onClick={() => void testFormConfig()}
                className="inline-flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-800 hover:bg-sky-100 disabled:opacity-50"
              >
                {testing ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
                检测连接
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void submitForm()}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MineruSettingsSection() {
  const MINERU_MODE_OPTIONS: { value: MineruApiMode; label: string; url: string; tokenHint: string }[] = [
    {
      value: 'local',
      label: '本地 mineru-api',
      url: 'http://127.0.0.1:8000',
      tokenHint: '本地服务通常无需 Token',
    },
    {
      value: 'cloud_v4',
      label: 'MinerU 云端 API（精准解析）',
      url: 'https://mineru.net/api/v4',
      tokenHint: '必填，在 mineru.net API 管理页创建',
    },
    {
      value: 'cloud_agent',
      label: 'MinerU Agent API（轻量）',
      url: 'https://mineru.net/api/v1/agent',
      tokenHint: '免 Token，有 IP 限频',
    },
  ];

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [testResult, setTestResult] = useState<MineruTestResponse | null>(null);
  const [form, setForm] = useState({
    enabled: false,
    apiMode: 'local' as MineruApiMode,
    apiUrl: 'http://127.0.0.1:8000',
    apiKey: '',
    lang: 'ch',
    parseMethod: 'auto',
    fallbackVision: false,
    llmCorrect: false,
    timeoutMs: 180000,
    backend: 'vlm-auto-engine',
  });
  const [meta, setMeta] = useState<
    Pick<MineruSettingsPublic, 'source' | 'active' | 'healthy' | 'updatedAt' | 'apiKeyMasked' | 'hasApiKey'>
  >({
    source: 'env',
    active: false,
    healthy: false,
    updatedAt: null,
    apiKeyMasked: '',
    hasApiKey: false,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<MineruSettingsResponse>('/api/admin/mineru-settings');
      const s = res.settings;
      setForm({
        enabled: s.enabled,
        apiMode: s.apiMode,
        apiUrl: s.apiUrl,
        apiKey: '',
        lang: s.lang,
        parseMethod: s.parseMethod,
        fallbackVision: s.fallbackVision,
        llmCorrect: s.llmCorrect,
        timeoutMs: s.timeoutMs,
        backend: s.backend,
      });
      setMeta({
        source: s.source,
        active: s.active,
        healthy: s.healthy,
        updatedAt: s.updatedAt,
        apiKeyMasked: s.apiKeyMasked,
        hasApiKey: s.hasApiKey,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      if (form.enabled && !form.apiUrl.trim()) {
        throw new Error('启用 OCR 时必须填写 API 地址');
      }
      if (form.enabled && form.apiMode === 'cloud_v4' && !form.apiKey.trim() && !meta.hasApiKey) {
        throw new Error('MinerU 云端 API 必须填写 API Token');
      }
      const res = await apiFetch<MineruSettingsResponse>('/api/admin/mineru-settings', {
        method: 'PATCH',
        body: JSON.stringify({
          enabled: form.enabled,
          apiMode: form.apiMode,
          apiUrl: form.apiUrl.trim(),
          lang: form.lang.trim(),
          parseMethod: form.parseMethod.trim(),
          fallbackVision: form.fallbackVision,
          llmCorrect: form.llmCorrect,
          timeoutMs: form.timeoutMs,
          backend: form.backend.trim(),
          ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
        }),
      });
      const s = res.settings;
      setMeta({
        source: s.source,
        active: s.active,
        healthy: s.healthy,
        updatedAt: s.updatedAt,
        apiKeyMasked: s.apiKeyMasked,
        hasApiKey: s.hasApiKey,
      });
      setForm((f) => ({ ...f, apiKey: '' }));
      setMessage('MinerU 配置已保存');
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    setError('');
    try {
      const url = form.apiUrl.trim();
      if (!url) throw new Error('请先填写 API 地址');
      const result = await apiFetch<MineruTestResponse>('/api/admin/mineru-settings/test', {
        method: 'POST',
        body: JSON.stringify({
          apiUrl: url,
          apiMode: form.apiMode,
          ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
        }),
      });
      setTestResult(result);
      if (result.ok) {
        setMeta((m) => ({ ...m, healthy: true }));
      }
    } catch (e) {
      setTestResult({
        ok: false,
        message: e instanceof Error ? e.message : '检测失败',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-5">
      <div>
        <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
          <ScanText size={20} className="text-violet-600" />
          MinerU 错题图片 OCR
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          错题识别优先调用 MinerU 解析图片（表格、公式），再由大模型校正与分析。需先在本机或服务器启动{' '}
          <code className="rounded bg-slate-100 px-1 text-xs">mineru-api --host 0.0.0.0 --port 8000</code>。
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <Loader2 size={18} className="animate-spin" />
          加载中…
        </div>
      ) : (
        <>
          <div
            className={`rounded-lg border px-4 py-3 text-sm ${
              meta.active && meta.healthy
                ? 'border-emerald-200 bg-emerald-50/60 text-emerald-900'
                : meta.active
                  ? 'border-amber-200 bg-amber-50 text-amber-900'
                  : 'border-slate-200 bg-slate-50 text-slate-700'
            }`}
          >
            {meta.active ? (
              <>
                OCR 已启用（配置来源：{meta.source === 'db' ? '管理后台' : '环境变量'}）
                {meta.healthy ? ' · 服务连接正常' : ' · 服务未连通，请检查 mineru-api'}
              </>
            ) : (
              <>OCR 未启用 — 错题识别将使用视觉大模型直接识图</>
            )}
            {meta.updatedAt ? (
              <span className="block mt-1 text-xs opacity-75">上次保存：{meta.updatedAt}</span>
            ) : null}
          </div>

          <label className="flex items-center gap-3 text-sm font-medium text-slate-900">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
              className="rounded border-slate-300"
            />
            启用 MinerU OCR 识别
          </label>

          <label className="block text-sm">
            <span className="text-slate-700 font-medium">服务类型</span>
            <select
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 bg-white"
              value={form.apiMode}
              onChange={(e) => {
                const apiMode = e.target.value as MineruApiMode;
                const opt = MINERU_MODE_OPTIONS.find((o) => o.value === apiMode);
                setForm((f) => ({
                  ...f,
                  apiMode,
                  apiUrl: opt?.url || f.apiUrl,
                }));
                setTestResult(null);
              }}
            >
              {MINERU_MODE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="text-slate-700 font-medium">API 地址</span>
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
              placeholder="http://127.0.0.1:8000"
              value={form.apiUrl}
              onChange={(e) => setForm((f) => ({ ...f, apiUrl: e.target.value }))}
            />
            <p className="mt-1 text-xs text-slate-500">MinerU API 根地址，无需末尾斜杠</p>
          </label>

          <label className="block text-sm">
            <span className="text-slate-700 font-medium">API Token</span>
            <input
              type="password"
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
              placeholder={
                meta.hasApiKey ? '已配置 Token（留空则不修改）' : 'Bearer Token，云端 API 必填'
              }
              value={form.apiKey}
              onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
            />
            <p className="mt-1 text-xs text-slate-500">
              {MINERU_MODE_OPTIONS.find((o) => o.value === form.apiMode)?.tokenHint}
              {meta.hasApiKey && meta.apiKeyMasked ? (
                <span className="ml-1 font-mono">当前：{meta.apiKeyMasked}</span>
              ) : null}
              {form.apiMode === 'cloud_v4' ? (
                <span className="block mt-0.5">
                  在{' '}
                  <a
                    href="https://mineru.net/apiManage/token"
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-600 hover:underline"
                  >
                    mineru.net API 管理
                  </a>{' '}
                  创建 Token，请求头格式为 Bearer Token
                </span>
              ) : null}
            </p>
          </label>

          {form.apiMode === 'local' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-slate-700 font-medium">语言</span>
                <select
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 bg-white"
                  value={form.lang}
                  onChange={(e) => setForm((f) => ({ ...f, lang: e.target.value }))}
                >
                  <option value="ch">中文 (ch)</option>
                  <option value="en">英文 (en)</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-slate-700 font-medium">解析模式</span>
                <select
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 bg-white"
                  value={form.parseMethod}
                  onChange={(e) => setForm((f) => ({ ...f, parseMethod: e.target.value }))}
                >
                  <option value="auto">auto（自动）</option>
                  <option value="ocr">ocr</option>
                  <option value="txt">txt</option>
                </select>
              </label>
            </div>
          ) : (
            <label className="block text-sm">
              <span className="text-slate-700 font-medium">语言</span>
              <select
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 bg-white"
                value={form.lang}
                onChange={(e) => setForm((f) => ({ ...f, lang: e.target.value }))}
              >
                <option value="ch">中文 (ch)</option>
                <option value="en">英文 (en)</option>
              </select>
            </label>
          )}

          <label className="block text-sm">
            <span className="text-slate-700 font-medium">超时（毫秒）</span>
            <input
              type="number"
              min={10000}
              step={1000}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
              value={form.timeoutMs}
              onChange={(e) => setForm((f) => ({ ...f, timeoutMs: Number(e.target.value) || 180000 }))}
            />
          </label>

          {form.apiMode === 'local' ? (
            <label className="block text-sm">
              <span className="text-slate-700 font-medium">解析后端（backend）</span>
              <select
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 bg-white font-mono text-sm"
                value={form.backend || 'vlm-auto-engine'}
                onChange={(e) => setForm((f) => ({ ...f, backend: e.target.value }))}
              >
                <option value="vlm-auto-engine">vlm-auto-engine — MinerU VLM（桌面端同名）</option>
                <option value="hybrid-auto-engine">hybrid-auto-engine — Hybrid 高精度（CLI 默认）</option>
                <option value="pipeline">pipeline — 传统管线（CPU 可跑）</option>
                <option value="vlm-http-client">vlm-http-client — 远程 VLM 服务</option>
                <option value="hybrid-http-client">hybrid-http-client — 远程 Hybrid 服务</option>
              </select>
              <p className="mt-1 text-xs text-slate-500">
                对应桌面端「MinerU VLM」选 <code className="text-xs">vlm-auto-engine</code>；开启表格/公式/配图由 API 参数
                table_enable、formula_enable、image_analysis、return_images 控制。
              </p>
            </label>
          ) : null}

          <div className="flex flex-wrap gap-4 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.fallbackVision}
                onChange={(e) => setForm((f) => ({ ...f, fallbackVision: e.target.checked }))}
              />
              MinerU 失败时回退视觉大模型 OCR
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.llmCorrect}
                onChange={(e) => setForm((f) => ({ ...f, llmCorrect: e.target.checked }))}
              />
              大模型校正 OCR 文本后再分析
            </label>
          </div>

          {testResult ? (
            <div
              className={`rounded-lg border px-3 py-2 text-sm ${
                testResult.ok
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : 'border-red-200 bg-red-50 text-red-800'
              }`}
            >
              <p className="font-medium">{testResult.ok ? '连接成功' : '连接失败'}</p>
              <p className="mt-0.5">{testResult.message}</p>
              {testResult.detail ? <p className="mt-1 text-xs opacity-90">{testResult.detail}</p> : null}
            </div>
          ) : null}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button
              type="button"
              disabled={testing || saving}
              onClick={() => void testConnection()}
              className="inline-flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-800 hover:bg-sky-100 disabled:opacity-50"
            >
              {testing ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
              检测连接
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              保存配置
            </button>
          </div>
        </>
      )}
    </section>
  );
}
