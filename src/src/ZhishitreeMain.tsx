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
import { analyzeRecognizedQuestion, explainKnowledgePoint, QuestionAnalysis, KnowledgePointDetails, resolveAnalysisImageUri, figureDataUriIfValid, isValidFigureData, recognizeQuestionImage, fetchExamServiceHealth, type OcrEngine, type ExamServiceHealth, type QuestionRecognitionResult, type OcrContentLayout } from './services/geminiService';
import { EditableRecognizedExamText } from './components/EditableRecognizedExamText';
import { EditableOriginalAnswer } from './components/EditableOriginalAnswer';
import { formatMcqOptionsPerLine } from './utils/formatExamDisplay';
import { MarkdownRenderer } from './components/MarkdownRenderer';
import { QuestionSourceMedia } from './components/QuestionSourceMedia';
import {
  QUESTION_UPLOAD_ACCEPT,
  isPdfMime,
  processQuestionUploadFile,
} from './utils/uploadQuestionMedia';
import { useAuth } from './context/AuthContext';
import { canUseApp } from './utils/roles';
import { isStaff } from './utils/roles';
import {
  apiFetch,
  fetchMistakeDetail,
  saveMistakeIfAuthed,
  updateMistakeIfAuthed,
  saveReflectionProgressIfAuthed,
  type ReflectionAnalyzeResponse,
  type ReflectionAssessResponse,
} from './services/api';
import { restoreMistakeSession } from './components/mistakeDisplay';
import { SummaryPointsList } from './components/SummaryPointsList';
import { MistakeCauseSelector } from './components/MistakeCauseSelector';
import { QuestionOriginalPanel } from './components/QuestionOriginalPanel';
import { prepareOcrMarkdown } from './utils/examMarkdownPreview';

const KNOWLEDGE_TREE_VERSION = 'junior-science-v1';

/** 写入 localStorage 时去掉大图二进制，避免配额溢出与 JSON 截断 */
function slimAnalysisForStorage(analysis: QuestionAnalysis): QuestionAnalysis {
  const rawOcrText = analysis.rawOcrText.replace(
    /!\[([^\]]*)\]\(data:[^)]+\)/g,
    '![$1](fig-circuit)',
  );
  const slimFigures = analysis.figures?.map((f) => {
    if (f.id === 'fig-circuit' && isValidFigureData(f.data)) {
      return f;
    }
    return { ...f, data: '' };
  });
  return {
    ...analysis,
    rawOcrText,
    sourceImage: analysis.sourceImage
      ? { mime: analysis.sourceImage.mime, data: '' }
      : undefined,
    figures: slimFigures,
  };
}

/** 同步云端时保留原题截图（localStorage 会剥离 base64） */
function analysisForCloudSave(
  analysis: QuestionAnalysis,
  image: string | null,
  mimeType: string,
): QuestionAnalysis {
  if (isValidFigureData(analysis.sourceImage?.data)) return analysis;
  const base64 = image?.includes(',') ? image.split(',')[1] : image;
  if (!isValidFigureData(base64)) return analysis;
  return {
    ...analysis,
    sourceImage: { mime: mimeType || 'image/jpeg', data: base64! },
  };
}

