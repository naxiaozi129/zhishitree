import { randomUUID } from 'node:crypto';
import {
  enrichMatchesWithReasons,
  matchLabelsToScienceTree,
  matchTextToScienceTree,
  mergeScienceMatches,
} from './scienceTreeMatch.js';
import { analyzeQuestionExamPoints } from './paperAnalyzeGemini.js';
import { stripExamBoilerplate } from './examBoilerplate.js';
import { splitExamPaperHeuristic, heuristicSplitLooksBroken, refineQuestionSplit } from './importPaper.js';
import { splitExamPaperGemini } from './paperSplitGemini.js';
import { splitQuestionAndAnswer } from './examContentSplit.js';
import { bulkCreateQuestions } from './db.js';
import type { ResolvedAiConfig } from './aiModelConfig.js';
import { attachImagesToBody } from './questionImages.js';
import type { QuestionImageRef } from './questionYaml.js';

export type PaperIngestOptions = {
  text: string;
  paperTitle?: string | null;
  defaultSubject?: string | null;
  useAiSplit?: boolean;
  analyzeWithAi?: boolean;
  createdBy: number;
  sourceRelPath?: string | null;
  apiKey: string;
  modelId?: string;
  aiConfig?: Pick<ResolvedAiConfig, 'apiKey' | 'modelId' | 'provider' | 'baseUrl'>;
  imagePool?: Record<string, QuestionImageRef>;
};

export type PaperIngestResult = {
  ok: true;
  batchKey: string;
  splitMethod: 'heuristic' | 'gemini' | 'heuristic_fallback';
  count: number;
  ids: number[];
  preview: Array<{
    title: string | null;
    stem: string;
    examPoints: string[];
    tagLabels: string[];
    scienceNodeIds: string[];
    scienceMatchPreview: ReturnType<typeof enrichMatchesWithReasons>;
  }>;
};

