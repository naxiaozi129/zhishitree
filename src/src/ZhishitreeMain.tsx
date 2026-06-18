import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  UploadCloud,
  Image as ImageIcon,
  Loader2,
  BookOpen,
  AlertCircle,
  Network,
  ChevronRight,
  Home,
  X,
  Target,
  Copy,
  Check,
  Download,
  MessageCircle,
  Settings2,
  FileStack,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as htmlToImage from 'html-to-image';
import { analyzeQuestionImage, explainKnowledgePoint, QuestionAnalysis, KnowledgePointDetails, resolveAnalysisImageUri, resolveCircuitImageUri, figureDataUri } from './services/geminiService';
import { MarkdownRenderer } from './components/MarkdownRenderer';
import { useAuth } from './context/AuthContext';
import { canUseApp } from './utils/roles';
import { isStaff } from './utils/roles';
import {
  apiFetch,
  saveMistakeIfAuthed,
  type ReflectionAnalyzeResponse,
  type ReflectionAssessResponse,
} from './services/api';

const KNOWLEDGE_TREE_VERSION = 'junior-science-v1';

/**
 * 选择题选项常见挤在一行：「A. … B. …」或「A.…B.…」。
 * 在选项字母（A–H）及后的 .、． 前插入换行，使每项独占一行。
 */
function formatMcqOptionsPerLine(text: string): string {
  let s = text.replace(/\r\n/g, '\n');
  if (!s.trim()) return s;

  // 无空格紧挨：A.xxxB.yyy
  s = s.replace(/([A-Ha-h][.．、][^\n]*?)(?=[A-Ha-h][.．、])/g, '$1\n');
  // 有空格分隔的下一选项：... xxx B. yyy
  s = s.replace(/([^\n])\s+([A-Ha-h][.．、]\s)/g, '$1\n$2');
  // (A) (B) 分行
  s = s.replace(/([^\n])\s*([（(]\s*[A-Ha-h]\s*[）)])/g, '$1\n$2');
  // 全角选项号 Ａ．Ｂ．（部分 OCR）
  s = s.replace(/([Ａ-Ｈ][．、][^\n]*?)(?=[Ａ-Ｈ][．、])/g, '$1\n');
  s = s.replace(/([^\n])\s+([Ａ-Ｈ][．、]\s)/g, '$1\n$2');

  return s.replace(/\n{3,}/g, '\n\n').trimEnd();
}

/** 将模型返回的长段文字拆成多条要点，便于分条展示 */
function splitIntoKeyPoints(text: string): string[] {
  const raw = text.trim();
  if (!raw) return [];
  let parts = raw
    .split(/\r?\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 1) {
    const semi = parts[0].split(/[；;]\s+/).map((s) => s.trim()).filter(Boolean);
    if (semi.length > 1) parts = semi;
  }
  return parts
    .map((p) =>
      p
        .replace(/^(\d{1,2}|[一二三四五六七八九十]{1,3})[、.．]\s*/u, '')
        .replace(/^\d+\.\s*/, '')
        .replace(/^[•\-*]\s*/, '')
        .trim(),
    )
    .filter(Boolean);
}

function prepareOcrMarkdown(
  content: string,
  analysis: QuestionAnalysis | null,
  fallbackImage?: string | null,
): string {
  let md = formatMcqOptionsPerLine(content);
  const circuitUri = resolveCircuitImageUri(analysis, fallbackImage);
  const anyUri = circuitUri ?? resolveAnalysisImageUri(analysis, fallbackImage);
  if (anyUri) {
    md = md.replace(/!\[([^\]]*)\]\(fig-(?:circuit|main)\)/g, `![$1](${anyUri})`);
    md = md.replace(/\[电路图见原题配图\]/g, `![电路图](${anyUri})`);
    // 修复 Markdown 中无效的相对路径配图
    md = md.replace(/!\[([^\]]*)\]\((?!data:|https?:)([^)]+)\)/g, (full, alt) => {
      if (/^fig-/.test(alt)) return full;
      return `![${alt || '电路图'}](${anyUri})`;
    });
  }
  return md;
}

