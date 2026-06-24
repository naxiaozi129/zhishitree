import { Type } from '@google/genai';
import type { AiProvider, ResolvedAiConfig } from './aiModelConfig.js';
import { createGeminiClient, runWithGeminiNetwork } from './geminiClient.js';
import {
  normalizeModelId,
  resolveGeminiCredentials,
  resolveOcrCredentials,
  resolveOpenAiCompatibleBaseUrl,
  resolveZhipuVisionModelCandidates,
  ZHIPU_DEFAULT_BASE_URL,
  ZHIPU_VISION_MODEL_DEFAULT,
} from './aiModelConfig.js';
import { chatCompletionsUrl, extractOpenAiResponseText } from './llmOpenAiCompat.js';
import { generateLlmText } from './llmGenerate.js';
import { isMineruOcrEnabled } from './mineruOcr.js';
import { isMineruFallbackVisionEnabled, isOcrLlmCorrectEnabled } from './mineruSettings.js';
import {
  embedAnalysisFigurePlaceholders,
  postprocessMineruMarkdown,
} from './examFigureExtract.js';
import {
  applyExamPaperRecognitionPipeline,
  recognizeExamPaperImage,
  examPaperOcrMetaForVisionFallback,
  EXAM_PAPER_RECOGNITION_SKILL_ID,
  type ExamPaperOcrMeta,
} from './examPaperRecognition.js';
import {
  postprocessExamStemOcr,
  recognizeExamViaService,
} from './examRecognitionService.js';
import {
  blankHandwritingInStemOcr,
  isGarbageHandwritingText,
  preprocessImageForRedHandwriting,
  preprocessImageForStemOcr,
  isStemOverShrunk,
  postProcessHandwrittenPair,
  supplementBlackWrongFill,
  supplementBlackDirectionFill,
  supplementRedCorrectionFill,
  supplementRedDerivationFill,
  sanitizeHandwrittenAnswers,
  stripHandwritingFromOcrText,
} from './examImageInkPreprocess.js';
import { extractExamTextFromBuffer } from './paperFileExtract.js';

function isPdfMime(mimeType: string): boolean {
  return (mimeType || '').toLowerCase().includes('pdf');
}

/** 识别引擎：default=网页内置（MinerU/视觉），exam-service=8080 能力中心全流程 */
export type OcrEngine = 'default' | 'exam-service';

export type QuestionFigure = {
  id: string;
  label: string;
  mime: string;
  /** base64 正文（不含 data: 前缀） */
  data: string;
  note?: string;
  /** MinerU / 8080 返回的原始文件名，用于在 markdown 中匹配图片引用 */
  name?: string;
};

export type QuestionAnalysis = {
  rawOcrText: string;
  knowledgePoints: string[];
  pitfalls: string[];
  knowledgeTree: { node: string; children: string[] }[];
  summary: string;
  specificMistake: string;
  /** 原题上学生黑色手写答案（原始作答） */
  originalAnswer?: string;
  /** 红色笔迹批改/订正后的正确答案 */
  correctedAnswer?: string;
  /** 原题完整截图，便于对照表格/电路图 */
  sourceImage?: { mime: string; data: string };
  /** 无法纯文字表达的配图（电路图等） */
  figures?: QuestionFigure[];
  /** 电路连接关系文字描述（可选） */
  circuitDescription?: string;
  /** exam-paper-recognition 流水线元数据（便于确认识别路径） */
  ocrMeta?: ExamPaperOcrMeta;
  /** 识别预览排版：块顺序、字号、配图宽度 */
  ocrLayout?: {
    v: 1;
    order?: string[];
    styles: Record<string, { widthPct?: number; fontScale?: number; marginTop?: number; align?: string }>;
  };
};

export type { ExamPaperOcrMeta } from './examPaperRecognition.js';

export type KnowledgePointDetails = {
  explanation: string;
  exampleQuestion: string;
  exampleSolution: string;
};

const SCIENCE_KNOWLEDGE_AREAS = [
  '物理-电学',
  '物理-力学',
  '物理-光学',
  '物理-热学',
  '化学-物质构成',
  '化学-化学反应',
  '生物-细胞与生命',
  '生物-生态系统',
  '科学探究方法',
] as const;

const QUESTION_ANALYSIS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    rawOcrText: { type: Type.STRING, description: '与 OCR 输入一致的题目原文' },
    knowledgePoints: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '考察知识点列表',
    },
    pitfalls: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '本题具体易错陷阱（挂钩题干/选项/数据，非泛泛知识点）',
    },
    knowledgeTree: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          node: { type: Type.STRING, description: '初中科学知识大类' },
          children: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: '子知识点',
          },
        },
        required: ['node', 'children'],
      },
    },
    summary: {
      type: Type.STRING,
      description: '题目摘要：核心信息 + 作答要求 + 审题要诀（分条，换行分隔）',
    },
    specificMistake: {
      type: Type.STRING,
      description: '错因定位：从学生错答出发反推可能原因（Markdown）',
    },
    circuitDescription: {
      type: Type.STRING,
      description: '电路连接简述，无则空字符串',
    },
  },
  required: ['rawOcrText', 'knowledgePoints', 'pitfalls', 'knowledgeTree', 'summary', 'specificMistake'],
};

function buildOcrJsonPrompt(): string {
  return `${buildOcrPrompt()}

请将转录结果输出为一个 JSON 对象（不要代码块），仅含键：
- rawOcrText：完整转录正文（含 Markdown 表格）
- circuitDescription：电路连接简述，无则 ""`;
}

/** 智谱视觉模型 max_tokens 上限（glm-4v-flash 等为 1024；glm-4.6v 等可能更高） */
function zhipuVisionMaxTokens(modelId: string): number {
  const env = Number(process.env.ZHIPU_VISION_MAX_TOKENS || 0);
  if (env > 0) return Math.min(env, 8192);
  if (/glm-4\.6v|glm-4\.5v|4v-plus/i.test(modelId)) return 4096;
  return 1024;
}

const OCR_ONLY_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    rawOcrText: {
      type: Type.STRING,
      description: '图片中全部文字的逐字转录，含 Markdown 表格',
    },
    circuitDescription: {
      type: Type.STRING,
      description: '若有电路图，简述元件连接；否则空字符串',
    },
  },
  required: ['rawOcrText'],
};

function scoreOcrQuality(text: string): number {
  if (!text.trim() || isOcrRefusal(text)) return 0;
  let s = text.trim().length;
  if (/\|[^|\n]+\|/.test(text)) s += 800;
  if (/【[^】]+】/.test(text)) s += 120;
  if (/Ω|0\.\d+\s*A|滑动变阻|电压表|电流表/i.test(text)) s += 200;
  if (/实验组别|电阻R|电流I/i.test(text)) s += 300;
  return s;
}

function pickBetterOcr(a: string, b: string): string {
  return scoreOcrQuality(b) > scoreOcrQuality(a) ? b : a;
}

function isOcrRefusal(text: string): boolean {
  return /无法直接处理图片|不能处理图片|无法识别图片|无法.*处理.*图|请提供.*文字内容|请以文本形式描述|不支持.*图片|cannot process.*image|can't process.*image/i.test(
    text,
  );
}

function buildHandwrittenAnswersPrompt(): string {
  return `【任务】仅转录题目图片中的**手写作答**（用笔写的笔迹），按颜色分为 black / red 两栏。

【先排除印刷体（必做）】
- 试卷/书本印刷的题干、题号、选项文字、表头 → **一律不抄写**
- 印刷体特征：字体统一、墨色均匀、与版面对齐；手写字迹笔画粗细不一、有连笔或涂改
- 黑色手写可能与印刷体相邻（填空横线旁、括号内、表格空格内），仍属 black

【颜色含义 — 务必按墨水颜色分栏，不可猜】
- **black（黑色笔迹）**：学生最初用黑笔写下的内容；**被划掉/涂改的黑笔填答仍属 black**（如划掉的 5，写「5（划掉）」）
- **red（红色笔迹）**：红笔事后批改/订正；填空旁红笔改写的数字（如把 5 改成 2，则 black=5（划掉），red=2）
- 同一位置既有黑笔划掉又有红笔改写时，**禁止把红笔内容放进 black**

【常见题型】
- 填空订正：black 抄被划掉的黑笔原答 + 未改动的填答；red 抄红笔改正（仅红墨水写的部分）
- 选择题：black 抄学生圈选；red 抄红笔改正选项
- 计算题：black 抄黑色草稿；red 抄红笔订正（勿与 black 重复）

【输出】只输出一个 JSON 对象，不要 Markdown 代码块，不要其他文字：
{"black":"黑色手写内容","red":"红色手写内容"}
- 没有某颜色笔迹时，对应键值为空字符串 ""
- 多条内容用中文分号「；」分隔（JSON 字符串内不要换行）
- 看不清用 [?]`;
}