export async function ingestPaperTextToPending(opts: PaperIngestOptions): Promise<PaperIngestResult> {
  const text = stripExamBoilerplate(opts.text.trim());
  if (!text) throw new Error('试卷正文为空（或仅含卷头/注意事项，无有效试题）');

  const paperTitle = opts.paperTitle?.trim().slice(0, 200) || null;
  const defaultSubject = opts.defaultSubject?.trim().slice(0, 80) || null;
  const analyzeWithAi = opts.analyzeWithAi !== false;
  const aiCfg: Pick<ResolvedAiConfig, 'apiKey' | 'modelId' | 'provider' | 'baseUrl'> =
    opts.aiConfig ?? {
      apiKey: opts.apiKey.trim(),
      modelId: opts.modelId || 'gemini-2.0-flash',
      provider: 'gemini',
      baseUrl: null,
    };
  const apiKey = aiCfg.apiKey;

  if (analyzeWithAi && !apiKey) {
    throw new Error('未配置 AI 模型 API，无法进行考点 AI 标注');
  }

  const preferAiSplit = opts.useAiSplit !== false && Boolean(apiKey);
  const forceAiOnly = opts.useAiSplit === true && Boolean(apiKey);

  let splitMethod: 'heuristic' | 'gemini' | 'heuristic_fallback' = 'heuristic';
  let splitItems = refineQuestionSplit(text, splitExamPaperHeuristic(text));

  const tryGeminiSplit = async (): Promise<boolean> => {
    if (!apiKey) return false;
    try {
      const geminiItems = await splitExamPaperGemini(apiKey, text, aiCfg.modelId, aiCfg);
      splitItems = refineQuestionSplit(text, geminiItems);
      splitMethod = 'gemini';
      return true;
    } catch {
      if (forceAiOnly) {
        splitItems = refineQuestionSplit(text, splitExamPaperHeuristic(text));
        splitMethod = 'heuristic_fallback';
      }
      return false;
    }
  };

  if (preferAiSplit && heuristicSplitLooksBroken(splitItems, text)) {
    if (!apiKey) throw new Error('未配置 AI 模型 API，无法使用 AI 拆题');
    const ok = await tryGeminiSplit();
    if (!ok && forceAiOnly) {
      throw new Error('AI 拆题失败，请检查模型 API 配置或稍后重试');
    }
  } else if (!preferAiSplit && apiKey && heuristicSplitLooksBroken(splitItems, text)) {
    await tryGeminiSplit();
  }

  if (
    (splitMethod === 'heuristic' || splitMethod === 'heuristic_fallback') &&
    heuristicSplitLooksBroken(splitItems, text)
  ) {
    throw new Error(
      '规则拆题结果异常（可能把表格数字误当成题号）。请勾选「AI 拆题」后重新导入，或检查试卷正文格式。',
    );
  }

  const batchKey = `paper_${randomUUID()}`;
  const prepared: Parameters<typeof bulkCreateQuestions>[0] = [];
  const preview: PaperIngestResult['preview'] = [];

  for (let i = 0; i < splitItems.length; i++) {
    const it = splitItems[i];
    const stemRaw = it.stem.trim();
    if (!stemRaw) continue;

    const { question, answer } = splitQuestionAndAnswer(stemRaw);
    const stemTrim = question;
    const imageAttach = opts.imagePool ? attachImagesToBody(stemTrim, opts.imagePool) : { stem: stemTrim, images: [] as QuestionImageRef[] };
    const stemForStore = imageAttach.stem;

    let examPoints: string[] = [];
    let tagLabels: string[] = [];
    let brief: string | undefined;

    if (analyzeWithAi && apiKey) {
      try {
        const ai = await analyzeQuestionExamPoints(apiKey, stemForStore, defaultSubject, aiCfg.modelId, aiCfg);
        examPoints = ai.examPoints;
        tagLabels = ai.tagLabels;
        brief = ai.brief;
      } catch {
        examPoints = ['（AI 考点分析失败，请人工核对）'];
        tagLabels = [];
      }
    }

    const blob = [stemForStore, ...examPoints, ...tagLabels, brief ?? ''].join('\n');
    const fromText = matchTextToScienceTree(blob, 48);
    const fromLabels = tagLabels.length ? matchLabelsToScienceTree(tagLabels) : [];
    const merged = mergeScienceMatches([fromText, fromLabels]);
    const enriched = enrichMatchesWithReasons(blob, merged.filter((m) => m.score >= 28)).slice(0, 14);
    const scienceNodeIds = enriched.map((m) => m.id);

    const body: Record<string, unknown> = {
      ...it.body,
      paperBatchKey: batchKey,
      paperTitle,
      sourceRelPath: opts.sourceRelPath ?? null,
      answerText: answer,
      examPoints,
      tagLabels,
      briefReason: brief ?? null,
      scienceNodeIds,
      scienceMatchPreview: enriched.map((m) => ({
        id: m.id,
        label: m.label,
        path: m.path,
        score: m.score,
        reasons: m.reasons,
      })),
      reviewStatus: 'pending',
      splitMethod,
      analyzedAt: new Date().toISOString(),
    };
    if (imageAttach.images.length) body.images = imageAttach.images;

    prepared.push({
      title: it.title,
      stem: stemForStore,
      body,
      subject: defaultSubject,
      difficulty: null,
      createdBy: opts.createdBy,
      status: 'pending',
      source: 'import',
    });

    preview.push({
      title: it.title,
      stem: stemForStore.length > 500 ? `${stemForStore.slice(0, 500)}…` : stemForStore,
      examPoints,
      tagLabels,
      scienceNodeIds,
      scienceMatchPreview: enriched.slice(0, 8),
    });
  }

  if (prepared.length === 0) throw new Error('未解析出任何有效题目（题干为空）');

  const ids = bulkCreateQuestions(prepared);
  return { ok: true, batchKey, splitMethod, count: ids.length, ids, preview };
}
