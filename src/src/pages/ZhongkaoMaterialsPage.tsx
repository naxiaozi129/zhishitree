import React, { useCallback, useEffect, useState } from 'react';
import {
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  Upload,
} from 'lucide-react';
import {
  apiFetch,
  type MaterialIngestResponse,
  type MaterialListPayload,
  type MaterialPreviewPayload,
} from '../services/api';
import { useAuth } from '../context/AuthContext';
import { isStaff } from '../utils/roles';
import { PageChrome } from '../components/PageChrome';

const INGEST_EXT = /\.(docx|doc|pdf|txt)$/i;

function formatSize(n?: number): string {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function ZhongkaoMaterialsPage({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();
  const isAdmin = user ? isStaff(user.role) : false;
  const [currentPath, setCurrentPath] = useState('');
  const [listing, setListing] = useState<MaterialListPayload | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listErr, setListErr] = useState<string | null>(null);
  const [selectedRelPath, setSelectedRelPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<MaterialPreviewPayload | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [ingestBusy, setIngestBusy] = useState(false);
  const [useAiSplit, setUseAiSplit] = useState(true);

  const loadDir = useCallback(async (path: string) => {
    setListLoading(true);
    setListErr(null);
    try {
      const q = path ? `?path=${encodeURIComponent(path)}` : '';
      const data = await apiFetch<MaterialListPayload>(`/api/zhongkao/materials${q}`);
      setListing(data);
      setCurrentPath(data.currentPath);
    } catch (e: unknown) {
      setListErr(e instanceof Error ? e.message : '加载目录失败');
    } finally {
      setListLoading(false);
    }
  }, []);

  const loadPreview = useCallback(async (relPath: string) => {
    setPreviewLoading(true);
    setPreviewErr(null);
    setPreview(null);
    try {
      const data = await apiFetch<MaterialPreviewPayload>(
        `/api/zhongkao/materials/preview?relPath=${encodeURIComponent(relPath)}`,
      );
      setPreview(data);
    } catch (e: unknown) {
      setPreviewErr(e instanceof Error ? e.message : '预览失败');
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  useEffect(() => {
    const openPath = sessionStorage.getItem('zhongkaoOpenPath');
    if (openPath) {
      sessionStorage.removeItem('zhongkaoOpenPath');
      const parent = openPath.includes('/') ? openPath.split('/').slice(0, -1).join('/') : '';
      void loadDir(parent).then(() => {
        setSelectedRelPath(openPath);
        if (INGEST_EXT.test(openPath)) void loadPreview(openPath);
      });
    } else {
      void loadDir('');
    }
  }, [loadDir, loadPreview]);

  const openDir = (relPath: string) => {
    setSelectedRelPath(null);
    setPreview(null);
    void loadDir(relPath);
  };

  const openFile = (relPath: string) => {
    setSelectedRelPath(relPath);
    if (INGEST_EXT.test(relPath)) void loadPreview(relPath);
    else {
      setPreview(null);
      setPreviewErr('暂不支持预览该格式，可使用 docx / pdf / txt');
    }
  };

  const runIngest = async () => {
    if (!selectedRelPath || !INGEST_EXT.test(selectedRelPath)) return;
    setIngestBusy(true);
    try {
      const data = await apiFetch<MaterialIngestResponse>('/api/zhongkao/materials/ingest', {
        method: 'POST',
        body: JSON.stringify({
          relPath: selectedRelPath,
          useAiSplit,
          analyzeWithAi: true,
          defaultSubject: '初中科学',
        }),
      });
      alert(
        `已从资料入库 ${data.count} 道题（待审核）。\n文件：${data.relPath}\n批次：${data.batchKey}\n请在管理后台「待审核」中审核。`,
      );
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '入库失败');
    } finally {
      setIngestBusy(false);
    }
  };

  if (!user) {
    return (
      <PageChrome title="中考资料库" subtitle="浙江科学模考卷、专题与押题资料索引" onBack={onBack}>
        <div className="rounded-2xl border border-slate-200 bg-white/90 p-8 text-center text-slate-600 shadow-sm">
          请先登录后浏览本地资料目录。
        </div>
      </PageChrome>
    );
  }

  return (
    <PageChrome
      title="中考资料库"
      subtitle="浏览 10.中考浙江科学 目录 · 预览 docx/pdf · 管理员可拆题入库待审核"
      onBack={onBack}
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="flex flex-wrap items-center gap-1 text-xs text-slate-600">
              <FolderOpen size={14} className="text-amber-600" />
              {listing?.rootExists === false ? (
                <span className="text-rose-600">资料目录不存在，请将资料放入项目根目录「10.中考浙江科学」</span>
              ) : (
                <>
                  <button
                    type="button"
                    className="font-medium text-amber-800 hover:underline"
                    onClick={() => openDir('')}
                  >
                    {listing?.rootLabel || '10.中考浙江科学'}
                  </button>
                  {listing?.currentPath
                    ? listing.currentPath.split('/').map((seg, i, arr) => {
                        const p = arr.slice(0, i + 1).join('/');
                        return (
                          <span key={p} className="inline-flex items-center gap-1">
                            <ChevronRight size={12} className="text-slate-400" />
                            <button
                              type="button"
                              className="hover:text-amber-800 hover:underline"
                              onClick={() => openDir(p)}
                            >
                              {seg}
                            </button>
                          </span>
                        );
                      })
                    : null}
                </>
              )}
            </div>
          </div>

          {listLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="animate-spin text-amber-600" size={28} />
            </div>
          ) : listErr ? (
            <p className="p-4 text-sm text-rose-600">{listErr}</p>
          ) : (
            <ul className="max-h-[520px] divide-y divide-slate-50 overflow-auto">
              {listing?.parentPath !== null && listing?.currentPath ? (
                <li>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-slate-600 hover:bg-slate-50"
                    onClick={() => openDir(listing.parentPath ?? '')}
                  >
                    <Folder size={18} className="text-slate-400" />
                    ..
                  </button>
                </li>
              ) : null}
              {(listing?.items || []).map((item) => (
                <li key={item.relPath}>
                  <button
                    type="button"
                    className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition hover:bg-amber-50/80 ${
                      selectedRelPath === item.relPath ? 'bg-amber-50 ring-1 ring-inset ring-amber-200' : ''
                    }`}
                    onClick={() => (item.kind === 'dir' ? openDir(item.relPath) : openFile(item.relPath))}
                  >
                    {item.kind === 'dir' ? (
                      <Folder size={18} className="shrink-0 text-amber-600" />
                    ) : (
                      <FileText size={18} className="shrink-0 text-slate-500" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-slate-800">{item.name}</span>
                    {item.kind === 'file' && item.size != null ? (
                      <span className="shrink-0 text-xs text-slate-400">{formatSize(item.size)}</span>
                    ) : null}
                  </button>
                </li>
              ))}
              {!listing?.items?.length && listing?.rootExists ? (
                <li className="px-4 py-8 text-center text-sm text-slate-500">此目录为空</li>
              ) : null}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          {!selectedRelPath ? (
            <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 text-center text-sm text-slate-500">
              <FileText size={40} className="text-slate-300" />
              在左侧选择文件以预览文本；模考卷 docx/pdf 可由管理员拆题入库。
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <h2 className="text-sm font-bold text-slate-900">{selectedRelPath.split('/').pop()}</h2>
                <p className="mt-1 font-mono text-xs text-slate-500 break-all">{selectedRelPath}</p>
              </div>

              {previewLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="animate-spin text-amber-600" size={24} />
                </div>
              ) : previewErr ? (
                <p className="text-sm text-rose-600">{previewErr}</p>
              ) : preview ? (
                <div className="space-y-2">
                  <p className="text-xs text-slate-500">
                    格式 {preview.format} · 约 {preview.charCount.toLocaleString()} 字
                    {preview.charCount > 4000 ? '（预览已截断）' : ''}
                  </p>
                  <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs leading-relaxed text-slate-800">
                    {preview.preview}
                  </pre>
                </div>
              ) : null}

              {isAdmin && INGEST_EXT.test(selectedRelPath) ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-4 space-y-3">
                  <p className="text-xs text-amber-950">
                    拆题 + AI 考点标注后写入<strong>待审核题库</strong>，需在管理后台逐条通过。
                  </p>
                  <label className="flex items-center gap-2 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={useAiSplit}
                      onChange={(e) => setUseAiSplit(e.target.checked)}
                    />
                    使用 AI 拆题（需 GEMINI_API_KEY，失败时回退启发式）
                  </label>
                  <button
                    type="button"
                    disabled={ingestBusy}
                    onClick={() => void runIngest()}
                    className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                  >
                    {ingestBusy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                    {ingestBusy ? '入库中…' : '拆题入库（待审核）'}
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </PageChrome>
  );
}