/** 红笔掩膜图 / 原图：专用于提取红色批改笔迹 */
function buildRedHandwrittenOnlyPrompt(): string {
  return `【任务】本图突出显示**红色墨水**手写作答，请**仅**转录红色笔迹。

【必排除】
- 黑色笔迹（含被划掉的黑笔数字）、印刷体题干与选项

【要抄写】
- 红笔在填空/括号旁改写的**数字或符号**（如 2、12N）
- 红笔批注、改错、订正后的选项
- **不要抄**「水平向左/水平向右」等方向词（那些通常是黑笔填答，除非明显为红墨水所写）
- 仅有红勾/红叉/红线无文字时写「（红色勾画标记）」

【输出】只输出 JSON：
{"red":"红色手写内容"}
无红色手写时 {"red":""}`;
}

/** 红笔已去除的净化图：专用于补提黑色手写（避免红笔干扰、漏识黑笔） */
function buildBlackHandwrittenOnlyPrompt(): string {
  return `【任务】本图已去除红/蓝批改笔迹，请**仅**转录图中剩余的**黑色手写作答**。

【必排除】
- 印刷体题干、题号、选项、表头、图中标注字母（如 A、B、M）——即使与手写相邻也不要抄
- 涂改、潦草难辨的草稿行；中英符号混杂的乱码（如含 #、?、孤立大写字母的行）

【要抄写】
- 横线/括号/表格空格内学生用黑笔填入的数值、文字、选项（如 5（划掉）、水平向左、B）
- **填空横线上被划掉的黑笔数字**（如先写5又划掉）必须抄为「5（划掉）」；红笔订正数字（如2）不要抄入黑栏
- **被划掉的黑笔填答必须抄写**，在数字或文字后加「（划掉）」
- 按题序用「；」分隔；每条尽量短（一般不超过 20 字）

【输出】只输出 JSON，不要其他文字：
{"black":"黑色手写内容"}
无黑色手写或无法辨认时输出 {"black":""}`;
}

/** 从模型输出中宽松提取 black/red（兼容 JSON 内未转义换行等） */
function extractHandwrittenJsonFields(text: string): { black: string; red: string } | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const obj = extractJsonObject(trimmed);
  if (obj) {
    try {
      const parsed = JSON.parse(obj) as { black?: string; red?: string; blackAnswer?: string; redAnswer?: string };
      return {
        black: String(parsed.black ?? parsed.blackAnswer ?? '').trim(),
        red: String(parsed.red ?? parsed.redAnswer ?? '').trim(),
      };
    } catch {
      // fall through to regex
    }
  }
  const pick = (key: 'black' | 'red'): string => {
    const re = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 's');
    const m = trimmed.match(re);
    if (m) return m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();
    const loose = new RegExp(`"${key}"\\s*:\\s*"([\\s\\S]*?)"\\s*,\\s*"(?:red|black)"`, 's');
    const m2 = trimmed.match(loose);
    if (m2) return m2[1].replace(/\\n/g, '\n').trim();
    return '';
  };
  const black = pick('black');
  const red = pick('red');
  if (!black && !red) return null;
  return { black, red };
}

function formatHandwrittenList(text: string): string {
  return text
    .replace(/；/g, '\n')
    .replace(/;\s*/g, '\n')
    .trim();
}

function normalizeHandwrittenField(text: string, color: 'black' | 'red'): string {
  const t = text.trim().replace(/^```[\w]*\n?|```$/g, '').trim();
  if (!t || t === '无' || /^(无|没有|未发现|未识别到).{0,12}(手写|笔迹|作答|批改)/i.test(t)) return '';
  const prefixes =
    color === 'black'
      ? [/^(学生)?(原始)?手写答案[：:\s]*/i, /^黑色[笔迹答案作答]*[：:\s]*/i]
      : [/^(批改|订正|红色)[笔迹答案作答]*[：:\s]*/i, /^red[：:\s]*/i];
  let out = t;
  for (const re of prefixes) out = out.replace(re, '').trim();
  return out;
}

function parseHandwrittenAnswersResponse(text: string): { originalAnswer: string; correctedAnswer: string } {
  const trimmed = text.trim();
  const fields = extractHandwrittenJsonFields(trimmed);
  if (fields) {
    return {
      originalAnswer: formatHandwrittenList(normalizeHandwrittenField(fields.black, 'black')),
      correctedAnswer: formatHandwrittenList(normalizeHandwrittenField(fields.red, 'red')),
    };
  }
  // 兼容旧版纯文本（仅黑色）
  return {
    originalAnswer: formatHandwrittenList(normalizeHandwrittenField(trimmed, 'black')),
    correctedAnswer: '',
  };
}

/** 调用视觉模型转录手写（单次） */
async function callHandwrittenVisionOnce(
  ocrCfg: Pick<ResolvedAiConfig, 'apiKey' | 'modelId' | 'provider' | 'baseUrl'>,
  base64: string,
  mimeType: string,
  prompt: string,
  modelIdHint?: string,
): Promise<string> {
  if (ocrCfg.provider === 'gemini') {
    return generateGeminiVisionPlainText(ocrCfg, base64, mimeType, prompt);
  }
  if (ocrCfg.provider === 'zhipu') {
    const envHw = process.env.ZHIPU_HANDWRITTEN_MODEL?.trim();
    const candidates = modelIdHint
      ? [modelIdHint]
      : envHw
        ? [normalizeModelId('zhipu', envHw)]
        : resolveZhipuVisionModelCandidates(ocrCfg.modelId).slice(0, 2);
    let lastErr = '';
    for (const modelId of candidates) {
      if (!modelId) continue;
      try {
        return await callZhipuVisionOnce(ocrCfg, base64, mimeType, prompt, modelId);
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        if (/余额不足|无可用资源包|请充值/i.test(lastErr)) throw e;
      }
    }
    throw new Error(lastErr || '智谱视觉手写识别失败');
  }
  const geminiBoost = resolveGeminiCredentials();
  if (geminiBoost?.apiKey && process.env.AI_OCR_USE_GEMINI !== '0') {
    try {
      return await generateGeminiVisionPlainText(geminiBoost, base64, mimeType, prompt);
    } catch (e) {
      if (isGeminiProxyError(e)) {
        return generateGeminiVisionPlainTextDirect(geminiBoost, base64, mimeType, prompt);
      }
      throw e;
    }
  }
  throw new Error('当前 AI 提供商不支持手写识别');
}

function resolveHandwrittenVisionModelCandidates(configuredModelId: string): string[] {
  const envHw = process.env.ZHIPU_HANDWRITTEN_MODEL?.trim();
  if (envHw) return [normalizeModelId('zhipu', envHw)];
  const pool = resolveZhipuVisionModelCandidates(configuredModelId);
  const preferred = ['glm-4.6v', 'glm-4v-flash', 'glm-4v-plus'];
  const out: string[] = [];
  for (const id of preferred) {
    const n = normalizeModelId('zhipu', id);
    if (pool.includes(n) && !out.includes(n)) out.push(n);
  }
  for (const id of pool) if (!out.includes(id)) out.push(id);
  return out.slice(0, 3);
}

function isHandwritingNoiseRecoveryEnabled(): boolean {
  return process.env.AI_HW_RECOVER_FROM_NOISE === '1';
}

function isSplitColorHandwritingEnabled(): boolean {
  return process.env.AI_HANDWRITTEN_SPLIT_COLOR !== '0' && process.env.EXAM_INK_PREPROCESS !== '0';
}