export function ZhishitreeMain({
  onNavigate,
  onBack,
}: {
  onNavigate: (path: string) => void;
  onBack: () => void;
}) {
  const { user } = useAuth();
  const [image, setImage] = useState<string | null>(() => {
    const saved = localStorage.getItem('app_image');
    return saved || null;
  });
  const [mimeType, setMimeType] = useState<string>(() => {
    const saved = localStorage.getItem('app_mimeType');
    return saved || '';
  });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<QuestionAnalysis | null>(() => {
    const treeVersion = localStorage.getItem('app_knowledge_tree_version');
    if (treeVersion !== KNOWLEDGE_TREE_VERSION) {
      localStorage.removeItem('app_analysis');
      localStorage.setItem('app_knowledge_tree_version', KNOWLEDGE_TREE_VERSION);
      return null;
    }
    const saved = localStorage.getItem('app_analysis');
    return saved ? JSON.parse(saved) : null;
  });
  const [error, setError] = useState<string | null>(null);

  const [selectedPoint, setSelectedPoint] = useState<string | null>(null);
  const [isExplaining, setIsExplaining] = useState(false);
  const [pointDetails, setPointDetails] = useState<KnowledgePointDetails | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [isExportingImage, setIsExportingImage] = useState(false);

  const [reflectionMistakeId, setReflectionMistakeId] = useState<number | null>(null);
  const [studentReflection, setStudentReflection] = useState('');
  const [reflectionAnalyzeBusy, setReflectionAnalyzeBusy] = useState(false);
  const [reflectionAssessBusy, setReflectionAssessBusy] = useState(false);
  const [reflectionAnalyzeResult, setReflectionAnalyzeResult] = useState<ReflectionAnalyzeResponse | null>(null);
  const [followUpAnswers, setFollowUpAnswers] = useState<string[]>([]);
  const [similarAnswers, setSimilarAnswers] = useState<string[]>([]);
  const [reflectionAssessResult, setReflectionAssessResult] = useState<ReflectionAssessResponse | null>(null);
  const [cloudSaveHint, setCloudSaveHint] = useState<string | null>(null);
  const [cloudSaveBusy, setCloudSaveBusy] = useState(false);

  type FontScale = 'sm' | 'md' | 'lg';
  const [fontScale, setFontScale] = useState<FontScale>(() => {
    const saved = localStorage.getItem('zhishitree_ui_font') as FontScale | null;
    return saved === 'sm' || saved === 'lg' ? saved : 'md';
  });

  const hasApiKey = Boolean(String(process.env.GEMINI_API_KEY ?? '').trim());

  // Save state to localStorage whenever it changes
  useEffect(() => {
    if (image) localStorage.setItem('app_image', image);
    else localStorage.removeItem('app_image');
  }, [image]);

  useEffect(() => {
    if (mimeType) localStorage.setItem('app_mimeType', mimeType);
    else localStorage.removeItem('app_mimeType');
  }, [mimeType]);

  useEffect(() => {
    if (analysis) localStorage.setItem('app_analysis', JSON.stringify(analysis));
    else localStorage.removeItem('app_analysis');
  }, [analysis]);

  useEffect(() => {
    localStorage.setItem('zhishitree_ui_font', fontScale);
  }, [fontScale]);

  const resetReflectionLocal = useCallback(() => {
    setReflectionMistakeId(null);
    setStudentReflection('');
    setReflectionAnalyzeResult(null);
    setReflectionAssessResult(null);
    setFollowUpAnswers([]);
    setSimilarAnswers([]);
  }, []);

  const clearProgress = () => {
    if (window.confirm('确定要清除当前进度并重新开始吗？')) {
      setImage(null);
      setMimeType('');
      setAnalysis(null);
      setSelectedPoint(null);
      setPointDetails(null);
      setError(null);
      resetReflectionLocal();
      localStorage.removeItem('app_image');
      localStorage.removeItem('app_mimeType');
      localStorage.removeItem('app_analysis');
      localStorage.setItem('app_knowledge_tree_version', KNOWLEDGE_TREE_VERSION);
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const analysisRef = useRef<HTMLDivElement>(null);
  const uiDetailsRef = useRef<HTMLDetailsElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const maxDim = 1920;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          // Compress image more aggressively to reduce base64 size
          const resizedBase64 = canvas.toDataURL('image/jpeg', 0.92);
          setImage(resizedBase64);
          setMimeType('image/jpeg');
          setAnalysis(null);
          setError(null);
          setSelectedPoint(null);
          setPointDetails(null);
          resetReflectionLocal();
          localStorage.setItem('app_knowledge_tree_version', KNOWLEDGE_TREE_VERSION);
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleAnalyze = async () => {
    if (!image) return;
    
    setIsAnalyzing(true);
    setError(null);
    setCloudSaveHint(null);
    
    try {
      // Extract base64 data without the data:image/jpeg;base64, prefix
      const base64Data = image.split(',')[1];
      const result = await analyzeQuestionImage(base64Data, mimeType);
      setAnalysis(result);
      setStudentReflection('');
      setReflectionAnalyzeResult(null);
      setReflectionAssessResult(null);
      setFollowUpAnswers([]);
      setSimilarAnswers([]);
      const saved = await saveMistakeIfAuthed(result);
      if (saved.ok) {
        setReflectionMistakeId(saved.id);
        setCloudSaveHint(null);
      } else {
        setReflectionMistakeId(null);
        setCloudSaveHint(saved.message);
      }
    } catch (err: any) {
      console.error(err);
      setError(`分析失败，请重试。错误信息: ${err?.message || '未知网络错误'}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const runReflectionAnalyze = async () => {
    if (!reflectionMistakeId) {
      setError('请先登录账号；分析完成后错题会同步到云端，才能开启思维交流。');
      return;
    }
    const t = studentReflection.trim();
    if (t.length < 8) {
      setError('请至少写 8 个字：说明你选了哪个选项、为什么觉得它对、当时怎么想的。');
      return;
    }
    setReflectionAnalyzeBusy(true);
    setError(null);
    try {
      const data = await apiFetch<ReflectionAnalyzeResponse>(
        `/api/mistakes/${reflectionMistakeId}/reflection/analyze`,
        {
          method: 'POST',
          body: JSON.stringify({ reflectionText: t }),
        },
      );
      setReflectionAnalyzeResult(data);
      setFollowUpAnswers(data.followUpQuestions.map(() => ''));
      setSimilarAnswers(data.similarQuestions.map(() => ''));
      setReflectionAssessResult(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '思维交流分析失败');
    } finally {
      setReflectionAnalyzeBusy(false);
    }
  };

  const runReflectionAssess = async () => {
    if (!reflectionMistakeId || !reflectionAnalyzeResult) return;
    setReflectionAssessBusy(true);
    setError(null);
    try {
      const data = await apiFetch<ReflectionAssessResponse>(
        `/api/mistakes/${reflectionMistakeId}/reflection/assess`,
        {
          method: 'POST',
          body: JSON.stringify({ followUpAnswers, similarAnswers }),
        },
      );
      setReflectionAssessResult(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '评估失败');
    } finally {
      setReflectionAssessBusy(false);
    }
  };

  const retryCloudSave = async () => {
    if (!analysis) return;
    setCloudSaveBusy(true);
    setCloudSaveHint(null);
    try {
      const saved = await saveMistakeIfAuthed(analysis);
      if (saved.ok) {
        setReflectionMistakeId(saved.id);
      } else {
        setCloudSaveHint(saved.message);
      }
    } finally {
      setCloudSaveBusy(false);
    }
  };

  const handlePointClick = async (point: string) => {
    if (!analysis) return;
    
    setSelectedPoint(point);
    setIsExplaining(true);
    setPointDetails(null);
    
    setTimeout(() => {
      const el = document.getElementById('knowledge-point-details');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 100);
    
    try {
      const details = await explainKnowledgePoint(point, analysis.summary);
      setPointDetails(details);
    } catch (err) {
      console.error(err);
      setError('获取知识点详情失败。');
    } finally {
      setIsExplaining(false);
    }
  };

  const handleExportImage = async () => {
    if (!analysisRef.current) return;
    setIsExportingImage(true);
    try {
      const dataUrl = await htmlToImage.toPng(analysisRef.current, {
        pixelRatio: 2,
        backgroundColor: '#f8fafc', // slate-50 background
        style: {
          width: '800px', // Fixed width for consistent card layout
        },
      });
      const link = document.createElement('a');
      link.download = '错题分析卡片.png';
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Failed to export image:', err);
      alert('导出图片失败，请重试');
    } finally {
      setIsExportingImage(false);
    }
  };

  const handleCopyMarkdown = async () => {
    if (!analysis) return;

    let md = `# 🏷️ 错题分析卡片\n\n`;
    md += `---\n\n`;
    
    if (image) {
      md += `### 📸 原题回顾\n\n`;
      md += `![原题图片](${image})\n\n`;
    }

    if (analysis.circuitDescription?.trim()) {
      md += `**🔌 电路连接：** ${analysis.circuitDescription.trim()}\n\n`;
    }

    if (analysis.figures?.length) {
      for (const fig of analysis.figures) {
        md += `![${fig.label}](${figureDataUri(fig)})\n\n`;
      }
    }
    
    if (analysis.rawOcrText) {
      const ocrMd = prepareOcrMarkdown(analysis.rawOcrText, analysis, image);
      md += `${ocrMd}\n\n`;
    }
    
    md += `---\n\n`;
    md += `### 💡 核心剖析\n\n`;
    md += `**🎯 题目摘要：**\n${analysis.summary}\n\n`;
    md += `**⚠️ 错因诊断：**\n> ${analysis.specificMistake.split('\n').join('\n> ')}\n\n`;
    
    md += `---\n\n`;
    md += `### 🧠 知识网络\n\n`;
    
    md += `**🔑 核心知识点：**\n`;
    analysis.knowledgePoints.forEach(pt => md += `- 📌 ${pt}\n`);
    md += `\n`;
    
    md += `**🚧 常见避坑指南：**\n`;
    analysis.pitfalls.forEach(pf => md += `- ❌ ${pf}\n`);
    md += `\n`;
    
    md += `**🌳 知识结构树：**\n`;
    analysis.knowledgeTree.forEach(node => {
      md += `- **${node.node}**\n`;
      node.children.forEach((child: any) => {
        const childText = typeof child === 'string' ? child : (child.node || child.name || JSON.stringify(child));
        md += `  - 🌿 ${childText}\n`;
      });
    });

    md += `\n---\n*✨ Generated by AI 错题本*`;

    try {
      await navigator.clipboard.writeText(md);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
      alert('复制失败，请手动尝试');
    }
  };

  const fontScaleClass = fontScale === 'sm' ? 'text-sm' : fontScale === 'lg' ? 'text-lg' : 'text-base';

  return (
    <div
      className={`min-h-screen bg-gradient-to-b from-slate-50 via-white to-teal-50/30 text-slate-900 font-sans selection:bg-indigo-100 selection:text-indigo-900 ${fontScaleClass}`}
    >
      <header className="sticky top-0 z-20 border-b border-slate-200/90 bg-white/90 shadow-sm shadow-slate-200/50 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <button
              type="button"
              onClick={onBack}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"
              aria-label="返回首页"
            >
              <Home size={20} />
            </button>
            <div className="bg-gradient-to-br from-emerald-500 to-teal-600 p-2 rounded-xl text-white shrink-0 shadow-md shadow-emerald-200/50">
              <BookOpen size={20} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold tracking-tight text-slate-900 sm:text-lg">
                错题录入
              </h1>
              <p className="hidden truncate text-[11px] text-slate-500 sm:block">拍照分析 · 考点归纳 · 思维交流</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 flex-wrap justify-end">
            <nav className="flex items-center gap-0.5 flex-wrap sm:gap-1">
              <button
                type="button"
                onClick={() => onNavigate('paper')}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-violet-800 hover:bg-violet-50 border border-transparent hover:border-violet-200"
              >
                <FileStack size={14} />
                <span className="hidden sm:inline">试卷分析</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('records')}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 border border-transparent hover:border-slate-200"
              >
                错题本
              </button>
              <button
                type="button"
                onClick={() => onNavigate('map')}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 border border-transparent hover:border-slate-200"
              >
                知识树
              </button>
              {user && isStaff(user.role) ? (
                <button
                  type="button"
                  onClick={() => onNavigate('admin')}
                  className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-50 border border-amber-200/80"
                >
                  后台
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => onNavigate('login')}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50 border border-indigo-100"
              >
                {user ? user.username : '登录'}
              </button>
            </nav>
            <details ref={uiDetailsRef} className="relative group">
              <summary className="list-none cursor-pointer flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors [&::-webkit-details-marker]:hidden">
                <Settings2 size={16} className="text-slate-500" />
                <span className="hidden sm:inline">界面</span>
              </summary>
              <div className="absolute right-0 top-full mt-2 w-52 rounded-xl border border-slate-200 bg-white py-3 px-3 shadow-lg z-20">
                <p className="text-xs font-medium text-slate-500 mb-2 px-1">字号</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    [
                      { id: 'sm' as const, label: '小' },
                      { id: 'md' as const, label: '标准' },
                      { id: 'lg' as const, label: '大' },
                    ] as const
                  ).map(({ id, label }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setFontScale(id);
                        if (uiDetailsRef.current) uiDetailsRef.current.open = false;
                      }}
                      className={`rounded-lg py-2 text-sm font-medium transition-colors ${
                        fontScale === id
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </details>
            {image && (
              <button
                onClick={clearProgress}
                className="text-sm font-medium text-slate-500 hover:text-rose-600 transition-colors px-2"
              >
                清除进度
              </button>
            )}
          </div>
        </div>
      </header>

      {!hasApiKey && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-950">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 text-sm flex items-start gap-2">
            <AlertCircle size={18} className="shrink-0 mt-0.5 text-amber-600" />
            <p>
              尚未配置 <code className="rounded bg-amber-100/80 px-1 py-0.5 text-xs font-mono">GEMINI_API_KEY</code>
              ：请将项目根目录的 <code className="rounded bg-amber-100/80 px-1 py-0.5 text-xs font-mono">.env.example</code>{' '}
              复制为 <code className="rounded bg-amber-100/80 px-1 py-0.5 text-xs font-mono">.env.local</code> 并填入密钥后重新运行{' '}
              <code className="rounded bg-amber-100/80 px-1 py-0.5 text-xs font-mono">npm run dev</code>。
            </p>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Upload & Preview */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <ImageIcon size={20} className="text-indigo-500" />
                  上传错题
                </h2>
              </div>
              
              <div className="p-6">
                {!image ? (
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-300 rounded-xl p-12 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/50 transition-colors group"
                  >
                    <div className="bg-slate-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:bg-indigo-100 transition-colors">
                      <UploadCloud size={28} className="text-slate-500 group-hover:text-indigo-600" />
                    </div>
                    <p className="text-slate-600 font-medium mb-1">点击或拖拽上传错题照片</p>
                    <p className="text-slate-400 text-sm">支持 JPG, PNG 格式</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-100 aspect-auto max-h-[400px] flex items-center justify-center">
                      <img src={image} alt="Uploaded question" className="max-w-full max-h-[400px] object-contain" />
                      <button 
                        onClick={() => {
                          setImage(null);
                          setAnalysis(null);
                          setSelectedPoint(null);
                          resetReflectionLocal();
                        }}
                        className="absolute top-2 right-2 bg-white/90 backdrop-blur-sm p-1.5 rounded-full text-slate-600 hover:text-red-600 hover:bg-white transition-colors shadow-sm"
                      >
                        <X size={18} />
                      </button>
                    </div>
                    
                    <button
                      onClick={handleAnalyze}
                      disabled={isAnalyzing}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed shadow-sm shadow-indigo-200"
                    >
                      {isAnalyzing ? (
                        <>
                          <Loader2 size={20} className="animate-spin" />
                          正在深度分析中...
                        </>
                      ) : (
                        <>
                          <BookOpen size={20} />
                          开始分析错题
                        </>
                      )}
                    </button>
                  </div>
                )}
                
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleImageUpload} 
                  accept="image/*" 
                  className="hidden" 
                />
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-start gap-3">
                <AlertCircle size={20} className="shrink-0 mt-0.5" />
                <p>{error}</p>
              </div>
            )}

            {cloudSaveHint && (
              <div className="bg-amber-50 border border-amber-200 text-amber-950 p-4 rounded-xl space-y-2">
                <p className="text-sm">{cloudSaveHint}</p>
                {analysis && user && canUseApp(user) ? (
                  <button
                    type="button"
                    disabled={cloudSaveBusy}
                    onClick={() => void retryCloudSave()}
                    className="text-sm font-medium text-amber-900 underline hover:text-amber-700 disabled:opacity-50"
                  >
                    {cloudSaveBusy ? '正在同步…' : '重试同步到云端错题本'}
                  </button>
                ) : null}
                {!user ? (
                  <p className="text-xs text-amber-800">请先在右上角登录，并通过超级管理员审核后再分析或同步。</p>
                ) : null}
              </div>
            )}
          </div>

          {/* Right Column: Analysis Results */}
          <div className="lg:col-span-7 space-y-6">
            <AnimatePresence mode="wait">
              {!analysis && !isAnalyzing && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="bg-white rounded-2xl shadow-sm border border-slate-200 p-12 text-center h-full flex flex-col items-center justify-center min-h-[400px]"
                >
                  <div className="bg-slate-50 w-20 h-20 rounded-full flex items-center justify-center mb-6">
                    <Network size={32} className="text-slate-300" />
                  </div>
                  <h3 className="text-xl font-medium text-slate-700 mb-2">等待分析</h3>
                  <p className="text-slate-500 max-w-sm">上传错题照片并点击分析，AI 将为您拆解考察知识点、易错点，并构建知识图谱。</p>
                </motion.div>
              )}

              {isAnalyzing && (
                <motion.div 
                  key="analyzing-loader"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="bg-white rounded-2xl shadow-sm border border-slate-200 p-12 text-center h-full flex flex-col items-center justify-center min-h-[400px]"
                >
                  <Loader2 size={40} className="animate-spin text-indigo-500 mb-6 mx-auto" />
                  <h3 className="text-xl font-medium text-slate-700 mb-2">AI 正在思考...</h3>
                  <p className="text-slate-500">正在提取题目信息、匹配知识库、构建知识网络</p>
                </motion.div>
              )}

              {analysis && (
                <motion.div 
                  key="analysis-result"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-6"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
                    <div>
                      <h2 className="text-xl font-bold text-slate-800">分析结果</h2>
                      <p className="text-sm text-slate-500 mt-0.5">按模块浏览：摘要 → 错因 → 易错点 → 知识网络</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                      <button
                        onClick={handleCopyMarkdown}
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-emerald-600 transition-colors shadow-sm"
                      >
                        {isCopied ? <Check size={16} className="text-emerald-500" /> : <Copy size={16} />}
                        {isCopied ? '已复制' : '导出 Markdown'}
                      </button>
                      <button
                        onClick={handleExportImage}
                        disabled={isExportingImage}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 border border-transparent rounded-lg text-sm font-medium text-white hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-70"
                      >
                        {isExportingImage ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                        {isExportingImage ? '正在生成...' : '导出图片'}
                      </button>
                    </div>
                  </div>

                  <div ref={analysisRef} className="space-y-8 bg-slate-50 p-4 -mx-4 sm:mx-0 sm:p-0">
                    {/* ① OCR + 原题配图 */}
                    {(analysis.rawOcrText || resolveAnalysisImageUri(analysis, image)) && (
                      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 border-l-[5px] border-l-slate-400 overflow-hidden">
                        <div className="px-5 pt-5 pb-2 border-b border-slate-100 bg-slate-50/60">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">① 题目原文</p>
                          <h3 className="text-lg font-bold text-slate-900 mt-1 flex items-center gap-2">
                            <BookOpen size={20} className="text-slate-500 shrink-0" />
                            识别文本 · 表格 · 配图
                          </h3>
                          <p className="text-sm text-slate-500 mt-1">
                            表格以 Markdown 渲染；电路图无法纯文字还原时，保留原题截图嵌入题目
                          </p>
                        </div>
                        <div className="p-5 space-y-4">
                          {resolveCircuitImageUri(analysis, image) ? (
                            <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3">
                              <p className="text-xs font-medium text-emerald-800 mb-2">电路图 / 题图</p>
                              <img
                                src={resolveCircuitImageUri(analysis, image)!}
                                alt="电路图"
                                className="max-h-[320px] w-full object-contain rounded-lg bg-white"
                              />
                            </div>
                          ) : null}
                          {resolveAnalysisImageUri(analysis, image) &&
                          resolveCircuitImageUri(analysis, image) !== resolveAnalysisImageUri(analysis, image) ? (
                            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                              <p className="text-xs font-medium text-slate-500 mb-2">原题完整截图（对照用）</p>
                              <img
                                src={resolveAnalysisImageUri(analysis, image)!}
                                alt="原题截图"
                                className="max-h-[280px] w-full object-contain rounded-lg bg-white"
                              />
                            </div>
                          ) : resolveAnalysisImageUri(analysis, image) &&
                            !resolveCircuitImageUri(analysis, image) ? (
                            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                              <p className="text-xs font-medium text-slate-500 mb-2">原题截图（含电路图 / 表格）</p>
                              <img
                                src={resolveAnalysisImageUri(analysis, image)!}
                                alt="原题配图"
                                className="max-h-[420px] w-full object-contain rounded-lg bg-white"
                              />
                            </div>
                          ) : null}
                          {analysis.circuitDescription?.trim() ? (
                            <div className="rounded-xl border border-amber-100 bg-amber-50/60 px-4 py-3 text-sm text-amber-950">
                              <span className="font-semibold">电路连接：</span>
                              {analysis.circuitDescription.trim()}
                            </div>
                          ) : null}
                          {analysis.rawOcrText ? (
                            <div className="max-h-[520px] overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3">
                              <MarkdownRenderer
                                content={prepareOcrMarkdown(analysis.rawOcrText, analysis, image)}
                                density="relaxed"
                              />
                            </div>
                          ) : null}
                          {analysis.figures
                            ?.filter(
                              (fig) =>
                                fig.id !== 'fig-circuit' &&
                                !analysis.figures?.some((c) => c.id === 'fig-circuit' && c.data === fig.data),
                            )
                            .map((fig) => (
                            <div key={fig.id} className="rounded-xl border border-slate-200 bg-white p-3">
                              <p className="text-xs font-medium text-slate-600 mb-2">{fig.label}</p>
                              {fig.note ? <p className="text-xs text-slate-500 mb-2">{fig.note}</p> : null}
                              <img
                                src={figureDataUri(fig)}
                                alt={fig.label}
                                className="max-h-80 w-full object-contain rounded-lg"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  {/* ② 题目摘要 — 分条要点 */}
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 border-l-[5px] border-l-indigo-500 overflow-hidden">
                    <div className="px-5 pt-5 pb-2 border-b border-slate-100 bg-indigo-50/40">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600">② 题意速览</p>
                      <h3 className="text-lg font-bold text-slate-900 mt-1 flex items-center gap-2">
                        <BookOpen size={20} className="text-indigo-500 shrink-0" />
                        题目摘要
                      </h3>
                      <p className="text-sm text-slate-600 mt-1">抓住题干核心，下面每条单独对应一个信息点</p>
                    </div>
                    <div className="p-5 md:p-6">
                      <ul className="space-y-4">
                        {splitIntoKeyPoints(formatMcqOptionsPerLine(analysis.summary)).map((point, idx) => (
                          <li
                            key={`summary-pt-${idx}`}
                            className="flex gap-3 rounded-xl border border-indigo-100/80 bg-indigo-50/35 px-4 py-3.5"
                          >
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-xs font-bold text-white shadow-sm">
                              {idx + 1}
                            </span>
                            <p className="text-slate-800 leading-[1.75] pt-0.5">{point}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* ③ 错因定位 */}
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 border-l-[5px] border-l-amber-400 overflow-hidden">
                    <div className="px-5 pt-5 pb-2 border-b border-amber-100/80 bg-amber-50/50">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-800">③ 错因拆解</p>
                      <h3 className="text-lg font-bold text-amber-950 mt-1 flex items-center gap-2">
                        <Target size={20} className="text-amber-500 shrink-0" />
                        错因定位
                      </h3>
                      <p className="text-sm text-amber-900/80 mt-1">重点看「错在哪、为什么错」，支持 Markdown 与公式</p>
                    </div>
                    <div className="p-5 md:p-7 text-slate-800">
                      <MarkdownRenderer content={analysis.specificMistake} density="relaxed" />
                    </div>
                  </div>

                  {/* ④ 易错点 */}
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 border-l-[5px] border-l-rose-400 overflow-hidden">
                    <div className="px-5 pt-5 pb-2 border-b border-rose-100 bg-rose-50/40">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-800">④ 易错预警</p>
                      <h3 className="text-lg font-bold text-rose-950 mt-1 flex items-center gap-2">
                        <AlertCircle size={20} className="text-rose-500 shrink-0" />
                        易错点分析
                      </h3>
                      <p className="text-sm text-rose-900/80 mt-1">按条排查常见陷阱，考前可对照自查</p>
                    </div>
                    <div className="p-5 md:p-6">
                      <ul className="space-y-4">
                        {analysis.pitfalls.map((pitfall, idx) => (
                          <li
                            key={`pitfall-${idx}`}
                            className="flex gap-4 rounded-xl border border-rose-100 bg-gradient-to-r from-rose-50/90 to-white px-4 py-4 shadow-sm shadow-rose-100/50"
                          >
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-600 text-sm font-bold text-white shadow-sm">
                              {idx + 1}
                            </span>
                            <p className="text-slate-800 leading-[1.75] pt-0.5">{pitfall}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* ⑤ 知识网络 */}
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 border-l-[5px] border-l-emerald-500 overflow-hidden">
                    <div className="px-5 pt-5 pb-2 border-b border-emerald-100 bg-emerald-50/40">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-800">⑤ 知识网络</p>
                      <h3 className="text-lg font-bold text-emerald-950 mt-1 flex items-center gap-2">
                        <Network size={20} className="text-emerald-500 shrink-0" />
                        知识网络与结构
                      </h3>
                      <p className="text-sm text-emerald-900/80 mt-1">
                        基于初中科学知识树 · 共 {analysis.knowledgePoints.length} 个核心考点 · {analysis.knowledgeTree.length} 组知识树节点
                      </p>
                    </div>
                    <div className="p-5 md:p-6 space-y-10">
                      {/* Knowledge Points */}
                      <div>
                        <h4 className="text-sm font-bold text-indigo-950 mb-4 flex items-center gap-2 pb-2 border-b border-indigo-100">
                          <BookOpen size={17} className="text-indigo-500 shrink-0" />
                          核心知识点
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          {analysis.knowledgePoints.map((point, idx) => {
                            const isSelected = selectedPoint === point;
                            const isDimmed = selectedPoint && !isSelected;
                            return (
                              <button
                                key={`kp-${point}-${idx}`}
                                onClick={() => handlePointClick(point)}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${
                                  isSelected 
                                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-200 scale-105' 
                                    : 'bg-white text-slate-700 border-slate-200 hover:border-indigo-300 hover:bg-indigo-50'
                                } ${isDimmed ? 'opacity-50 grayscale-[50%]' : ''}`}
                              >
                                {point}
                              </button>
                            );
                          })}
                        </div>
                        <p className="text-xs text-slate-500 mt-4 flex items-center gap-1.5 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                          <ChevronRight size={14} className="text-indigo-500 shrink-0" />
                          点击任意知识点可展开下方「详细讲解与例题」
                        </p>
                      </div>

                      {/* Knowledge Tree */}
                      <div className="border-t border-slate-200 pt-8">
                        <h4 className="text-sm font-bold text-emerald-950 mb-4 flex items-center gap-2 pb-2 border-b border-emerald-100">
                          <Network size={17} className="text-emerald-500 shrink-0" />
                          相关知识树
                        </h4>
                        <div className="space-y-4">
                          {analysis.knowledgeTree.map((node, idx) => {
                          const isParentSelected = selectedPoint === node.node;
                          const isChildSelected = node.children.some((child: any) => {
                            const childText = typeof child === 'string' ? child : (child.node || child.name || JSON.stringify(child));
                            return childText === selectedPoint;
                          });
                          const isRelated = isParentSelected || isChildSelected;
                          const isDimmed = selectedPoint && !isRelated;

                          return (
                            <div 
                              key={`tree-node-${node.node}-${idx}`} 
                              className={`rounded-xl p-4 border transition-all duration-300 ${
                                isRelated 
                                  ? 'bg-emerald-50 border-emerald-200 ring-2 ring-emerald-100' 
                                  : 'bg-slate-50 border-slate-100'
                              } ${isDimmed ? 'opacity-40 grayscale-[50%]' : ''}`}
                            >
                              <button 
                                onClick={() => handlePointClick(node.node)}
                                className={`font-medium mb-3 flex items-center gap-2 transition-colors text-left ${
                                  selectedPoint === node.node 
                                    ? 'text-emerald-700 font-bold' 
                                    : 'text-slate-800 hover:text-emerald-600'
                                }`}
                              >
                                <div className={`w-2 h-2 rounded-full transition-all ${selectedPoint === node.node ? 'bg-emerald-600 scale-150' : 'bg-emerald-400'}`}></div>
                                {node.node}
                              </button>
                              <div className="flex flex-wrap gap-2 pl-4 border-l-2 border-slate-200 ml-1">
                                {node.children.map((child: any, cIdx: number) => {
                                  const childText = typeof child === 'string' ? child : (child.node || child.name || JSON.stringify(child));
                                  const isThisChildSelected = selectedPoint === childText;
                                  return (
                                    <button
                                      key={`child-${node.node}-${childText}-${cIdx}`}
                                      onClick={() => handlePointClick(childText)}
                                      className={`px-3 py-1 text-sm rounded-md transition-all border ${
                                        isThisChildSelected
                                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-md scale-105'
                                          : isParentSelected
                                          ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                                          : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300 hover:bg-emerald-50'
                                      }`}
                                    >
                                      {childText}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  </div>

                  {/* ⑥ 思维交流与盲区检测 */}
                  <div className="overflow-hidden rounded-2xl border border-slate-200 border-l-[5px] border-l-violet-500 bg-white shadow-sm">
                    <div className="border-b border-violet-100 bg-violet-50/50 px-5 pt-5 pb-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-800">⑥ 思维交流</p>
                      <h3 className="mt-1 flex items-center gap-2 text-lg font-bold text-violet-950">
                        <MessageCircle size={20} className="shrink-0 text-violet-500" />
                        自述错因 · AI 追问 · 相似题检验
                      </h3>
                      <p className="mt-1 text-sm text-violet-900/80">
                        先写下你的真实思路；系统结合本题考点与（若有）初中科学知识树命中，归纳盲区并生成追问与变式题，用于检验是否真正理解。
                      </p>
                    </div>
                    <div className="space-y-6 p-5 md:p-6">
                      {!user ? (
                        <p className="text-sm text-slate-600">
                          登录后可保存错题并启用本环节（服务器使用 <code className="rounded bg-slate-100 px-1 font-mono text-xs">GEMINI_API_KEY</code>{' '}
                          分析你的文字）。
                        </p>
                      ) : !reflectionMistakeId ? (
                        <p className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-sm text-amber-950">
                          本题尚未写入云端错题库（请先登录后再点「开始分析错题」）。写入后即可填写自述并生成追问。
                        </p>
                      ) : (
                        <>
                          <div>
                            <label className="mb-2 block text-sm font-medium text-slate-800">
                              你为什么选错 / 当时怎么考虑的？
                            </label>
                            <textarea
                              value={studentReflection}
                              onChange={(e) => setStudentReflection(e.target.value)}
                              rows={5}
                              placeholder="例如：我把「滑动变阻器接入长度」和「电阻大小」搞反了；看到图像斜率就以为是速度……"
                              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
                            />
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void runReflectionAnalyze()}
                                disabled={reflectionAnalyzeBusy || studentReflection.trim().length < 8}
                                className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {reflectionAnalyzeBusy ? <Loader2 size={18} className="animate-spin" /> : null}
                                {reflectionAnalyzeBusy ? '分析中…' : '提交思路并生成追问'}
                              </button>
                            </div>
                          </div>

                          {reflectionAnalyzeResult ? (
                            <div className="space-y-6 border-t border-slate-100 pt-6">
                              <div className="rounded-xl border border-violet-100 bg-violet-50/40 px-4 py-3">
                                <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">教师式点评</p>
                                <p className="mt-2 text-sm leading-relaxed text-slate-800">{reflectionAnalyzeResult.teacherComment}</p>
                              </div>

                              <div>
                                <p className="mb-2 text-sm font-bold text-slate-900">潜在知识盲区</p>
                                <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-700">
                                  {reflectionAnalyzeResult.blindSpots.map((b, i) => (
                                    <li key={`bs-${i}`}>{b}</li>
                                  ))}
                                </ul>
                              </div>

                              <div>
                                <p className="mb-3 text-sm font-bold text-slate-900">针对性追问（请逐条简要回答）</p>
                                <ul className="space-y-4">
                                  {reflectionAnalyzeResult.followUpQuestions.map((q, i) => (
                                    <li key={`fu-${i}`} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                                      <p className="text-sm font-medium text-slate-900">
                                        <span className="mr-2 font-bold text-violet-600">{i + 1}.</span>
                                        {q}
                                      </p>
                                      <textarea
                                        value={followUpAnswers[i] ?? ''}
                                        onChange={(e) => {
                                          const next = [...followUpAnswers];
                                          next[i] = e.target.value;
                                          setFollowUpAnswers(next);
                                        }}
                                        rows={3}
                                        className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                                        placeholder="简要作答…"
                                      />
                                    </li>
                                  ))}
                                </ul>
                              </div>

                              <div>
                                <p className="mb-3 text-sm font-bold text-slate-900">相似小题（迁移检验）</p>
                                <ul className="space-y-5">
                                  {reflectionAnalyzeResult.similarQuestions.map((sq, i) => (
                                    <li
                                      key={`sim-${i}`}
                                      className="rounded-xl border border-emerald-100 bg-emerald-50/30 p-4"
                                    >
                                      <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-800">
                                        考查点 · {sq.testingFocus}
                                      </p>
                                      <div className="mt-2 text-sm leading-relaxed text-slate-800 whitespace-pre-wrap">{sq.stem}</div>
                                      <textarea
                                        value={similarAnswers[i] ?? ''}
                                        onChange={(e) => {
                                          const next = [...similarAnswers];
                                          next[i] = e.target.value;
                                          setSimilarAnswers(next);
                                        }}
                                        rows={3}
                                        className="mt-3 w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm"
                                        placeholder="写出你的思路或答案要点…"
                                      />
                                    </li>
                                  ))}
                                </ul>
                              </div>

                              <button
                                type="button"
                                onClick={() => void runReflectionAssess()}
                                disabled={reflectionAssessBusy}
                                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:px-8"
                              >
                                {reflectionAssessBusy ? <Loader2 size={18} className="animate-spin" /> : null}
                                {reflectionAssessBusy ? '评估中…' : '提交作答 · 生成掌握情况评估'}
                              </button>

                              {reflectionAssessResult ? (
                                <div className="rounded-2xl border-2 border-emerald-200 bg-white p-5 shadow-inner">
                                  <div className="flex flex-wrap items-center gap-3 border-b border-emerald-100 pb-3">
                                    <span className="text-sm font-semibold text-slate-600">综合判断</span>
                                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-900">
                                      {reflectionAssessResult.masteryLevel}
                                    </span>
                                  </div>
                                  <div className="mt-4 text-sm leading-relaxed text-slate-800">
                                    <MarkdownRenderer content={reflectionAssessResult.summaryFeedback} density="relaxed" />
                                  </div>
                                  <div className="mt-6 grid gap-6 md:grid-cols-2">
                                    <div>
                                      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">追问反馈</p>
                                      <ul className="space-y-2 text-sm">
                                        {reflectionAssessResult.followUpFeedback.map((f) => (
                                          <li
                                            key={`ff-${f.index}`}
                                            className={`rounded-lg border px-3 py-2 ${f.onTrack ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/50'}`}
                                          >
                                            <span className="font-medium text-slate-800">Q{f.index + 1}</span>{' '}
                                            <span className="text-slate-600">{f.comment}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                    <div>
                                      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">相似题反馈</p>
                                      <ul className="space-y-2 text-sm">
                                        {reflectionAssessResult.similarFeedback.map((f) => (
                                          <li
                                            key={`sf-${f.index}`}
                                            className={`rounded-lg border px-3 py-2 ${f.demonstratesUnderstanding ? 'border-emerald-200 bg-emerald-50/50' : 'border-rose-100 bg-rose-50/40'}`}
                                          >
                                            <span className="font-medium text-slate-800">变式 {f.index + 1}</span>{' '}
                                            <span className="text-slate-600">{f.comment}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>

                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Inline Knowledge Point Details */}
            <AnimatePresence>
              {selectedPoint && (
                <motion.div 
                  key="point-details-modal"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="bg-white rounded-2xl shadow-lg border border-indigo-100 overflow-hidden mt-6"
                  id="knowledge-point-details"
                >
                  <div className="bg-indigo-50/50 border-b border-indigo-100 px-6 py-4 flex items-center justify-between">
                    <h2 className="text-xl font-bold text-indigo-900 flex items-center gap-2">
                      <BookOpen className="text-indigo-600" size={24} />
                      {selectedPoint}
                    </h2>
                    <button 
                      onClick={() => setSelectedPoint(null)}
                      className="p-2 text-indigo-400 hover:text-indigo-600 hover:bg-indigo-100 rounded-full transition-colors"
                    >
                      <X size={20} />
                    </button>
                  </div>

                  <div className="p-6">
                    {isExplaining ? (
                      <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                        <Loader2 size={40} className="animate-spin text-indigo-500 mb-4" />
                        <p>正在生成详细讲解与例题...</p>
                      </div>
                    ) : pointDetails ? (
                      <div className="space-y-10">
                        <section className="rounded-2xl border border-slate-200 border-l-[4px] border-l-indigo-400 bg-white overflow-hidden shadow-sm">
                          <div className="px-5 pt-4 pb-2 bg-indigo-50/50 border-b border-indigo-100">
                            <h3 className="text-base font-bold text-slate-900 flex items-center gap-3">
                              <span className="bg-indigo-600 text-white w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shadow-sm shrink-0">
                                1
                              </span>
                              <span>
                                知识点讲解
                                <span className="block text-xs font-normal text-slate-500 mt-0.5">定义、要点与注意事项</span>
                              </span>
                            </h3>
                          </div>
                          <div className="p-5 md:p-6 bg-slate-50/40">
                            <MarkdownRenderer content={pointDetails.explanation} density="relaxed" />
                          </div>
                        </section>

                        <section className="rounded-2xl border border-slate-200 border-l-[4px] border-l-emerald-400 bg-white overflow-hidden shadow-sm">
                          <div className="px-5 pt-4 pb-2 bg-emerald-50/50 border-b border-emerald-100">
                            <h3 className="text-base font-bold text-slate-900 flex items-center gap-3">
                              <span className="bg-emerald-600 text-white w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shadow-sm shrink-0">
                                2
                              </span>
                              <span>
                                相关例题
                                <span className="block text-xs font-normal text-slate-500 mt-0.5">贴近考点的练习</span>
                              </span>
                            </h3>
                          </div>
                          <div className="p-5 md:p-6">
                            <MarkdownRenderer content={pointDetails.exampleQuestion} density="relaxed" />
                          </div>
                        </section>

                        <section className="rounded-2xl border border-slate-800 border-l-[4px] border-l-amber-400 overflow-hidden shadow-lg">
                          <div className="px-5 pt-4 pb-2 bg-slate-800 border-b border-slate-700">
                            <h3 className="text-base font-bold text-slate-100 flex items-center gap-3">
                              <span className="bg-amber-500 text-slate-900 w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shadow-sm shrink-0">
                                3
                              </span>
                              <span>
                                例题解析
                                <span className="block text-xs font-normal text-slate-400 mt-0.5">步骤与结论</span>
                              </span>
                            </h3>
                          </div>
                          <div className="p-5 md:p-6 bg-slate-900 text-slate-100">
                            <MarkdownRenderer content={pointDetails.exampleSolution} className="markdown-invert" density="relaxed" />
                          </div>
                        </section>
                      </div>
                    ) : (
                      <div className="text-center py-12 text-slate-500">
                        <p>无法加载详情，请重试。</p>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>
    </div>
  );
}