export function ZhishitreeMain({
  mistakeId,
  returnTo = 'home',
  onNavigate,
  onBack,
}: {
  mistakeId?: number;
  returnTo?: 'home' | 'records';
  onNavigate: (path: string, query?: Record<string, string | number>) => void;
  onBack: () => void;
}) {
  const { user } = useAuth();
  const skipLocalRestore = Boolean(mistakeId);
  const [image, setImage] = useState<string | null>(() => {
    if (skipLocalRestore) return null;
    const saved = localStorage.getItem('app_image');
    return saved || null;
  });
  const [mimeType, setMimeType] = useState<string>(() => {
    if (skipLocalRestore) return '';
    const saved = localStorage.getItem('app_mimeType');
    return saved || '';
  });
  const [uploadFileName, setUploadFileName] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [recognitionResult, setRecognitionResult] = useState<QuestionRecognitionResult | null>(null);
  const [mistakeRestoring, setMistakeRestoring] = useState(Boolean(mistakeId));
  const [viewingMistakeId, setViewingMistakeId] = useState<number | null>(mistakeId ?? null);
  const [analysis, setAnalysis] = useState<QuestionAnalysis | null>(() => {
    if (skipLocalRestore) return null;
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
  const [selectedCauseIndices, setSelectedCauseIndices] = useState<number[]>([]);
  const [otherCause, setOtherCause] = useState('');
  const [reflectionSaveState, setReflectionSaveState] = useState<'idle' | 'pending' | 'saving' | 'saved' | 'error'>('idle');
  const reflectionSkipAutosaveRef = useRef(true);
  const [cloudSaveHint, setCloudSaveHint] = useState<string | null>(null);
  const [cloudSaveBusy, setCloudSaveBusy] = useState(false);
  const [ocrEditSaving, setOcrEditSaving] = useState(false);
  const [ocrEngine, setOcrEngine] = useState<OcrEngine>(() => {
    const saved = localStorage.getItem('zhishitree_ocr_engine');
    return saved === 'exam-service' ? 'exam-service' : 'default';
  });
  const [examServiceHealth, setExamServiceHealth] = useState<ExamServiceHealth | null>(null);

  type FontScale = 'sm' | 'md' | 'lg';
  const [fontScale, setFontScale] = useState<FontScale>(() => {
    const saved = localStorage.getItem('zhishitree_ui_font') as FontScale | null;
    return saved === 'sm' || saved === 'lg' ? saved : 'md';
  });

  const hasApiKey = Boolean(String(process.env.GEMINI_API_KEY ?? '').trim());

  const persistReflectionProgress = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!reflectionMistakeId) return false;
      if (!opts?.silent) setReflectionSaveState('saving');
      const result = await saveReflectionProgressIfAuthed(reflectionMistakeId, {
        reflectionText: studentReflection,
        followUpAnswers,
        similarAnswers,
        selectedCauseIndices,
        otherCause,
      });
      if (result.ok) {
        if (!opts?.silent) setReflectionSaveState('saved');
        return true;
      }
      if (!opts?.silent) setReflectionSaveState('error');
      return false;
    },
    [reflectionMistakeId, studentReflection, followUpAnswers, similarAnswers, selectedCauseIndices, otherCause],
  );

  const causeSaveHint = (() => {
    if (!user) return '可先勾选，登录并保存到错题本后同步云端';
    if (!reflectionMistakeId) return '请先保存到错题本以记录选择';
    if (reflectionSaveState === 'saved') return '已自动保存';
    if (reflectionSaveState === 'error') return '保存失败';
    if (reflectionSaveState === 'pending' || reflectionSaveState === 'saving') return '保存中…';
    return null;
  })();

  useEffect(() => {
    if (!reflectionMistakeId || !user) return;
    if (reflectionSkipAutosaveRef.current) return;

    setReflectionSaveState('pending');
    const timer = window.setTimeout(() => {
      void persistReflectionProgress({ silent: true }).then((ok) => {
        setReflectionSaveState(ok ? 'saved' : 'error');
      });
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [
    reflectionMistakeId,
    user,
    studentReflection,
    followUpAnswers,
    similarAnswers,
    selectedCauseIndices,
    otherCause,
    persistReflectionProgress,
  ]);

  // Save state to localStorage whenever it changes
  useEffect(() => {
    if (!image || isPdfMime(mimeType)) {
      localStorage.removeItem('app_image');
      return;
    }
    try {
      localStorage.setItem('app_image', image);
    } catch {
      /* localStorage 配额不足时跳过 */
    }
  }, [image, mimeType]);

  useEffect(() => {
    if (mimeType) localStorage.setItem('app_mimeType', mimeType);
    else localStorage.removeItem('app_mimeType');
  }, [mimeType]);

  useEffect(() => {
    if (analysis) {
      try {
        localStorage.setItem('app_analysis', JSON.stringify(slimAnalysisForStorage(analysis)));
      } catch {
        /* localStorage 配额不足时跳过，内存中仍保留完整 analysis */
      }
    } else localStorage.removeItem('app_analysis');
  }, [analysis]);

  useEffect(() => {
    localStorage.setItem('zhishitree_ui_font', fontScale);
  }, [fontScale]);

  useEffect(() => {
    localStorage.setItem('zhishitree_ocr_engine', ocrEngine);
  }, [ocrEngine]);

  useEffect(() => {
    let cancelled = false;
    void fetchExamServiceHealth().then((h) => {
      if (cancelled) return;
      setExamServiceHealth(h);
      if (h.ok && !localStorage.getItem('zhishitree_ocr_engine')) {
        setOcrEngine('exam-service');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!mistakeId) {
      setMistakeRestoring(false);
      setViewingMistakeId(null);
      return;
    }
    if (!user) {
      setMistakeRestoring(false);
      setError('请先登录后从错题本打开记录');
      return;
    }

    let cancelled = false;
    setMistakeRestoring(true);
    setError(null);

    (async () => {
      try {
        const row = await fetchMistakeDetail(mistakeId);
        if (cancelled) return;
        const restored = restoreMistakeSession(row);
        if (!restored) {
          setError('错题数据损坏，无法恢复解析');
          setMistakeRestoring(false);
          return;
        }
        setAnalysis(restored.analysis);
        setRecognitionResult({
          rawOcrText: restored.analysis.rawOcrText,
          originalAnswer: restored.analysis.originalAnswer,
          correctedAnswer: restored.analysis.correctedAnswer,
          circuitDescription: restored.analysis.circuitDescription,
          figures: restored.analysis.figures,
          ocrMeta: restored.analysis.ocrMeta,
        });
        setImage(restored.image);
        setMimeType(restored.mimeType);
        setReflectionMistakeId(restored.mistakeId);
        setStudentReflection(restored.studentReflection);
        setReflectionAnalyzeResult(restored.reflectionAnalyzeResult);
        setFollowUpAnswers(restored.followUpAnswers);
        setSimilarAnswers(restored.similarAnswers);
        setReflectionAssessResult(restored.reflectionAssessResult);
        setSelectedCauseIndices(restored.selectedCauseIndices);
        setOtherCause(restored.otherCause);
        reflectionSkipAutosaveRef.current = true;
        window.setTimeout(() => {
          reflectionSkipAutosaveRef.current = false;
          setReflectionSaveState(
            restored.studentReflection ||
              restored.reflectionAnalyzeResult ||
              restored.selectedCauseIndices.length > 0 ||
              restored.otherCause.trim()
              ? 'saved'
              : 'idle',
          );
        }, 0);
        setSelectedPoint(null);
        setPointDetails(null);
        setCloudSaveHint(null);
        setViewingMistakeId(restored.mistakeId);
        localStorage.setItem('app_knowledge_tree_version', KNOWLEDGE_TREE_VERSION);
        setMistakeRestoring(false);
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '加载错题失败');
          setMistakeRestoring(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mistakeId, user]);

  const resetReflectionLocal = useCallback(() => {
    setReflectionMistakeId(null);
    setStudentReflection('');
    setReflectionAnalyzeResult(null);
    setReflectionAssessResult(null);
    setFollowUpAnswers([]);
    setSimilarAnswers([]);
    setSelectedCauseIndices([]);
    setOtherCause('');
  }, []);

  const clearMistakeRoute = useCallback(() => {
    if (mistakeId) onNavigate('entry');
  }, [mistakeId, onNavigate]);

  const clearProgress = () => {
    if (window.confirm('确定要清除当前进度并重新开始吗？')) {
      setImage(null);
      setMimeType('');
      setAnalysis(null);
      setRecognitionResult(null);
      setSelectedPoint(null);
      setPointDetails(null);
      setError(null);
      resetReflectionLocal();
      setViewingMistakeId(null);
      localStorage.removeItem('app_image');
      localStorage.removeItem('app_mimeType');
      localStorage.removeItem('app_analysis');
      localStorage.setItem('app_knowledge_tree_version', KNOWLEDGE_TREE_VERSION);
      clearMistakeRoute();
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const analysisRef = useRef<HTMLDivElement>(null);
  const uiDetailsRef = useRef<HTMLDetailsElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    try {
      const processed = await processQuestionUploadFile(file);
      setImage(processed.dataUrl);
      setMimeType(processed.mimeType);
      setUploadFileName(processed.fileName);
      setAnalysis(null);
      setRecognitionResult(null);
      setError(null);
      setSelectedPoint(null);
      setPointDetails(null);
      resetReflectionLocal();
      setViewingMistakeId(null);
      clearMistakeRoute();
      localStorage.setItem('app_knowledge_tree_version', KNOWLEDGE_TREE_VERSION);
    } catch (err) {
      setError(err instanceof Error ? err.message : '文件处理失败');
    }
  };

  const handleRecognize = async () => {
    if (!image || analysis) return;
    setIsRecognizing(true);
    setError(null);
    setCloudSaveHint(null);
    setRecognitionResult(null);
    resetReflectionLocal();
    try {
      const base64Data = image.split(',')[1];
      const recognition = await recognizeQuestionImage(base64Data, mimeType, ocrEngine);
      setRecognitionResult(recognition);
    } catch (err: unknown) {
      console.error(err);
      setError(`识别失败，请重试。${err instanceof Error ? err.message : '未知网络错误'}`);
    } finally {
      setIsRecognizing(false);
    }
  };

  const handleAnalyzeKnowledge = async () => {
    if (!image || !recognitionResult || analysis) return;
    setIsAnalyzing(true);
    setError(null);
    setCloudSaveHint(null);
    try {
      const base64Data = image.split(',')[1];
      const result = await analyzeRecognizedQuestion(
        recognitionResult.rawOcrText,
        base64Data,
        mimeType,
        recognitionResult,
      );
      setAnalysis({
        ...result,
        ocrLayout: recognitionResult.ocrLayout ?? result.ocrLayout,
      });
      setStudentReflection('');
      setReflectionAnalyzeResult(null);
      setReflectionAssessResult(null);
      setFollowUpAnswers([]);
      setSimilarAnswers([]);
      reflectionSkipAutosaveRef.current = true;
      setReflectionSaveState('idle');
      const saved = await saveMistakeIfAuthed(analysisForCloudSave(result, image, mimeType));
      if (saved.ok) {
        setReflectionMistakeId(saved.id);
        setCloudSaveHint(null);
        reflectionSkipAutosaveRef.current = false;
      } else {
        setReflectionMistakeId(null);
        setCloudSaveHint(saved.ok === false ? saved.message : '同步云端失败');
      }
    } catch (err: unknown) {
      console.error(err);
      setError(`考点分析失败，请重试。${err instanceof Error ? err.message : '未知网络错误'}`);
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
      reflectionSkipAutosaveRef.current = true;
      setReflectionSaveState('saved');
      window.setTimeout(() => {
        reflectionSkipAutosaveRef.current = false;
      }, 0);
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
      reflectionSkipAutosaveRef.current = true;
      setReflectionSaveState('saved');
      window.setTimeout(() => {
        reflectionSkipAutosaveRef.current = false;
      }, 0);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '评估失败');
    } finally {
      setReflectionAssessBusy(false);
    }
  };

  const persistAnalysisToCloud = async (payload: QuestionAnalysis): Promise<boolean> => {
    const existingId = reflectionMistakeId ?? viewingMistakeId;
    if (existingId) {
      const updated = await updateMistakeIfAuthed(existingId, payload);
      if (updated.ok) {
        setReflectionMistakeId(existingId);
        setCloudSaveHint(null);
        reflectionSkipAutosaveRef.current = false;
        return true;
      }
      setCloudSaveHint(updated.ok === false ? updated.message : '更新失败');
      return false;
    }
    const saved = await saveMistakeIfAuthed(payload);
    if (saved.ok) {
      setReflectionMistakeId(saved.id);
      setCloudSaveHint(null);
      reflectionSkipAutosaveRef.current = false;
      return true;
    }
    setCloudSaveHint(saved.ok === false ? saved.message : '保存失败');
    return false;
  };

  const retryCloudSave = async () => {
    if (!analysis) return;
    setCloudSaveBusy(true);
    setCloudSaveHint(null);
    try {
      await persistAnalysisToCloud(analysisForCloudSave(analysis, image, mimeType));
    } finally {
      setCloudSaveBusy(false);
    }
  };

  const handleCorrectedAnswerSave = async (nextAnswer: string) => {
    const trimmed = nextAnswer.trim();
    if (analysis) {
      const nextAnalysis: QuestionAnalysis = { ...analysis, correctedAnswer: trimmed || undefined };
      setAnalysis(nextAnalysis);
      setRecognitionResult((prev) => (prev ? { ...prev, correctedAnswer: trimmed || undefined } : prev));
      if (!user || !canUseApp(user)) return;
      setOcrEditSaving(true);
      try {
        const ok = await persistAnalysisToCloud(analysisForCloudSave(nextAnalysis, image, mimeType));
        if (!ok) {
          setError('批改答案已更新，但同步云端失败，可点击「重试同步到云端错题本」。');
        }
      } finally {
        setOcrEditSaving(false);
      }
      return;
    }
    if (recognitionResult) {
      setRecognitionResult({ ...recognitionResult, correctedAnswer: trimmed || undefined });
    }
  };

  const handleOriginalAnswerSave = async (nextAnswer: string) => {
    const trimmed = nextAnswer.trim();
    if (analysis) {
      const nextAnalysis: QuestionAnalysis = { ...analysis, originalAnswer: trimmed || undefined };
      setAnalysis(nextAnalysis);
      setRecognitionResult((prev) => (prev ? { ...prev, originalAnswer: trimmed || undefined } : prev));
      if (!user || !canUseApp(user)) return;
      setOcrEditSaving(true);
      try {
        const ok = await persistAnalysisToCloud(analysisForCloudSave(nextAnalysis, image, mimeType));
        if (!ok) {
          setError('手写答案已更新，但同步云端失败，可点击「重试同步到云端错题本」。');
        }
      } finally {
        setOcrEditSaving(false);
      }
      return;
    }
    if (recognitionResult) {
      setRecognitionResult({ ...recognitionResult, originalAnswer: trimmed || undefined });
    }
  };

  const handleOcrLayoutSave = async (layout: OcrContentLayout) => {
    if (analysis) {
      const nextAnalysis: QuestionAnalysis = { ...analysis, ocrLayout: layout };
      setAnalysis(nextAnalysis);
      if (!user || !canUseApp(user)) return;
      setOcrEditSaving(true);
      try {
        const ok = await persistAnalysisToCloud(analysisForCloudSave(nextAnalysis, image, mimeType));
        if (!ok) {
          setError('排版已更新，但同步云端失败，可点击「重试同步到云端错题本」。');
        }
      } finally {
        setOcrEditSaving(false);
      }
      return;
    }
    if (recognitionResult) {
      setRecognitionResult({ ...recognitionResult, ocrLayout: layout });
    }
  };

  const handleOcrTextSave = async (nextRaw: string) => {
    const formatted = formatMcqOptionsPerLine(nextRaw);
    if (analysis) {
      const nextAnalysis: QuestionAnalysis = { ...analysis, rawOcrText: formatted };
      setAnalysis(nextAnalysis);
      setRecognitionResult((prev) => (prev ? { ...prev, rawOcrText: formatted } : prev));
      if (!user || !canUseApp(user)) return;
      setOcrEditSaving(true);
      try {
        const ok = await persistAnalysisToCloud(analysisForCloudSave(nextAnalysis, image, mimeType));
        if (!ok) {
          setError('识别文本已更新，但同步云端失败，可点击「重试同步到云端错题本」。');
        }
      } finally {
        setOcrEditSaving(false);
      }
      return;
    }
    if (recognitionResult) {
      setRecognitionResult({ ...recognitionResult, rawOcrText: formatted });
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
        const uri = figureDataUriIfValid(fig) ?? image;
        if (uri) md += `![${fig.label}](${uri})\n\n`;
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
  const showResultsPanel = Boolean(
    analysis || isAnalyzing || isRecognizing || recognitionResult || mistakeRestoring,
  );
  const compactUploadPanel = Boolean(analysis || (recognitionResult && !analysis));
  const ocrPreviewAnalysis: QuestionAnalysis | null =
    analysis ??
    (recognitionResult
      ? {
          rawOcrText: recognitionResult.rawOcrText,
          knowledgePoints: [],
          pitfalls: [],
          knowledgeTree: [],
          summary: '',
          specificMistake: '',
          originalAnswer: recognitionResult.originalAnswer,
          correctedAnswer: recognitionResult.correctedAnswer,
          figures: recognitionResult.figures,
          circuitDescription: recognitionResult.circuitDescription,
          ocrMeta: recognitionResult.ocrMeta,
          ocrLayout: recognitionResult.ocrLayout,
        }
      : null);

  return (
    <div
      className={`min-h-screen bg-gradient-to-b from-slate-50 via-white to-teal-50/30 text-slate-900 font-sans selection:bg-indigo-100 selection:text-indigo-900 ${fontScaleClass}`}
    >
      <header className="sticky top-0 z-20 border-b border-slate-200/90 bg-white/90 shadow-sm shadow-slate-200/50 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8 xl:px-10">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <button
              type="button"
              onClick={onBack}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"
              aria-label={returnTo === 'records' ? '返回错题本' : '返回首页'}
            >
              <Home size={20} />
            </button>
            <div className="bg-gradient-to-br from-emerald-500 to-teal-600 p-2 rounded-xl text-white shrink-0 shadow-md shadow-emerald-200/50">
              <BookOpen size={20} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold tracking-tight text-slate-900 sm:text-lg">
                {viewingMistakeId ? `错题解析 #${viewingMistakeId}` : '错题录入'}
              </h1>
              <p className="hidden truncate text-[11px] text-slate-500 sm:block">
                {viewingMistakeId
                  ? '已从云端恢复 · 保留原解析与思维交流'
                  : '拍照分析 · 考点归纳 · 思维交流'}
              </p>
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
          <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 xl:px-10 py-3 text-sm flex items-start gap-2">
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

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 xl:px-10 py-5">
        <div className={`grid gap-5 items-start ${showResultsPanel ? 'lg:grid-cols-12' : 'grid-cols-1 max-w-2xl mx-auto'}`}>
          
          {/* Left Column: Upload & Preview */}
          <div className={`space-y-4 min-w-0 ${showResultsPanel ? 'lg:col-span-3 lg:sticky lg:top-[4.5rem] lg:self-start' : ''}`}>
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className={`border-b border-slate-100 bg-slate-50/50 ${compactUploadPanel ? 'px-4 py-3' : 'p-5'}`}>
                <h2 className={`font-semibold flex items-center gap-2 ${compactUploadPanel ? 'text-sm' : 'text-lg'}`}>
                  <ImageIcon size={compactUploadPanel ? 16 : 20} className="text-indigo-500" />
                  上传错题
                </h2>
              </div>
              
              <div className={compactUploadPanel ? 'p-4' : 'p-6'}>
                {!image ? (
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed border-slate-300 rounded-xl text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/50 transition-colors group ${compactUploadPanel ? 'p-6' : 'p-12'}`}
                  >
                    <div className={`bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3 group-hover:bg-indigo-100 transition-colors ${analysis ? 'w-12 h-12' : 'w-16 h-16 mb-4'}`}>
                      <UploadCloud size={analysis ? 22 : 28} className="text-slate-500 group-hover:text-indigo-600" />
                    </div>
                    <p className={`text-slate-600 font-medium ${analysis ? 'text-sm mb-0.5' : 'mb-1'}`}>
                      点击或拖拽上传错题
                    </p>
                    {!analysis && <p className="text-slate-400 text-sm">支持 JPG、PNG、PDF（扫描版请用 exam 识别）</p>}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className={`relative rounded-lg overflow-hidden border border-slate-200 bg-slate-100 w-full ${compactUploadPanel ? 'max-h-[200px]' : 'max-h-[400px]'}`}>
                      <QuestionSourceMedia
                        uri={image}
                        mime={mimeType}
                        fileName={uploadFileName}
                        alt="Uploaded question"
                        className={`w-full max-w-full object-contain ${compactUploadPanel ? 'max-h-[200px]' : 'max-h-[400px]'}`}
                        embedClassName={`w-full rounded-md bg-white border-0 ${compactUploadPanel ? 'max-h-[200px]' : 'max-h-[360px]'}`}
                      />
                      <button 
                        onClick={() => {
                          setImage(null);
                          setUploadFileName(null);
                          setMimeType('');
                          setAnalysis(null);
                          setRecognitionResult(null);
                          setSelectedPoint(null);
                          resetReflectionLocal();
                          setViewingMistakeId(null);
                          clearMistakeRoute();
                        }}
                        className="absolute top-2 right-2 bg-white/90 backdrop-blur-sm p-1.5 rounded-full text-slate-600 hover:text-red-600 hover:bg-white transition-colors shadow-sm"
                      >
                        <X size={18} />
                      </button>
                    </div>
                    
                    {!analysis && !isAnalyzing && !isRecognizing && !recognitionResult ? (
                      <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 space-y-1.5">
                        <p className="text-[11px] font-medium text-slate-600">识别引擎（环节 ①）</p>
                        <div className="grid grid-cols-1 gap-1.5">
                          <label className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 cursor-pointer transition-colors ${ocrEngine === 'default' ? 'border-indigo-300 bg-indigo-50/60' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                            <input
                              type="radio"
                              name="ocr-engine"
                              className="mt-0.5"
                              checked={ocrEngine === 'default'}
                              onChange={() => setOcrEngine('default')}
                            />
                            <span className="min-w-0">
                              <span className="block text-xs font-medium text-slate-800">默认（内置 MinerU / 视觉）</span>
                              <span className="block text-[11px] text-slate-500">应用内置识别链路，无需额外服务</span>
                            </span>
                          </label>
                          <label className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 cursor-pointer transition-colors ${ocrEngine === 'exam-service' ? 'border-emerald-300 bg-emerald-50/60' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                            <input
                              type="radio"
                              name="ocr-engine"
                              className="mt-0.5"
                              checked={ocrEngine === 'exam-service'}
                              onChange={() => setOcrEngine('exam-service')}
                            />
                            <span className="min-w-0">
                              <span className="block text-xs font-medium text-slate-800 flex items-center gap-1.5">
                                exam-paper-recognition 服务
                                {examServiceHealth ? (
                                  <span
                                    className={`inline-block h-1.5 w-1.5 rounded-full ${examServiceHealth.ok ? 'bg-emerald-500' : 'bg-rose-400'}`}
                                    title={examServiceHealth.message}
                                  />
                                ) : null}
                              </span>
                              <span className="block text-[11px] text-slate-500">
                                cloud_precision + 规则后处理 + AI 纠错（需 8080 服务在线）
                              </span>
                            </span>
                          </label>
                        </div>
                        {ocrEngine === 'exam-service' && examServiceHealth && !examServiceHealth.ok ? (
                          <p className="text-[11px] text-rose-600 leading-relaxed">
                            {examServiceHealth.message}
                            {examServiceHealth.detail ? `（${examServiceHealth.detail}）` : ''}；识别失败时会自动回退默认链路。
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="flex items-center gap-1 text-[10px] text-slate-400 px-0.5">
                      <span className={recognitionResult || analysis ? 'text-emerald-600 font-semibold' : 'font-medium'}>① 试卷识别</span>
                      <ChevronRight size={10} />
                      <span className={analysis ? 'text-emerald-600 font-semibold' : ''}>② 核对编辑</span>
                      <ChevronRight size={10} />
                      <span className={analysis ? 'text-emerald-600 font-semibold' : ''}>③ 考点分析</span>
                    </div>

                    {!analysis && !recognitionResult ? (
                      <button
                        type="button"
                        onClick={() => void handleRecognize()}
                        disabled={isRecognizing || isAnalyzing}
                        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed shadow-sm shadow-emerald-200 py-3 px-4 rounded-xl"
                      >
                        {isRecognizing ? (
                          <>
                            <Loader2 size={20} className="animate-spin" />
                            正在识别题目…
                          </>
                        ) : (
                          <>
                            <BookOpen size={20} />
                            ① 识别题目
                          </>
                        )}
                      </button>
                    ) : null}

                    {recognitionResult && !analysis ? (
                      <div className="space-y-2">
                        <button
                          type="button"
                          onClick={() => void handleAnalyzeKnowledge()}
                          disabled={isAnalyzing || isRecognizing}
                          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed shadow-sm shadow-indigo-200 py-3 px-4 rounded-xl"
                        >
                          {isAnalyzing ? (
                            <>
                              <Loader2 size={20} className="animate-spin" />
                              正在分析考点…
                            </>
                          ) : (
                            <>
                              <Target size={20} />
                              ③ 开始考点分析
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRecognize()}
                          disabled={isRecognizing || isAnalyzing}
                          className="w-full text-sm text-slate-600 hover:text-indigo-700 py-1.5"
                        >
                          重新识别
                        </button>
                      </div>
                    ) : null}

                    {analysis ? (
                      <button
                        type="button"
                        disabled
                        className="w-full bg-indigo-600 text-white font-medium rounded-lg flex items-center justify-center gap-2 opacity-70 cursor-not-allowed shadow-sm py-2 px-3 text-sm"
                      >
                        <Check size={20} />
                        已完成分析
                      </button>
                    ) : null}
                    {viewingMistakeId ? (
                      <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 leading-relaxed">
                        已从错题本恢复 #{viewingMistakeId}，保留原解析与思维交流记录，无需重复分析。
                      </p>
                    ) : null}
                  </div>
                )}
                
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={(e) => void handleFileUpload(e)} 
                  accept={QUESTION_UPLOAD_ACCEPT} 
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
          <div className={`${showResultsPanel ? 'lg:col-span-9' : ''} min-w-0 w-full`}>
            <div
              className={`relative w-full ${
                isRecognizing || (isAnalyzing && !analysis) || (mistakeRestoring && !analysis && !isAnalyzing)
                  ? 'min-h-[min(360px,45vh)]'
                  : ''
              }`}
            >
              {(isRecognizing || (isAnalyzing && !analysis)) && (
                <div
                  className="absolute inset-0 z-20 flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white/95 backdrop-blur-sm p-8 text-center shadow-sm"
                  aria-busy="true"
                >
                  <Loader2
                    size={40}
                    className={`animate-spin mb-6 mx-auto ${isRecognizing ? 'text-emerald-500' : 'text-indigo-500'}`}
                  />
                  <h3 className="text-xl font-medium text-slate-700 mb-2">
                    {isRecognizing ? '正在识别题目…' : 'AI 正在分析考点…'}
                  </h3>
                  <p className="text-slate-500 text-sm max-w-md">
                    {isRecognizing
                      ? ocrEngine === 'exam-service'
                        ? 'exam-paper-recognition 识别题目正文，并按黑/红笔迹提取手写答案'
                        : '内置 MinerU / 视觉 OCR 识别题目，并按黑/红笔迹提取手写答案'
                      : '基于已识别正文，匹配知识库并构建知识网络（不再重复 OCR）'}
                  </p>
                </div>
              )}

              {mistakeRestoring && !analysis && !isAnalyzing && (
                <div
                  className="absolute inset-0 z-20 flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white/95 backdrop-blur-sm p-8 text-center shadow-sm"
                  aria-busy="true"
                >
                  <Loader2 size={40} className="animate-spin text-emerald-500 mb-6 mx-auto" />
                  <h3 className="text-xl font-medium text-slate-700 mb-2">正在恢复解析...</h3>
                  <p className="text-slate-500 text-sm">从云端加载原题、分析结果与思维交流记录</p>
                </div>
              )}

              {!showResultsPanel && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-12 text-center flex flex-col items-center justify-center min-h-[320px] w-full">
                  <div className="bg-slate-50 w-20 h-20 rounded-full flex items-center justify-center mb-6">
                    <Network size={32} className="text-slate-300" />
                  </div>
                  <h3 className="text-xl font-medium text-slate-700 mb-2">等待上传</h3>
                  <p className="text-slate-500 max-w-sm">上传错题照片或 PDF 后，先识别题目，核对无误再分析考点。</p>
                </div>
              )}

              {!analysis && !isAnalyzing && !isRecognizing && !mistakeRestoring && recognitionResult && ocrPreviewAnalysis && (
                <div className="w-full bg-white rounded-xl shadow-sm border border-emerald-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-emerald-100 bg-emerald-50/40 border-l-4 border-l-emerald-500">
                    <h2 className="text-lg font-bold text-slate-800">识别结果</h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      环节 ②：先核对识别文本，再核对黑色原始作答与红色批改答案；可直接编辑，确认后点击左侧「开始考点分析」
                    </p>
                    {ocrPreviewAnalysis.ocrMeta ? (
                      <p className="mt-1 text-[11px] text-emerald-700">
                        识别流水线：{ocrPreviewAnalysis.ocrMeta.pipeline}
                        {ocrPreviewAnalysis.ocrMeta.mineruBackend
                          ? ` · ${ocrPreviewAnalysis.ocrMeta.mineruBackend}`
                          : ''}
                      </p>
                    ) : null}
                  </div>
                  <div className="p-4 min-w-0 space-y-4">
                    <EditableRecognizedExamText
                      rawText={ocrPreviewAnalysis.rawOcrText}
                      previewMarkdown={prepareOcrMarkdown(ocrPreviewAnalysis.rawOcrText, ocrPreviewAnalysis, image)}
                      onSave={handleOcrTextSave}
                      ocrLayout={ocrPreviewAnalysis.ocrLayout}
                      onLayoutSave={handleOcrLayoutSave}
                      saving={ocrEditSaving}
                      className="recognized-exam-preview min-w-0"
                      sourceImageUri={resolveAnalysisImageUri(ocrPreviewAnalysis, image)}
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <EditableOriginalAnswer
                        kind="original"
                        value={ocrPreviewAnalysis.originalAnswer || ''}
                        onSave={handleOriginalAnswerSave}
                        saving={ocrEditSaving}
                      />
                      <EditableOriginalAnswer
                        kind="corrected"
                        value={ocrPreviewAnalysis.correctedAnswer || ''}
                        onSave={handleCorrectedAnswerSave}
                        saving={ocrEditSaving}
                      />
                    </div>
                  </div>
                </div>
              )}

              {!analysis && !isAnalyzing && !isRecognizing && !mistakeRestoring && !recognitionResult && image && showResultsPanel && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-12 text-center min-h-[280px] flex flex-col items-center justify-center w-full">
                  <BookOpen size={36} className="text-indigo-300 mb-4" />
                  <h3 className="text-lg font-medium text-slate-700 mb-2">已上传，等待识别</h3>
                  <p className="text-slate-500 text-sm max-w-sm">点击左侧「① 识别题目」开始 exam-paper-recognition 试卷识别。</p>
                </div>
              )}

              {analysis && (
                <div className="space-y-4 w-full">
                  <div className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-center bg-white px-4 py-3 rounded-xl shadow-sm border border-slate-200">
                    <div>
                      <h2 className="text-lg font-bold text-slate-800">分析结果</h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        摘要 · 错因 · 易错点 · 知识网络 并排浏览
                      </p>
                      {analysis.ocrMeta ? (
                        <p className="mt-1 text-[11px] text-emerald-700">
                          识别流水线：{analysis.ocrMeta.pipeline}
                          {analysis.ocrMeta.source === 'mineru'
                            ? ` · MinerU ${analysis.ocrMeta.mineruBackend ?? 'VLM'}`
                            : ' · 视觉大模型回退（MinerU 未用或不可用）'}
                        </p>
                      ) : null}
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

                  <div ref={analysisRef} className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
                    {/* ① OCR + 原题配图 — 通栏，题图与文字左右分栏 */}
                    {(analysis.rawOcrText || resolveAnalysisImageUri(analysis, image)) && (
                      <div className="xl:col-span-2 2xl:col-span-3 bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                        <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2">
                          <BookOpen size={14} className="text-slate-500 shrink-0" />
                          <h3 className="text-sm font-semibold text-slate-800">题目原文</h3>
                        </div>
                        <div className="p-3">
                          <QuestionOriginalPanel
                            analysis={analysis}
                            fallbackImage={image}
                            mimeType={mimeType}
                            uploadFileName={uploadFileName}
                          >
                            {({ previewMaxHeightPx }) => (
                              <>
                                {analysis.circuitDescription?.trim() ? (
                                  <p className="text-[12px] text-amber-900/90 rounded border border-amber-100 bg-amber-50/50 px-2 py-1.5 leading-snug">
                                    <span className="font-medium">电路连接：</span>
                                    {analysis.circuitDescription.trim()}
                                  </p>
                                ) : null}
                                {analysis.rawOcrText ? (
                                  <EditableRecognizedExamText
                                    rawText={analysis.rawOcrText}
                                    previewMarkdown={prepareOcrMarkdown(analysis.rawOcrText, analysis, image)}
                                    onSave={handleOcrTextSave}
                                    ocrLayout={analysis.ocrLayout}
                                    onLayoutSave={handleOcrLayoutSave}
                                    saving={ocrEditSaving}
                                    previewMaxHeightPx={previewMaxHeightPx}
                                    sourceImageUri={resolveAnalysisImageUri(analysis, image)}
                                  />
                                ) : null}
                                <div className="grid gap-2 sm:grid-cols-2">
                                  <EditableOriginalAnswer
                                    kind="original"
                                    value={analysis.originalAnswer || ''}
                                    onSave={handleOriginalAnswerSave}
                                    saving={ocrEditSaving}
                                  />
                                  <EditableOriginalAnswer
                                    kind="corrected"
                                    value={analysis.correctedAnswer || ''}
                                    onSave={handleCorrectedAnswerSave}
                                    saving={ocrEditSaving}
                                  />
                                </div>
                              </>
                            )}
                          </QuestionOriginalPanel>
                        </div>
                      </div>
                    )}

                  {/* ② 题目摘要 */}
                  <div className="bg-white rounded-lg shadow-sm border border-slate-200 border-l-[3px] border-l-indigo-500 overflow-hidden flex flex-col">
                    <div className="px-3 py-2 border-b border-slate-100 shrink-0">
                      <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                        <BookOpen size={14} className="text-indigo-500 shrink-0" />
                        题目摘要
                      </h3>
                    </div>
                    <div className="px-3 py-2 flex-1 overflow-y-auto max-h-[min(280px,38vh)]">
                      <SummaryPointsList summary={analysis.summary} />
                    </div>
                  </div>

                  {/* ③ 错因定位 */}
                  <div className="bg-white rounded-lg shadow-sm border border-slate-200 border-l-[3px] border-l-amber-400 overflow-hidden flex flex-col">
                    <div className="px-3 py-2 border-b border-slate-100 shrink-0">
                      <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                        <Target size={14} className="text-amber-500 shrink-0" />
                        错因定位
                      </h3>
                    </div>
                    <div className="px-3 py-2 flex-1 overflow-y-auto max-h-[min(280px,38vh)] text-slate-800">
                      <MistakeCauseSelector
                        specificMistake={analysis.specificMistake}
                        selectedIndices={selectedCauseIndices}
                        onChange={setSelectedCauseIndices}
                        otherCause={otherCause}
                        onOtherCauseChange={setOtherCause}
                        disabled={false}
                        saveHint={causeSaveHint}
                      />
                    </div>
                  </div>

                  {/* ④ 易错点 */}
                  <div className="bg-white rounded-lg shadow-sm border border-slate-200 border-l-[3px] border-l-rose-400 overflow-hidden flex flex-col 2xl:col-span-1">
                    <div className="px-3 py-2 border-b border-slate-100 shrink-0">
                      <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                        <AlertCircle size={14} className="text-rose-500 shrink-0" />
                        易错点
                      </h3>
                    </div>
                    <div className="px-3 py-2 flex-1 overflow-y-auto max-h-[min(280px,38vh)]">
                      <ul className="space-y-1.5">
                        {analysis.pitfalls.map((pitfall, idx) => (
                          <li
                            key={`pitfall-${idx}`}
                            className="flex gap-1.5 text-[13px] leading-snug text-slate-700"
                          >
                            <span className="shrink-0 font-medium text-rose-500/70 tabular-nums">{idx + 1}.</span>
                            <span className="min-w-0 break-words">{pitfall}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* ⑤ 知识网络 — 通栏 */}
                  <div className="xl:col-span-2 2xl:col-span-3 bg-white rounded-xl shadow-sm border border-slate-200 border-l-[4px] border-l-emerald-500 overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-emerald-100 bg-emerald-50/40">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-800">⑤ 知识网络</p>
                      <h3 className="text-base font-bold text-emerald-950 mt-0.5 flex items-center gap-2">
                        <Network size={17} className="text-emerald-500 shrink-0" />
                        知识网络与结构
                        <span className="text-xs font-normal text-emerald-800/70 ml-1">
                          · {analysis.knowledgePoints.length} 考点 · {analysis.knowledgeTree.length} 组节点
                        </span>
                      </h3>
                    </div>
                    <div className="p-4 grid gap-5 lg:grid-cols-2">
                      {/* Knowledge Points */}
                      <div>
                        <h4 className="text-xs font-bold text-indigo-950 mb-3 flex items-center gap-2 pb-1.5 border-b border-indigo-100">
                          <BookOpen size={15} className="text-indigo-500 shrink-0" />
                          核心知识点
                        </h4>
                        <div className="flex flex-wrap gap-1.5">
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
                        <p className="text-[11px] text-slate-500 mt-2 flex items-center gap-1">
                          <ChevronRight size={12} className="text-indigo-500 shrink-0" />
                          点击知识点展开详细讲解
                        </p>
                      </div>

                      {/* Knowledge Tree */}
                      <div>
                        <h4 className="text-xs font-bold text-emerald-950 mb-3 flex items-center gap-2 pb-1.5 border-b border-emerald-100">
                          <Network size={15} className="text-emerald-500 shrink-0" />
                          相关知识树
                        </h4>
                        <div className="space-y-2.5 max-h-[min(320px,40vh)] overflow-y-auto pr-1">
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
                              className={`rounded-lg p-3 border transition-all duration-300 ${
                                isRelated 
                                  ? 'bg-emerald-50 border-emerald-200 ring-1 ring-emerald-100' 
                                  : 'bg-slate-50 border-slate-100'
                              } ${isDimmed ? 'opacity-40 grayscale-[50%]' : ''}`}
                            >
                              <button 
                                onClick={() => handlePointClick(node.node)}
                                className={`text-sm font-medium mb-2 flex items-center gap-2 transition-colors text-left ${
                                  selectedPoint === node.node 
                                    ? 'text-emerald-700 font-bold' 
                                    : 'text-slate-800 hover:text-emerald-600'
                                }`}
                              >
                                <div className={`w-1.5 h-1.5 rounded-full transition-all ${selectedPoint === node.node ? 'bg-emerald-600 scale-150' : 'bg-emerald-400'}`}></div>
                                {node.node}
                              </button>
                              <div className="flex flex-wrap gap-1.5 pl-3 border-l-2 border-slate-200 ml-0.5">
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

                  {/* ⑥ 思维交流与盲区检测 — 通栏 */}
                  <div className="xl:col-span-2 2xl:col-span-3 overflow-hidden rounded-xl border border-slate-200 border-l-[4px] border-l-violet-500 bg-white shadow-sm">
                    <div className="border-b border-violet-100 bg-violet-50/50 px-4 py-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-800">⑥ 思维交流</p>
                          <h3 className="mt-0.5 flex items-center gap-2 text-base font-bold text-violet-950">
                            <MessageCircle size={17} className="shrink-0 text-violet-500" />
                            自述错因 · AI 追问 · 相似题检验
                          </h3>
                        </div>
                        {reflectionMistakeId ? (
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            {reflectionSaveState === 'pending' || reflectionSaveState === 'saving' ? (
                              <span className="inline-flex items-center gap-1 text-violet-600">
                                <Loader2 size={12} className="animate-spin" />
                                保存中…
                              </span>
                            ) : reflectionSaveState === 'saved' ? (
                              <span className="text-emerald-600">已保存到云端</span>
                            ) : reflectionSaveState === 'error' ? (
                              <button
                                type="button"
                                onClick={() => void persistReflectionProgress()}
                                className="text-rose-600 hover:underline"
                              >
                                保存失败 · 重试
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => void persistReflectionProgress()}
                              className="rounded-lg border border-violet-200 bg-white px-2.5 py-1 text-xs font-medium text-violet-800 hover:bg-violet-50"
                            >
                              保存记录
                            </button>
                          </div>
                        ) : null}
                      </div>
                      <p className="mt-1 text-[11px] text-violet-800/70">编辑内容会自动同步，从错题本打开可继续填写</p>
                    </div>
                    <div className="space-y-5 p-4">
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
                </div>
              )}
            </div>

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