async function callHandwrittenVisionBest(
  ocrCfg: Pick<ResolvedAiConfig, 'apiKey' | 'modelId' | 'provider' | 'baseUrl'>,
  base64: string,
  mimeType: string,
  prompt: string,
): Promise<string> {
  if (ocrCfg.provider === 'zhipu') {
    const candidates = resolveHandwrittenVisionModelCandidates(ocrCfg.modelId);
    let balanceExhausted = false;
    let lastErr = '';
    for (const modelId of candidates) {
      if (!modelId) continue;
      if (balanceExhausted && /4v-plus/i.test(modelId)) continue;
      try {
        return await callZhipuVisionOnce(ocrCfg, base64, mimeType, prompt, modelId);
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        if (/余额不足|无可用资源包|请充值/i.test(lastErr)) balanceExhausted = true;
      }
    }
    if (lastErr) throw new Error(lastErr);
  }
  return callHandwrittenVisionOnce(ocrCfg, base64, mimeType, prompt);
}

function parseBlackHandwrittenResponse(text: string): string {
  if (isOcrRefusal(text)) return '';
  const fields = extractHandwrittenJsonFields(text);
  const raw = fields ? fields.black : text;
  const formatted = formatHandwrittenList(normalizeHandwrittenField(raw, 'black'));
  return isGarbageHandwritingText(formatted) ? '' : formatted;
}

function parseRedHandwrittenResponse(text: string): string {
  if (isOcrRefusal(text)) return '';
  const fields = extractHandwrittenJsonFields(text);
  const raw = fields ? fields.red : text;
  const formatted = formatHandwrittenList(normalizeHandwrittenField(raw, 'red'));
  return isGarbageHandwritingText(formatted) ? '' : formatted;
}

/** 分色图双通道：净化图提黑笔，红墨掩膜图提红笔 */
async function extractHandwrittenAnswersSplitColor(
  ocrCfg: Pick<ResolvedAiConfig, 'apiKey' | 'modelId' | 'provider' | 'baseUrl'>,
  base64: string,
  mimeType: string,
): Promise<{ originalAnswer: string; correctedAnswer: string } | null> {
  const raw = stripBase64Prefix(base64);
  const [stem, redMask] = await Promise.all([
    preprocessImageForStemOcr(base64, mimeType),
    preprocessImageForRedHandwriting(base64, mimeType),
  ]);
  if (!stem && !redMask) return null;

  const blackPrompt = buildBlackHandwrittenOnlyPrompt();
  const redPrompt = buildRedHandwrittenOnlyPrompt();

  const [blackText, redFromMask, redFromOriginal] = await Promise.all([
    stem
      ? callHandwrittenVisionBest(ocrCfg, stem.base64, stem.mimeType, blackPrompt).catch(() => '')
      : Promise.resolve(''),
    redMask
      ? callHandwrittenVisionBest(ocrCfg, redMask.base64, redMask.mimeType, redPrompt).catch(() => '')
      : Promise.resolve(''),
    callHandwrittenVisionBest(ocrCfg, raw, mimeType, redPrompt).catch(() => ''),
  ]);

  let originalAnswer = parseBlackHandwrittenResponse(blackText);
  let correctedAnswer =
    parseRedHandwrittenResponse(redFromMask) || parseRedHandwrittenResponse(redFromOriginal);

  if (!originalAnswer && stem) {
    try {
      const text = await callHandwrittenVisionBest(ocrCfg, raw, mimeType, blackPrompt);
      originalAnswer = parseBlackHandwrittenResponse(text);
    } catch {
      // ignore
    }
  }

  if (!originalAnswer && !correctedAnswer) return null;

  const merged = postProcessHandwrittenPair(originalAnswer, correctedAnswer);
  console.log(
    `[zhishitree] 分色手写识别 black=${merged.originalAnswer.length} red=${merged.correctedAnswer.length}` +
      ` (stem=${stem?.stats.redPixels ?? 0}px红已掩膜)`,
  );
  return sanitizeHandwrittenAnswers(merged);
}

