import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, Image as ImageIcon, Loader2, BookOpen, AlertCircle, Network, ChevronRight, X, Target, Copy, Check, Download, Edit2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as htmlToImage from 'html-to-image';
import { analyzeQuestionImage, explainKnowledgePoint, QuestionAnalysis, KnowledgePointDetails } from './services/geminiService';
import { MarkdownRenderer } from './components/MarkdownRenderer';

export default function App() {
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
    const saved = localStorage.getItem('app_analysis');
    return saved ? JSON.parse(saved) : null;
  });
  const [error, setError] = useState<string | null>(null);

  const [selectedPoint, setSelectedPoint] = useState<string | null>(null);
  const [isExplaining, setIsExplaining] = useState(false);
  const [pointDetails, setPointDetails] = useState<KnowledgePointDetails | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [isExportingImage, setIsExportingImage] = useState(false);

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

  const clearProgress = () => {
    if (window.confirm('确定要清除当前进度并重新开始吗？')) {
      setImage(null);
      setMimeType('');
      setAnalysis(null);
      setSelectedPoint(null);
      setPointDetails(null);
      setError(null);
      localStorage.removeItem('app_image');
      localStorage.removeItem('app_mimeType');
      localStorage.removeItem('app_analysis');
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const analysisRef = useRef<HTMLDivElement>(null);

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
        const maxDim = 512; // Reduce to max 512px to prevent payload too large errors

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
          const resizedBase64 = canvas.toDataURL('image/jpeg', 0.5);
          setImage(resizedBase64);
          setMimeType('image/jpeg');
          setAnalysis(null);
          setError(null);
          setSelectedPoint(null);
          setPointDetails(null);
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
    
    try {
      // Extract base64 data without the data:image/jpeg;base64, prefix
      const base64Data = image.split(',')[1];
      const result = await analyzeQuestionImage(base64Data, mimeType);
      setAnalysis(result);
    } catch (err: any) {
      console.error(err);
      setError(`分析失败，请重试。错误信息: ${err?.message || '未知网络错误'}`);
    } finally {
      setIsAnalyzing(false);
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
    
    if (analysis.rawOcrText) {
      md += `> **📝 原始 OCR 文本：**\n> \n> ${analysis.rawOcrText.split('\n').join('\n> ')}\n\n`;
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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-indigo-100 selection:text-indigo-900">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 p-2 rounded-lg text-white">
              <BookOpen size={20} />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">AI 错题分析与知识图谱</h1>
          </div>
          {image && (
            <button
              onClick={clearProgress}
              className="text-sm font-medium text-slate-500 hover:text-rose-600 transition-colors"
            >
              清除进度
            </button>
          )}
        </div>
      </header>

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
                  <div className="flex justify-between items-center bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
                    <h2 className="text-xl font-bold text-slate-800">分析结果</h2>
                    <div className="flex items-center gap-3">
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

                  <div ref={analysisRef} className="space-y-6 bg-slate-50 p-4 -mx-4 sm:mx-0 sm:p-0">
                    {/* Raw OCR Text */}
                    {analysis.rawOcrText && (
                      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="p-5 border-b border-slate-100 bg-slate-50/50">
                          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                            <BookOpen size={18} className="text-slate-500" />
                            原始 OCR 文本
                          </h3>
                        </div>
                        <div className="p-5">
                          <p className="text-sm text-slate-600 font-mono whitespace-pre-wrap leading-relaxed">{analysis.rawOcrText}</p>
                        </div>
                      </div>
                    )}

                  {/* Summary and Specific Mistake Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Summary */}
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                      <div className="p-5 border-b border-slate-100 bg-slate-50/50">
                        <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                          <BookOpen size={18} className="text-slate-500" />
                          题目摘要
                        </h3>
                      </div>
                      <div className="p-5 text-slate-600 leading-relaxed">
                        {analysis.summary}
                      </div>
                    </div>

                    {/* Specific Mistake */}
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                      <div className="p-5 border-b border-slate-100 bg-amber-50/30">
                        <h3 className="font-semibold text-amber-900 flex items-center gap-2">
                          <Target size={18} className="text-amber-500" />
                          错因定位
                        </h3>
                      </div>
                      <div className="p-5 text-slate-700 leading-relaxed">
                        <MarkdownRenderer content={analysis.specificMistake} />
                      </div>
                    </div>
                  </div>

                  {/* Pitfalls */}
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-5 border-b border-slate-100 bg-rose-50/30">
                      <h3 className="font-semibold text-rose-900 flex items-center gap-2">
                        <AlertCircle size={18} className="text-rose-500" />
                        易错点分析
                      </h3>
                    </div>
                    <div className="p-5">
                      <ul className="space-y-3">
                        {analysis.pitfalls.map((pitfall, idx) => (
                          <li key={`pitfall-${idx}`} className="flex items-start gap-2 text-sm text-slate-700">
                            <span className="bg-rose-100 text-rose-600 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                              {idx + 1}
                            </span>
                            <span className="leading-relaxed">{pitfall}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Knowledge Network (Points + Tree) */}
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-5 border-b border-slate-100 bg-emerald-50/30">
                      <h3 className="font-semibold text-emerald-900 flex items-center gap-2">
                        <Network size={18} className="text-emerald-500" />
                        知识网络与结构
                      </h3>
                    </div>
                    <div className="p-5 space-y-8">
                      {/* Knowledge Points */}
                      <div>
                        <h4 className="text-sm font-semibold text-indigo-900 mb-3 flex items-center gap-2">
                          <BookOpen size={16} className="text-indigo-500" />
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
                        <p className="text-xs text-slate-400 mt-4 flex items-center gap-1">
                          <ChevronRight size={14} /> 点击知识点查看详细讲解与例题
                        </p>
                      </div>

                      {/* Knowledge Tree */}
                      <div className="border-t border-slate-100 pt-6">
                        <h4 className="text-sm font-semibold text-emerald-900 mb-4 flex items-center gap-2">
                          <Network size={16} className="text-emerald-500" />
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
                      <div className="space-y-8">
                        <section>
                          <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2 border-b border-slate-100 pb-2">
                            <span className="bg-indigo-100 text-indigo-700 w-6 h-6 rounded flex items-center justify-center text-sm">1</span>
                            知识点讲解
                          </h3>
                          <div className="bg-slate-50 rounded-xl p-5 border border-slate-100">
                            <MarkdownRenderer content={pointDetails.explanation} />
                          </div>
                        </section>

                        <section>
                          <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2 border-b border-slate-100 pb-2">
                            <span className="bg-emerald-100 text-emerald-700 w-6 h-6 rounded flex items-center justify-center text-sm">2</span>
                            相关例题
                          </h3>
                          <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
                            <MarkdownRenderer content={pointDetails.exampleQuestion} />
                          </div>
                        </section>

                        <section>
                          <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2 border-b border-slate-100 pb-2">
                            <span className="bg-amber-100 text-amber-700 w-6 h-6 rounded flex items-center justify-center text-sm">3</span>
                            例题解析
                          </h3>
                          <div className="bg-slate-800 text-slate-100 rounded-xl p-5 shadow-inner">
                            <MarkdownRenderer content={pointDetails.exampleSolution} className="prose-invert" />
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
