import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, ImageOff, Loader2, Trash2 } from 'lucide-react';
import { apiFetch, type MistakeRow, type ScienceMatchRow } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { PageChrome } from '../components/PageChrome';
import { QuestionSourceMedia } from '../components/QuestionSourceMedia';
import {
  mistakeExamPointLine,
  mistakeImageUri,
  parseMistakeAnalysis,
} from '../components/mistakeDisplay';

export function RecordsPage({
  onBack,
  onOpenMistake,
}: {
  onBack: () => void;
  onOpenMistake: (id: number) => void;
}) {
  const { user, loading: authLoading } = useAuth();
  const [items, setItems] = useState<MistakeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [matchesById, setMatchesById] = useState<Record<number, ScienceMatchRow[]>>({});
  const [matchesLoading, setMatchesLoading] = useState<number | null>(null);
  const [matchesErr, setMatchesErr] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !user) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch<{ items: MistakeRow[] }>('/api/mistakes');
        if (!cancelled) setItems(data.items);
      } catch (e: unknown) {
        if (!cancelled) setErr(e instanceof Error ? e.message : '加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  const remove = async (id: number) => {
    if (!window.confirm('确定删除这条错题记录？')) return;
    try {
      await apiFetch(`/api/mistakes/${id}`, { method: 'DELETE' });
      setItems((prev) => prev.filter((x) => x.id !== id));
      setMatchesById((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '删除失败');
    }
  };

  const toggleOpen = async (id: number) => {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    setMatchesErr(null);
    if (matchesById[id]) return;
    setMatchesLoading(id);
    try {
      const data = await apiFetch<{ matches: ScienceMatchRow[] }>(`/api/mistakes/${id}/science-matches`);
      setMatchesById((prev) => ({ ...prev, [id]: data.matches }));
    } catch (e: unknown) {
      setMatchesErr(e instanceof Error ? e.message : '加载映射失败');
    } finally {
      setMatchesLoading(null);
    }
  };

  const rejectMapping = async (mistakeId: number, nodeId: string) => {
    try {
      await apiFetch('/api/knowledge/reject-mapping', {
        method: 'POST',
        body: JSON.stringify({ mistakeId, nodeId }),
      });
      setMatchesById((prev) => ({
        ...prev,
        [mistakeId]: (prev[mistakeId] || []).filter((m) => m.id !== nodeId),
      }));
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '操作失败');
    }
  };

  if (!user) {
    return (
      <PageChrome title="错题本" subtitle="登录后同步云端错题记录" onBack={onBack}>
        <div className="rounded-2xl border border-slate-200 bg-white/90 p-8 text-center text-slate-600 shadow-sm">
          请先登录后查看云端错题库。
        </div>
      </PageChrome>
    );
  }

  return (
    <PageChrome title="错题本" subtitle="原题原图 · 考点一句话 · 展开可看知识树映射" onBack={onBack}>
      <div className="mx-auto max-w-3xl space-y-4">
        <p className="text-xs text-slate-500 leading-relaxed">
          点击题目卡片进入之前的解析页面（不重复分析）；展开可查看知识树映射，若不合理可「否决映射」。
        </p>
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="animate-spin text-indigo-600" size={32} />
          </div>
        ) : err ? (
          <p className="text-rose-600 text-sm">{err}</p>
        ) : items.length === 0 ? (
          <p className="text-slate-500 text-sm">暂无记录。完成一次「开始分析错题」且已登录后，会自动保存。</p>
        ) : (
          items.map((row) => {
            const parsed = parseMistakeAnalysis(row);
            const imageUri = mistakeImageUri(row);
            const examLine = mistakeExamPointLine(row, parsed);

            return (
              <article
                key={row.id}
                className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
              >
                <div className="p-4 space-y-3">
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => void toggleOpen(row.id)}
                      className="shrink-0 p-1 rounded-lg text-slate-500 hover:bg-slate-100 self-start mt-0.5"
                      aria-expanded={openId === row.id}
                      aria-label={openId === row.id ? '收起映射' : '展开映射'}
                    >
                      {openId === row.id ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    </button>
                    <div className="flex-1 min-w-0 space-y-3">
                      <button
                        type="button"
                        onClick={() => onOpenMistake(row.id)}
                        className="w-full text-left rounded-lg transition-colors hover:bg-slate-50/80 -mx-1 px-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                      >
                        {imageUri || parsed?.sourceImage ? (
                          <div className="rounded-lg border border-slate-200 bg-slate-50 overflow-hidden">
                            <QuestionSourceMedia
                              uri={imageUri}
                              mime={parsed?.sourceImage?.mime}
                              alt="原题"
                              className="w-full max-h-64 object-contain object-left-top"
                              embedClassName="w-full max-h-64 min-h-[120px] bg-white"
                              emptyClassName="flex flex-col items-center justify-center gap-1 text-slate-400 p-6"
                            />
                          </div>
                        ) : (
                          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 flex flex-col items-center justify-center text-slate-400 gap-2">
                            <ImageOff size={28} strokeWidth={1.5} />
                            <span className="text-xs">原题图片未保存（进入后可能仅显示文字解析）</span>
                          </div>
                        )}
                        <div className="mt-3">
                          <p className="text-[11px] font-medium text-indigo-600 mb-1">考点</p>
                          <p className="text-sm text-slate-800 leading-relaxed">{examLine}</p>
                          <p className="mt-2 text-xs font-medium text-emerald-700">点击查看完整解析 →</p>
                        </div>
                      </button>
                      <p className="text-xs text-slate-400">{row.created_at}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void remove(row.id)}
                      className="shrink-0 p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 self-start"
                      aria-label="删除"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
                {openId === row.id && (
                  <div className="border-t border-slate-100 bg-slate-50/80 px-4 py-3">
                    {matchesLoading === row.id ? (
                      <div className="flex items-center gap-2 text-sm text-slate-600">
                        <Loader2 className="animate-spin" size={16} />
                        加载映射…
                      </div>
                    ) : matchesErr ? (
                      <p className="text-sm text-rose-600">{matchesErr}</p>
                    ) : (
                      <ul className="space-y-3">
                        {(matchesById[row.id] || []).length === 0 ? (
                          <p className="text-sm text-slate-500">未映射到知识树节点（低于阈值或未命中关键词）。</p>
                        ) : (
                          (matchesById[row.id] || []).map((m) => (
                            <li
                              key={m.id}
                              className="rounded-lg border border-white bg-white px-3 py-2 text-sm shadow-sm"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                  <span className="font-medium text-slate-900">{m.label}</span>
                                  <span className="text-slate-400 text-xs ml-2">score {m.score}</span>
                                  <p className="text-xs text-slate-500 mt-0.5">{m.path}</p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => void rejectMapping(row.id, m.id)}
                                  className="shrink-0 text-xs font-medium text-rose-700 hover:underline"
                                >
                                  否决映射
                                </button>
                              </div>
                              {m.reasons && m.reasons.length > 0 ? (
                                <ul className="mt-2 list-disc pl-4 text-[11px] text-slate-600 space-y-0.5">
                                  {m.reasons.map((x, i) => (
                                    <li key={i}>{x}</li>
                                  ))}
                                </ul>
                              ) : null}
                            </li>
                          ))
                        )}
                      </ul>
                    )}
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>
    </PageChrome>
  );
}