/** 视觉模型按颜色识别手写答案：黑=原始作答，红=批改正确答案 */
async function extractHandwrittenAnswers(
  ocrCfg: Pick<ResolvedAiConfig, 'apiKey' | 'modelId' | 'provider' | 'baseUrl'>,
  base64: string,
  mimeType: string,
): Promise<{ originalAnswer: string; correctedAnswer: string }> {
  if (process.env.AI_HANDWRITTEN_ANSWER === '0') return { originalAnswer: '', correctedAnswer: '' };
  const prompt = buildHandwrittenAnswersPrompt();
  const raw = stripBase64Prefix(base64);
  const empty = { originalAnswer: '', correctedAnswer: '' };

  const apply = (text: string, modelId?: string) => {
    if (isOcrRefusal(text)) return empty;
    const parsed = sanitizeHandwrittenAnswers(parseHandwrittenAnswersResponse(text));
    if (parsed.originalAnswer || parsed.correctedAnswer) {
      console.log(
        `[zhishitree] 手写答案识别成功${modelId ? ` (${modelId})` : ''} black=${parsed.originalAnswer.length} red=${parsed.correctedAnswer.length}`,
      );
    }
    return parsed;
  };

  try {
    if (isSplitColorHandwritingEnabled()) {
      const split = await extractHandwrittenAnswersSplitColor(ocrCfg, base64, mimeType);
      if (split?.originalAnswer || split?.correctedAnswer) {
        return split;
      }
      console.warn('[zhishitree] 分色手写识别无结果，回退双色合图识别');
    }

    let result = empty;

    if (ocrCfg.provider === 'zhipu') {
      const candidates = resolveHandwrittenVisionModelCandidates(ocrCfg.modelId);
      let balanceExhausted = false;
      for (const modelId of candidates) {
        if (!modelId) continue;
        if (balanceExhausted && /4v-plus/i.test(modelId)) continue;
        try {
          const text = await callZhipuVisionOnce(ocrCfg, raw, mimeType, prompt, modelId);
          result = apply(text, modelId);
          if (result.originalAnswer || result.correctedAnswer) break;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[zhishitree] 手写答案识别失败 (${modelId}):`, e);
          if (/余额不足|无可用资源包|请充值/i.test(msg)) balanceExhausted = true;
        }
      }
      if (balanceExhausted) {
        console.warn('[zhishitree] 智谱视觉模型余额不足，跳过付费回退模型');
      }
    } else {
      try {
        const text = await callHandwrittenVisionOnce(ocrCfg, raw, mimeType, prompt);
        result = apply(text);
      } catch (e) {
        console.warn('[zhishitree] 手写答案识别失败:', e);
      }
    }

    if (!result.originalAnswer && !result.correctedAnswer) {
      const geminiBoost = resolveGeminiCredentials();
      if (geminiBoost?.apiKey && process.env.AI_OCR_USE_GEMINI !== '0' && ocrCfg.provider !== 'gemini') {
        try {
          const text = await generateGeminiVisionPlainText(geminiBoost, raw, mimeType, prompt);
          result = apply(text);
        } catch (e) {
          if (isGeminiProxyError(e)) {
            const text = await generateGeminiVisionPlainTextDirect(geminiBoost, raw, mimeType, prompt);
            result = apply(text);
          }
        }
      }
    }

    // 黑笔漏识：在红笔已去除的净化图上补提一次
    if (!result.originalAnswer.trim()) {
      const stem = await preprocessImageForStemOcr(base64, mimeType);
      if (stem && (stem.stats.redPixels > 0 || stem.stats.bluePixels > 0)) {
        try {
          const blackPrompt = buildBlackHandwrittenOnlyPrompt();
          const text = await callHandwrittenVisionOnce(
            ocrCfg,
            stem.base64,
            stem.mimeType,
            blackPrompt,
          );
          const fields = extractHandwrittenJsonFields(text);
          const black = fields
            ? formatHandwrittenList(normalizeHandwrittenField(fields.black, 'black'))
            : formatHandwrittenList(normalizeHandwrittenField(text, 'black'));
          if (black.trim() && !isGarbageHandwritingText(black)) {
            console.log(`[zhishitree] 黑笔补提成功（净化图）len=${black.length}`);
            result = { ...result, originalAnswer: black };
          } else if (black.trim()) {
            console.warn('[zhishitree] 黑笔补提结果为 OCR 乱码，已丢弃');
          }
        } catch (e) {
          console.warn('[zhishitree] 黑笔补提失败:', e instanceof Error ? e.message : e);
        }
      }
    }

    return sanitizeHandwrittenAnswers(postProcessHandwrittenPair(result.originalAnswer, result.correctedAnswer));
  } catch (e) {
    console.warn('[zhishitree] 手写答案识别失败:', e);
  }
  return empty;
}

function geminiErrorMessage(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const parts = [e.message];
  let cur: unknown = e.cause;
  for (let i = 0; i < 3 && cur; i++) {
    parts.push(cur instanceof Error ? cur.message : String(cur));
    cur = cur instanceof Error ? cur.cause : undefined;
  }
  return parts.join(' | ');
}

function isGeminiProxyError(e: unknown): boolean {
  return /ECONNREFUSED|proxy|7890/i.test(geminiErrorMessage(e));
}

function buildOcrPrompt(): string {
  return `【任务】读取用户上传的题目图片，逐字转录图中全部文字。

你是高精度 OCR 引擎。请**仅逐字转录**图片中的全部文字，不要分析、不要改写、不要编造。

硬性要求：
1. 题号、地区标注（如【金华】）、标点、括号原样保留。
2. 物理单位与符号准确：Ω（欧姆）、A（安培）、V（伏特）、W（瓦特）勿混淆；数字勿改（如 0.6 不可写成 0.5）。
3. 「电流与电阻」「电流与电压」等术语勿混淆，以图片为准。
4. **表格（必做）**：若图中有表格，必须用 Markdown 表格完整输出，**每一行、每一列、表头均不可省略**，例如：
| 实验组别 | 1 | 2 | 3 |
| --- | --- | --- | --- |
| 电阻R/Ω | 5 | 10 | 20 |
| 电流I/A | 0.4 | 0.2 | 0.1 |
5. **电路图/示意图**：先尽量用文字描述连接关系（如「电源、开关S、电流表A、定值电阻R、滑动变阻器串联；电压表V并联在R两端」）；若无法准确还原拓扑，在转录末尾单独一行写：[电路图见原题配图]
6. 滑动变阻器规格、电表量程、定值电阻阻值等参数必须与原图一致。
7. 看不清的字用 [?] 标注，禁止猜测。
8. **选择题**：题干与选项分开；每个选项（A. B. C. D. 等）单独占一行，选项之间空一行。

直接输出转录正文，不要 JSON，不要 Markdown 代码块，不要加「以下是」等前缀。`;
}

function buildAnalysisFromTextPrompt(
  ocrText: string,
  handwritten?: { originalAnswer?: string; correctedAnswer?: string },
): string {
  const clipped =
    ocrText.length > 6000 ? `${ocrText.slice(0, 6000)}\n…（OCR 已截断，完整原文由系统保留）` : ocrText;
  const blocks: string[] = [];
  if (handwritten?.originalAnswer?.trim()) {
    blocks.push(
      `【学生原始作答（黑色笔迹）】学生最初做题时写下的答案，错因分析应主要对照此项：\n${handwritten.originalAnswer.trim()}`,
    );
  }
  if (handwritten?.correctedAnswer?.trim()) {
    blocks.push(
      `【批改正确答案（红色笔迹）】事后用红笔标注的订正/正确答案，可与黑色原始作答对比：\n${handwritten.correctedAnswer.trim()}`,
    );
  }
  const handBlock = blocks.length ? `\n${blocks.join('\n\n')}\n` : '';
  const hasBothAnswers =
    Boolean(handwritten?.originalAnswer?.trim()) && Boolean(handwritten?.correctedAnswer?.trim());
  const hasAnyAnswer = blocks.length > 0;
  const handHint = hasAnyAnswer
    ? hasBothAnswers
      ? `
**错因定位（specificMistake）必须从学生错答出发反推**，按以下 Markdown 结构输出（保留 **作答对比** 标题，错因用 \`- \` 列表，**不要再写「可能的原因」标题**）：
1. **作答对比**：一句话点明原始作答 vs 批改答案的差异（如「选 C，正确为 A」），并说明正确选项依据题干/选项哪一点。
2. 以错答为起点，分条列出 2～4 条**可能原因**（用 \`- \` 列表）：每条只写一种可能的思维误区或知识盲区（一句话说清，可点明对应题干/选项依据）；**不要写「错答表现」「答错表现」等前缀**，界面会显示为「可能原因是：」供学生勾选。
`
      : `
**错因定位（specificMistake）须从上方手写错答出发反推**，Markdown 输出：**作答对比**（若有）+ 2～4 条 \`- \` 可能原因（每条一句话、勿写「错答表现」前缀，**不要写「可能的原因」标题**）。
`
    : `
**错因定位（specificMistake）**：无手写答案时，根据题目常见错选/错填，推测 2～4 条可能错因（\`- \` 列表，勿写「可能的原因」标题）。
`;
  const specificMistakeRule = hasAnyAnswer
    ? '- specificMistake：字符串，Markdown，含 **作答对比** + 从错答反推的错因列表（见上，勿重复「可能的原因」标题）'
    : '- specificMistake：字符串，错因定位（Markdown，2～4 条 \`- \` 列表，从常见错答推测，勿写「可能的原因」标题）';
  return `你是初中科学（含物理）教师。下面是一道题目的 OCR 原文，请**严格基于原文**分析。
${handBlock}${handHint}
**只输出一个 JSON 对象**，不要 Markdown 代码块，不要任何 JSON 之外的文字。JSON 键名固定为：
- knowledgePoints：字符串数组，2～6 条核心考点
- pitfalls：字符串数组，2～4 条**本题易错点**（须挂钩本题题干、选项、表格数据或配图细节，说明「这道题」哪里容易看错/选错/算错；不要写泛泛的学科常识）
- knowledgeTree：数组，元素形如 {"node":"物理-电学","children":["欧姆定律"]}
- summary：字符串，**题目摘要**（3～5 条要点，**每条必须单独占一行**（换行分隔）；用「核心信息：」「作答要求：」「审题要诀：」前缀；同一类型有多条时分多行写；须教学生如何从题干/表格/配图提取有价值信息，勿整段复述 OCR 原文）
${specificMistakeRule}
- circuitDescription：字符串，若有电路图则简述连接关系，否则 ""

**禁止**在 JSON 中重复输出 rawOcrText（OCR 原文过长，已由系统保存）。

OCR 原文：
---
${clipped}
---`;
}

type OcrExtractSource = 'mineru' | 'vision' | 'pdf-text';

function buildOcrCorrectionPrompt(rawOcr: string, source: OcrExtractSource): string {
  const clipped =
    rawOcr.length > 12000 ? `${rawOcr.slice(0, 12000)}\n…（已截断）` : rawOcr;
  const srcLabel = source === 'mineru' ? 'MinerU 文档解析' : '视觉大模型 OCR';
  const mineruRules =
    source === 'mineru'
      ? `
【MinerU 原文保护（最高优先级）】
- 数字、单位、实验表格中的每一格必须与识别原文一致，禁止改写
- 「电流与电阻」与「电流与电压」等实验目的以原文为准，禁止替换
- 定值电阻阻值（如 5Ω、10Ω、20Ω）与电流读数（如 0.4、0.2、0.1）禁止改动
- 滑动变阻器规格（如 50Ω、1A）禁止臆造为 0.5A、0.2A 等
- 仅纠正明显 OCR 错字、缺字，不得根据题意「推理」改写题干
- 保留 Markdown 图片行（data URL 格式），不要删除或替换为文字
`
      : '';
  return `你是初中科学（含物理）题目 OCR 校正专家。下方为「${srcLabel}」对题目图片的识别结果，可能存在错字、单位混淆、术语错误或表格缺行。
${mineruRules}
请**仅校正题目正文**并直接输出 Markdown（不要 JSON、不要代码块、不要知识点分析）：
1. 保留题号、地区标注（如【金华】）、标点
2. 纠正单位与符号：Ω、A、V、W；数字如 0.6A 勿写成 0.5A
3. 「电流与电阻」与「电流与电压」等术语以**原文**为准校正，禁止臆测改写实验目的
4. 表格必须用 Markdown 表格补全所有行列，数值与原文一致
5. 若有电路图，不要用文字替代已嵌入的图片；仅在无图片时于末尾写：电路连接：（简述元件串联/并联关系）
6. 看不清处用 [?]，禁止编造题干没有的数据

识别原文：
---
${clipped}
---`;
}

function parseCircuitFromCorrected(text: string): { body: string; circuitDescription?: string } {
  const lines = text.split('\n');
  const circuitIdx = lines.findIndex((l) => /^电路连接[：:]/i.test(l.trim()));
  if (circuitIdx < 0) return { body: text.trim() };
  const circuitLine = lines[circuitIdx].replace(/^电路连接[：:]\s*/i, '').trim();
  const body = [...lines.slice(0, circuitIdx), ...lines.slice(circuitIdx + 1)].join('\n').trim();
  return { body, circuitDescription: circuitLine || undefined };
}

/** 大模型校正 MinerU / 视觉 OCR 原文 */
async function correctOcrWithLlm(
  cfg: Pick<ResolvedAiConfig, 'apiKey' | 'modelId' | 'provider' | 'baseUrl'>,
  rawOcr: string,
  source: OcrExtractSource,
): Promise<{ text: string; circuitDescription?: string }> {
  if (!isOcrLlmCorrectEnabled()) {
    return { text: rawOcr.trim() };
  }
  if (!rawOcr.trim()) return { text: '' };

  if (
    (source === 'mineru' || source === 'vision') &&
    scoreOcrQuality(rawOcr) >= 300 &&
    (/\|[^|\n]+\|/.test(rawOcr) || /!\[.*?\]\(data:/.test(rawOcr) || /\[电路图见原题配图\]/.test(rawOcr))
  ) {
    console.log(`[zhishitree] ${source} OCR 已有表格/配图，跳过 LLM 校正以防篡改`);
    const { body, circuitDescription } = parseCircuitFromCorrected(rawOcr.trim());
    return { text: body || rawOcr.trim(), circuitDescription };
  }

  try {
    const out = await generateLlmText(cfg, buildOcrCorrectionPrompt(rawOcr, source), {
      maxTokens: 4096,
      temperature: 0.15,
    });
    const trimmed = out.trim();
    if (!trimmed || isOcrRefusal(trimmed) || trimmed.length < 8) {
      return { text: rawOcr.trim() };
    }
    const { body, circuitDescription } = parseCircuitFromCorrected(trimmed);
    console.log(`[zhishitree] LLM OCR 校正完成（来源 ${source}），长度 ${body.length}`);
    return { text: body || trimmed, circuitDescription };
  } catch (e) {
    console.warn('[zhishitree] LLM OCR 校正失败，使用原始识别文本:', e);
    return { text: rawOcr.trim() };
  }
}

/** 从模型输出中提取第一个平衡的 JSON 对象（避免 greedy 正则截断错误） */
function extractJsonObject(text: string): string | null {
  let s = text.trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const start = s.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === '\\' && inString) {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function parseJsonFromText<T>(text: string): T {
  const jsonStr = extractJsonObject(text);
  if (!jsonStr) throw new Error('模型返回的格式不正确，请重试。');
  try {
    return JSON.parse(jsonStr) as T;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'JSON 解析失败';
    throw new Error(`模型返回 JSON 无法解析：${msg}`);
  }
}

function resolveVisionModelId(provider: AiProvider, modelId: string): string {
  const normalized = normalizeModelId(provider, modelId);
  if (provider === 'gemini') {
    return process.env.GEMINI_VISION_MODEL || normalized || 'gemini-2.0-flash';
  }
  if (provider === 'zhipu') {
    return resolveZhipuVisionModelCandidates(modelId)[0] || ZHIPU_VISION_MODEL_DEFAULT;
  }
  throw new Error('当前 AI 提供商不支持图片分析，请使用 Gemini 或智谱 AI');
}

function supportsVision(provider: AiProvider): boolean {
  return provider === 'gemini' || provider === 'zhipu';
}

async function generateGeminiVisionPlainText(
  cfg: Pick<ResolvedAiConfig, 'apiKey' | 'modelId'>,
  base64: string,
  mimeType: string,
  prompt: string,
): Promise<string> {
  return runWithGeminiNetwork(async () => generateGeminiVisionPlainTextDirect(cfg, base64, mimeType, prompt));
}

async function generateGeminiVisionPlainTextDirect(
  cfg: Pick<ResolvedAiConfig, 'apiKey' | 'modelId'>,
  base64: string,
  mimeType: string,
  prompt: string,
): Promise<string> {
  const ai = createGeminiClient(cfg.apiKey);
  const model = resolveVisionModelId('gemini', cfg.modelId);
  const response = await ai.models.generateContent({
    model,
    contents: {
      parts: [
        { inlineData: { data: base64, mimeType } },
        { text: prompt },
      ],
    },
    config: { temperature: 0 },
  });
  const text = response.text?.trim();
  if (!text) throw new Error('模型未返回 OCR 内容');
  return text;
}

async function generateGeminiOcrJson(
  cfg: Pick<ResolvedAiConfig, 'apiKey' | 'modelId'>,
  base64: string,
  mimeType: string,
): Promise<{ rawOcrText: string; circuitDescription?: string }> {
  return runWithGeminiNetwork(async () => {
    const ai = createGeminiClient(cfg.apiKey);
    const model = resolveVisionModelId('gemini', cfg.modelId);
    const response = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          { inlineData: { data: base64, mimeType } },
          { text: buildOcrJsonPrompt() },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: OCR_ONLY_SCHEMA,
        temperature: 0,
      },
    });
    const text = response.text?.trim();
    if (!text) throw new Error('Gemini OCR 未返回内容');
    return parseJsonFromText<{ rawOcrText: string; circuitDescription?: string }>(text);
  });
}

async function callZhipuVisionOnce(
  cfg: Pick<ResolvedAiConfig, 'apiKey' | 'baseUrl'>,
  base64: string,
  mimeType: string,
  prompt: string,
  modelId: string,
): Promise<string> {
  const base = resolveOpenAiCompatibleBaseUrl('zhipu', cfg.baseUrl) || ZHIPU_DEFAULT_BASE_URL;
  const url = chatCompletionsUrl(base);
  const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${base64}`;

  const body = {
    model: modelId,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    max_tokens: zhipuVisionMaxTokens(modelId),
    temperature: 0.05,
    stream: false,
    thinking: { type: 'disabled' },
  };

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey.trim()}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  const raw = await r.text();
  let data: unknown = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(raw.slice(0, 300) || `HTTP ${r.status}`);
  }

  if (!r.ok) {
    const err = data as { error?: { message?: string } };
    const msg = err.error?.message || raw.slice(0, 300) || `HTTP ${r.status}`;
    if (/max_tokens/i.test(msg) && body.max_tokens > 1024) {
      const r2 = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey.trim()}`,
        },
        body: JSON.stringify({ ...body, max_tokens: 1024 }),
        signal: AbortSignal.timeout(120_000),
      });
      const raw2 = await r2.text();
      let data2: unknown = {};
      try {
        data2 = raw2 ? JSON.parse(raw2) : {};
      } catch {
        throw new Error(msg);
      }
      if (!r2.ok) throw new Error(msg);
      const { text } = extractOpenAiResponseText(data2);
      if (!text) throw new Error('智谱 OCR 未返回内容');
      return text;
    }
    throw new Error(msg);
  }

  const { text } = extractOpenAiResponseText(data);
  if (!text) throw new Error('智谱 OCR 未返回内容');
  return text;
}

async function generateZhipuVisionPlainText(
  cfg: Pick<ResolvedAiConfig, 'apiKey' | 'modelId' | 'baseUrl'>,
  base64: string,
  mimeType: string,
  prompt: string,
): Promise<string> {
  const candidates = resolveZhipuVisionModelCandidates(cfg.modelId);
  let lastErr = '';

  for (const modelId of candidates) {
    try {
      const text = await callZhipuVisionOnce(cfg, base64, mimeType, prompt, modelId);
      if (isOcrRefusal(text)) {
        lastErr = `模型 ${modelId} 不支持图片输入`;
        console.warn(`[zhishitree] OCR 拒绝 (${modelId}):`, text.slice(0, 120));
        continue;
      }
      if (text.trim().length < 8) {
        lastErr = `模型 ${modelId} 返回内容过短`;
        continue;
      }
      console.log(`[zhishitree] OCR 成功，视觉模型: ${modelId}`);
      return text;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      console.warn(`[zhishitree] OCR 失败 (${modelId}):`, lastErr);
      if (/model.*not found|不存在|无权限|invalid model|不支持/i.test(lastErr)) continue;
    }
  }

  throw new Error(
    `图片 OCR 失败：glm-5 / glm-4-flash 等纯文本模型无法识图。请在管理后台添加视觉模型（如 glm-4.6v、glm-4v-flash），或在 .env.local 设置 ZHIPU_VISION_MODEL=glm-4.6v。${lastErr ? `详情：${lastErr}` : ''}`,
  );
}

type OcrExtractResult = {
  text: string;
  circuitDescription?: string;
  source: OcrExtractSource;
  figures?: QuestionFigure[];
  ocrMeta: ExamPaperOcrMeta;
};

/** 通过 8080 能力中心识别（parse + cleanup + AI 纠错），失败时回退默认链路 */
async function extractOcrViaExamService(
  base64: string,
  mimeType: string,
): Promise<OcrExtractResult> {
  const svc = await recognizeExamViaService(base64, mimeType);
  const rawData = stripBase64Prefix(base64);
  const parsedImages = (svc.figures ?? []).map((f) => ({
    name: f.name,
    mime: f.mime,
    data: f.data,
  }));
  const processed = postprocessMineruMarkdown({
    markdown: svc.markdown,
    parsedImages,
    fallbackCircuit: rawData ? { mime: mimeType || 'image/jpeg', data: rawData } : undefined,
  });
  const piped = applyExamPaperRecognitionPipeline(processed.markdown);
  const backendLabel = `exam-paper-recognition · ${svc.mode || 'cloud_precision'}${
    svc.llmValidated ? ` · AI纠错${svc.correctionCount}处` : ''
  }`;
  console.log(
    `[zhishitree] [exam-service] 识别完成 正文=${piped.fullText.length}字 配图=${processed.figures?.length ?? 0}（下载 ${parsedImages.length}） ${backendLabel}`,
  );
  return {
    text: piped.fullText,
    source: 'mineru',
    figures: processed.figures,
    ocrMeta: {
      pipeline: EXAM_PAPER_RECOGNITION_SKILL_ID,
      skillVersion: '1',
      source: 'mineru',
      mineruBackend: backendLabel,
    },
  };
}

async function extractOcrFromImage(
  ocrCfg: Pick<ResolvedAiConfig, 'apiKey' | 'modelId' | 'provider' | 'baseUrl'>,
  base64: string,
  mimeType: string,
  engine: OcrEngine = 'default',
): Promise<OcrExtractResult> {
  if (engine === 'exam-service') {
    try {
      return await extractOcrViaExamService(base64, mimeType);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[zhishitree] [exam-service] 识别失败，回退默认识别链路:', msg);
      if (!isMineruFallbackVisionEnabled() && !isMineruOcrEnabled()) {
        throw new Error(`exam-paper-recognition 服务识别失败：${msg}`);
      }
    }
  }

  if (isMineruOcrEnabled()) {
    try {
      const skill = await recognizeExamPaperImage(base64, mimeType);
      return {
        text: skill.text,
        source: 'mineru',
        figures: skill.figures,
        ocrMeta: skill.meta,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[zhishitree] [${EXAM_PAPER_RECOGNITION_SKILL_ID}] MinerU 失败:`, msg);
      if (!isMineruFallbackVisionEnabled()) {
        throw new Error(`${EXAM_PAPER_RECOGNITION_SKILL_ID} 识别失败：${msg}`);
      }
      console.warn(`[zhishitree] [${EXAM_PAPER_RECOGNITION_SKILL_ID}] 回退视觉大模型 OCR`);
    }
  } else {
    console.warn(
      `[zhishitree] [${EXAM_PAPER_RECOGNITION_SKILL_ID}] MinerU 未配置，使用视觉大模型（非 skill 主路径）`,
    );
  }

  if (isPdfMime(mimeType)) {
    try {
      const buf = Buffer.from(stripBase64Prefix(base64), 'base64');
      const extracted = await extractExamTextFromBuffer(buf, '.pdf');
      if (extracted.text.trim().length >= 8) {
        const piped = applyExamPaperRecognitionPipeline(extracted.text);
        console.log(`[zhishitree] PDF 纯文本提取成功，长度 ${piped.fullText.length}`);
        return {
          text: piped.fullText,
          source: 'pdf-text',
          ocrMeta: {
            pipeline: EXAM_PAPER_RECOGNITION_SKILL_ID,
            skillVersion: '1',
            source: 'pdf-text',
            mineruBackend: 'pdf-parse',
          },
        };
      }
    } catch (e) {
      console.warn('[zhishitree] PDF 纯文本提取失败:', e);
    }
    throw new Error(
      'PDF 识别失败：扫描版请选用 exam-paper-recognition 服务或配置 MinerU；电子版若无文字层可尝试导出为图片上传',
    );
  }

  const visionMeta = examPaperOcrMetaForVisionFallback();
  let best = '';
  let circuitDescription = '';

  if (ocrCfg.provider === 'gemini') {
    try {
      const jsonOcr = await generateGeminiOcrJson(ocrCfg, base64, mimeType);
      if (jsonOcr.rawOcrText?.trim()) {
        const piped = applyExamPaperRecognitionPipeline(jsonOcr.rawOcrText.trim());
        return {
          text: piped.fullText,
          circuitDescription: jsonOcr.circuitDescription?.trim(),
          source: 'vision',
          ocrMeta: visionMeta,
        };
      }
    } catch (e) {
      console.warn('[zhishitree] Gemini JSON OCR 失败，改用纯文本 OCR:', e);
    }
    const plain = await generateGeminiVisionPlainText(ocrCfg, base64, mimeType, buildOcrPrompt());
    const pipedPlain = applyExamPaperRecognitionPipeline(plain);
    return { text: pipedPlain.fullText, source: 'vision', ocrMeta: visionMeta };
  }

  const candidates = resolveZhipuVisionModelCandidates(ocrCfg.modelId).slice(0, 3);
  for (const modelId of candidates) {
    try {
      const text = await callZhipuVisionOnce(ocrCfg, base64, mimeType, buildOcrPrompt(), modelId);
      if (isOcrRefusal(text) || text.trim().length < 8) continue;
      best = pickBetterOcr(best, text);
      console.log(`[zhishitree] OCR 候选 ${modelId}，得分 ${scoreOcrQuality(text)}`);
    } catch (e) {
      console.warn(`[zhishitree] OCR 候选失败 (${modelId}):`, e);
    }
  }

  const geminiBoost = resolveGeminiCredentials();
  if (geminiBoost?.apiKey && process.env.AI_OCR_USE_GEMINI !== '0') {
    try {
      const jsonOcr = await generateGeminiOcrJson(geminiBoost, base64, mimeType);
      if (jsonOcr.rawOcrText?.trim()) {
        best = pickBetterOcr(best, jsonOcr.rawOcrText);
        if (jsonOcr.circuitDescription?.trim()) circuitDescription = jsonOcr.circuitDescription.trim();
        console.log('[zhishitree] Gemini 辅助 OCR 已参与择优');
      }
    } catch {
      try {
        const gPlain = await generateGeminiVisionPlainText(geminiBoost, base64, mimeType, buildOcrPrompt());
        best = pickBetterOcr(best, gPlain);
      } catch {
        /* optional boost */
      }
    }
  }

  if (!best.trim()) {
    throw new Error(
      '图片 OCR 失败：请确认使用视觉模型 glm-4v-plus / glm-4.6v，或在 .env.local 设置 ZHIPU_VISION_MODEL=glm-4v-plus；若有 Gemini Key 可设 AI_OCR_USE_GEMINI=1',
    );
  }

  console.log(`[zhishitree] 视觉 OCR 最终得分 ${scoreOcrQuality(best)}，长度 ${best.length}`);
  const piped = applyExamPaperRecognitionPipeline(best);
  return {
    text: piped.fullText,
    circuitDescription: circuitDescription || undefined,
    source: 'vision',
    ocrMeta: visionMeta,
  };
}

async function analyzeOcrText(
  cfg: Pick<ResolvedAiConfig, 'apiKey' | 'modelId' | 'provider' | 'baseUrl'>,
  ocrText: string,
  presetCircuit?: string,
  handwritten?: { originalAnswer?: string; correctedAnswer?: string },
): Promise<QuestionAnalysis> {
  if (isOcrRefusal(ocrText)) {
    throw new Error(
      'OCR 结果无效（模型未真正读取图片）。请确认使用视觉模型 glm-4.6v / glm-4v-flash，勿用 glm-5.2 等纯文本模型识图。',
    );
  }
  const prompt = buildAnalysisFromTextPrompt(ocrText, handwritten);
  let parsed: QuestionAnalysis;
  try {
    const rawJson = await generateLlmText(cfg, prompt, { maxTokens: 4096, temperature: 0.3 });
    parsed = parseJsonFromText<QuestionAnalysis>(rawJson);
  } catch (e) {
    console.warn('[zhishitree] 分析 JSON 解析失败，使用 OCR 原文兜底:', e);
    parsed = {
      rawOcrText: '',
      knowledgePoints: ['（模型分析 JSON 解析失败，请对照 OCR 原文）'],
      pitfalls: [],
      knowledgeTree: [{ node: '科学探究方法', children: ['读题与审题'] }],
      summary: ocrText.split('\n')[0]?.slice(0, 120) || '题目分析',
      specificMistake: '自动分析暂不可用，请根据下方 OCR 原文与配图自行归纳。',
      circuitDescription: '',
    };
  }
  parsed.rawOcrText = ocrText.trim() || parsed.rawOcrText?.trim() || '';
  if (presetCircuit?.trim() && !parsed.circuitDescription?.trim()) {
    parsed.circuitDescription = presetCircuit.trim();
  }
  if (handwritten?.originalAnswer?.trim()) {
    parsed.originalAnswer = handwritten.originalAnswer.trim();
  }
  if (handwritten?.correctedAnswer?.trim()) {
    parsed.correctedAnswer = handwritten.correctedAnswer.trim();
  }
  if (!parsed.knowledgePoints?.length) parsed.knowledgePoints = [];
  if (!parsed.pitfalls?.length) parsed.pitfalls = [];
  if (!parsed.knowledgeTree?.length) parsed.knowledgeTree = [];
  if (typeof parsed.circuitDescription !== 'string') parsed.circuitDescription = '';
  return parsed;
}

/** 一步视觉+JSON（Gemini 结构化输出备用） */
async function analyzeQuestionImageOnePass(
  cfg: Pick<ResolvedAiConfig, 'apiKey' | 'modelId' | 'provider' | 'baseUrl'>,
  base64: string,
  mimeType: string,
): Promise<QuestionAnalysis> {
  return runWithGeminiNetwork(async () => {
    const ai = createGeminiClient(cfg.apiKey);
    const model = resolveVisionModelId('gemini', cfg.modelId);
    const prompt = `${buildOcrPrompt()}\n\n在完成准确 OCR 后，同时输出分析 JSON（含 rawOcrText、knowledgePoints、pitfalls、knowledgeTree、summary、specificMistake）。`;
    const response = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          { inlineData: { data: base64, mimeType } },
          { text: prompt },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: QUESTION_ANALYSIS_SCHEMA,
        temperature: 0.2,
      },
    });
    const text = response.text?.trim();
    if (!text) throw new Error('模型未返回内容');
    return parseJsonFromText<QuestionAnalysis>(text);
  });
}

async function resolveStemOcrImageInput(
  base64: string,
  mimeType: string,
): Promise<{ ocrBase64: string; ocrMimeType: string }> {
  const preprocessed = await preprocessImageForStemOcr(base64, mimeType);
  if (preprocessed) {
    return { ocrBase64: preprocessed.base64, ocrMimeType: preprocessed.mimeType };
  }
  return { ocrBase64: base64, ocrMimeType: mimeType };
}

export async function analyzeQuestionImageWithAi(
  activeCfg: Pick<ResolvedAiConfig, 'apiKey' | 'modelId' | 'provider' | 'baseUrl'>,
  base64: string,
  mimeType: string,
  engine: OcrEngine = 'default',
): Promise<QuestionAnalysis> {
  if (!supportsVision(activeCfg.provider) && activeCfg.provider !== 'zhipu' && activeCfg.provider !== 'gemini') {
    throw new Error('当前 AI 提供商不支持图片分析，请在管理后台切换为 Gemini 或智谱 AI');
  }

  const ocrCfg = resolveOcrCredentials(activeCfg as ResolvedAiConfig) ?? activeCfg;
  const ocrMode = (process.env.AI_OCR_MODE || 'quality').trim().toLowerCase();

  // MinerU / exam-service 优先时跳过 Gemini 一步识图
  if (
    engine === 'default' &&
    ocrCfg.provider === 'gemini' &&
    ocrMode !== 'two-step' &&
    !isMineruOcrEnabled() &&
    !isPdfMime(mimeType)
  ) {
    try {
      console.log('[zhishitree] 使用 Gemini 高质量一步识图');
      return await analyzeQuestionImageOnePass(ocrCfg, base64, mimeType);
    } catch (e) {
      console.warn('[zhishitree] Gemini 一步识图失败，改用两步:', e);
    }
  }

  const stemOcr = await resolveStemOcrImageInput(base64, mimeType);
  const { text: ocrText, circuitDescription, source, figures: ocrFigures, ocrMeta } =
    await extractOcrFromImage(ocrCfg, stemOcr.ocrBase64, stemOcr.ocrMimeType, engine);
  if (!ocrText.trim()) {
    throw new Error('OCR 未识别到文字，请换更清晰的图片重试');
  }
  console.log(
    `[zhishitree] [${ocrMeta.pipeline}] OCR 完成 source=${ocrMeta.source} backend=${ocrMeta.mineruBackend ?? '—'} len=${ocrText.length}`,
  );

  const corrected = await correctOcrWithLlm(activeCfg, ocrText, source);
  const finalCircuit = corrected.circuitDescription || circuitDescription;
  const analysis = await analyzeOcrText(activeCfg, corrected.text, finalCircuit);
  if (ocrFigures?.length) {
    analysis.figures = ocrFigures;
  }
  analysis.ocrMeta = ocrMeta;
  return analysis;
}

export type QuestionRecognitionResult = {
  rawOcrText: string;
  /** 黑色笔迹：学生原始作答 */
  originalAnswer?: string;
  /** 红色笔迹：批改后的正确答案 */
  correctedAnswer?: string;
  circuitDescription?: string;
  figures?: QuestionFigure[];
  ocrMeta: ExamPaperOcrMeta;
};

/** 环节 ①：仅试卷识别（exam-paper-recognition / MinerU / 视觉 OCR），不做考点分析 */
export async function recognizeQuestionImageOnly(
  activeCfg: Pick<ResolvedAiConfig, 'apiKey' | 'modelId' | 'provider' | 'baseUrl'>,
  base64: string,
  mimeType: string,
  engine: OcrEngine = 'default',
): Promise<QuestionRecognitionResult> {
  if (!supportsVision(activeCfg.provider) && activeCfg.provider !== 'zhipu' && activeCfg.provider !== 'gemini') {
    throw new Error('当前 AI 提供商不支持图片识别，请在管理后台切换为 Gemini 或智谱 AI');
  }

  const ocrCfg = resolveOcrCredentials(activeCfg as ResolvedAiConfig) ?? activeCfg;
  const stemOcr = await resolveStemOcrImageInput(base64, mimeType);

  const [ocrResult, handwritten] = await Promise.all([
    extractOcrFromImage(ocrCfg, stemOcr.ocrBase64, stemOcr.ocrMimeType, engine),
    extractHandwrittenAnswers(ocrCfg, base64, mimeType),
  ]);

  const { text, circuitDescription, source, figures, ocrMeta } = ocrResult;
  if (!text.trim()) {
    throw new Error('OCR 未识别到文字，请换更清晰的图片重试');
  }

  let finalText = text;
  let finalCircuit = circuitDescription;
  // exam-service 已在 8080 完成 cleanup + AI 纠错，不再二次校正
  if (engine !== 'exam-service') {
    const corrected = await correctOcrWithLlm(activeCfg, text, source);
    finalText = corrected.text;
    finalCircuit = corrected.circuitDescription || circuitDescription;
  }

  const piped = applyExamPaperRecognitionPipeline(finalText.trim());
  const stripped = stripHandwritingFromOcrText(piped.fullText, handwritten);
  let stemText = stripped.text.trim();
  if (!stemText || isStemOverShrunk(piped.fullText, stemText)) {
    const noiseOnly = stripHandwritingFromOcrText(piped.fullText).text.trim();
    stemText = noiseOnly.length > stemText.length ? noiseOnly : stemText;
  }
  if (!stemText || isStemOverShrunk(piped.fullText, stemText)) {
    stemText = piped.fullText.trim();
    console.warn('[zhishitree] 题干保留 OCR 原文（去手写过度）');
  }
  stemText = postprocessExamStemOcr(stemText);
  let originalAnswer = handwritten.originalAnswer;
  let correctedAnswer = handwritten.correctedAnswer;
  originalAnswer = supplementBlackWrongFill(
    originalAnswer || '',
    stemText,
    correctedAnswer,
  );
  correctedAnswer = supplementRedCorrectionFill(
    originalAnswer || '',
    stemText,
    correctedAnswer,
  );
  if (!correctedAnswer?.trim() && stripped.recoveredRedDerivation?.trim()) {
    correctedAnswer = stripped.recoveredRedDerivation;
  }
  correctedAnswer = supplementRedDerivationFill(
    originalAnswer || '',
    stemText,
    correctedAnswer,
  );
  if (!originalAnswer?.trim() && isHandwritingNoiseRecoveryEnabled() && stripped.recoveredBlack.trim()) {
    const recovered = sanitizeHandwrittenAnswers({ originalAnswer: stripped.recoveredBlack }).originalAnswer;
    if (recovered) {
      originalAnswer = recovered;
      console.log(`[zhishitree] 从 OCR 噪声回收黑笔短答 len=${originalAnswer.length}`);
    }
  }
  console.log(
    `[zhishitree] [${ocrMeta.pipeline}] 识别环节完成 engine=${engine} len=${stemText.length}` +
      (stemText.length !== piped.fullText.length ? `（去手写 ${piped.fullText.length - stemText.length} 字）` : ''),
  );

  if (originalAnswer || correctedAnswer) {
    console.log(
      `[zhishitree] 手写答案 black=${originalAnswer?.length ?? 0} red=${correctedAnswer?.length ?? 0}`,
    );
  }

  const finalHw = sanitizeHandwrittenAnswers(
    postProcessHandwrittenPair(originalAnswer || '', correctedAnswer || ''),
  );
  const withDirs = supplementBlackDirectionFill(finalHw.originalAnswer, stemText);
  const finalOut = sanitizeHandwrittenAnswers({
    originalAnswer: withDirs,
    correctedAnswer: finalHw.correctedAnswer,
  });
  stemText = blankHandwritingInStemOcr(stemText, finalOut);

  const figs = figures ?? [];
  const rawData = stripBase64Prefix(base64);
  const rawOcrText = embedAnalysisFigurePlaceholders(stemText, figs, {
    mime: mimeType || 'image/jpeg',
    data: rawData,
  });

  return {
    rawOcrText,
    originalAnswer: finalOut.originalAnswer || undefined,
    correctedAnswer: finalOut.correctedAnswer || undefined,
    circuitDescription: finalCircuit,
    figures,
    ocrMeta,
  };
}

/** 环节 ②：基于已识别（可编辑）正文做考点 / 错因 / 知识树分析 */
export async function analyzeQuestionFromOcrText(
  activeCfg: Pick<ResolvedAiConfig, 'apiKey' | 'modelId' | 'provider' | 'baseUrl'>,
  ocrText: string,
  opts?: {
    circuitDescription?: string;
    figures?: QuestionFigure[];
    ocrMeta?: ExamPaperOcrMeta;
    originalAnswer?: string;
    correctedAnswer?: string;
  },
): Promise<QuestionAnalysis> {
  const trimmed = ocrText.trim();
  if (!trimmed) throw new Error('识别正文为空，请先完成题目识别或填写文字');
  const piped = applyExamPaperRecognitionPipeline(trimmed);
  const analysis = await analyzeOcrText(activeCfg, piped.fullText, opts?.circuitDescription, {
    originalAnswer: opts?.originalAnswer,
    correctedAnswer: opts?.correctedAnswer,
  });
  if (opts?.figures?.length) analysis.figures = opts.figures;
  if (opts?.ocrMeta) analysis.ocrMeta = opts.ocrMeta;
  return analysis;
}

export async function explainKnowledgePointWithAi(
  cfg: Pick<ResolvedAiConfig, 'apiKey' | 'modelId' | 'provider' | 'baseUrl'>,
  point: string,
  contextSummary: string,
): Promise<KnowledgePointDetails> {
  const prompt = `As an expert educator, strictly explain the knowledge point "${point}" in the context of a question about "${contextSummary}".
Provide a highly accurate, detailed explanation, one highly relevant example question, and its rigorous step-by-step solution.
Ensure all content is pedagogically sound, mathematically/scientifically accurate, and free of harmful content.
Use Markdown and LaTeX for formulas. Critical: never duplicate the same quantity in both LaTeX and plain text.
Respond in professional Chinese. Output a single JSON object with keys: explanation, exampleQuestion, exampleSolution.`;

  const rawJson = await generateLlmText(cfg, prompt, { maxTokens: 4096, temperature: 0.7 });
  return parseJsonFromText<KnowledgePointDetails>(rawJson);
}

function stripBase64Prefix(raw: string): string {
  return raw.replace(/^data:[^;]+;base64,/, '').trim();
}

function looksLikeExamFigureContext(text: string): boolean {
  return /如图|电路|示意图|实验装置|滑动变阻|电压表|电流表|表格|接人A、B|接入A、B|\|.*\|/i.test(text);
}

function ocrMissingTable(ocrText: string): boolean {
  const t = ocrText.toLowerCase();
  const mentionsTable = /如下表|下表|获得数据|实验组别|电阻|电流/i.test(t);
  const hasMarkdownTable = /\|[^|\n]+\|/.test(ocrText);
  return mentionsTable && !hasMarkdownTable;
}

/** 将原题截图嵌入分析结果，表格/电路图无法纯文字还原时保留配图 */
export function enrichAnalysisWithSourceMedia(
  analysis: QuestionAnalysis,
  base64: string,
  mimeType: string,
): QuestionAnalysis {
  const data = stripBase64Prefix(base64);
  const mime = mimeType || 'image/jpeg';
  const out: QuestionAnalysis = { ...analysis };

  const piped = applyExamPaperRecognitionPipeline(out.rawOcrText || '');
  out.rawOcrText = piped.fullText;

  out.sourceImage = { mime, data };

  const existingFigures = out.figures ?? [];
  const circuitFig =
    existingFigures.find((f) => f.id === 'fig-circuit') ??
    existingFigures.find((f) => /电路/.test(f.label)) ??
    existingFigures[0];

  const blob = `${out.rawOcrText}\n${out.summary}\n${out.circuitDescription || ''}`;
  const needsFigure =
    looksLikeExamFigureContext(blob) ||
    ocrMissingTable(out.rawOcrText) ||
    /\[电路图见原题配图\]|\[配图:|<!--\s*image/i.test(out.rawOcrText) ||
    existingFigures.length > 0;

  const figures: QuestionFigure[] = [...existingFigures];

  if (needsFigure && !circuitFig) {
    figures.unshift({
      id: 'fig-circuit',
      label: '原题配图（含电路图/表格）',
      mime,
      data,
      note: out.circuitDescription?.trim() || '电路图、表格等以原题截图为准',
    });
  }

  if (figures.length) {
    out.figures = figures;
  }

  out.rawOcrText = embedAnalysisFigurePlaceholders(
    out.rawOcrText,
    figures,
    out.sourceImage,
  );

  // 已有独立电路图裁剪时，不再在 Markdown 末尾重复插入整页截图
  if (circuitFig && /!\[.*?\]\(data:/.test(out.rawOcrText)) {
    out.rawOcrText = out.rawOcrText.replace(
      /\n+!\[原题配图\]\(data:[^)]+\)\s*$/,
      '',
    );
  }

  return out;
}
