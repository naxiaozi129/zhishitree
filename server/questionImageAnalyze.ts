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
import { isMineruOcrEnabled, parseImageWithMineru } from './mineruOcr.js';
import { isMineruFallbackVisionEnabled, isOcrLlmCorrectEnabled } from './mineruSettings.js';
import {
  embedAnalysisFigurePlaceholders,
  postprocessMineruMarkdown,
} from './examFigureExtract.js';

export type QuestionFigure = {
  id: string;
  label: string;
  mime: string;
  /** base64 正文（不含 data: 前缀） */
  data: string;
  note?: string;
};

export type QuestionAnalysis = {
  rawOcrText: string;
  knowledgePoints: string[];
  pitfalls: string[];
  knowledgeTree: { node: string; children: string[] }[];
  summary: string;
  specificMistake: string;
  /** 原题完整截图，便于对照表格/电路图 */
  sourceImage?: { mime: string; data: string };
  /** 无法纯文字表达的配图（电路图等） */
  figures?: QuestionFigure[];
  /** 电路连接关系文字描述（可选） */
  circuitDescription?: string;
};

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
      description: '常见易错点列表',
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
    summary: { type: Type.STRING, description: '题目摘要' },
    specificMistake: {
      type: Type.STRING,
      description: '具体错误分析（Markdown）',
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

直接输出转录正文，不要 JSON，不要 Markdown 代码块，不要加「以下是」等前缀。`;
}

function buildAnalysisFromTextPrompt(ocrText: string): string {
  const clipped =
    ocrText.length > 6000 ? `${ocrText.slice(0, 6000)}\n…（OCR 已截断，完整原文由系统保留）` : ocrText;
  return `你是初中科学（含物理）教师。下面是一道题目的 OCR 原文，请**严格基于原文**分析。

**只输出一个 JSON 对象**，不要 Markdown 代码块，不要任何 JSON 之外的文字。JSON 键名固定为：
- knowledgePoints：字符串数组，2～6 条核心考点
- pitfalls：字符串数组，1～4 条易错点
- knowledgeTree：数组，元素形如 {"node":"物理-电学","children":["欧姆定律"]}
- summary：字符串，一句话题意
- specificMistake：字符串，错因/难点（Markdown，简洁）
- circuitDescription：字符串，若有电路图则简述连接关系，否则 ""

**禁止**在 JSON 中重复输出 rawOcrText（OCR 原文过长，已由系统保存）。

OCR 原文：
---
${clipped}
---`;
}

type OcrExtractSource = 'mineru' | 'vision';

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
  return runWithGeminiNetwork(async () => {
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
  });
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
};

async function extractOcrFromImage(
  ocrCfg: Pick<ResolvedAiConfig, 'apiKey' | 'modelId' | 'provider' | 'baseUrl'>,
  base64: string,
  mimeType: string,
): Promise<OcrExtractResult> {
  if (isMineruOcrEnabled()) {
    try {
      const mineru = await parseImageWithMineru(base64, mimeType);
      const rawData = stripBase64Prefix(base64);
      const processed = postprocessMineruMarkdown({
        markdown: mineru.markdown,
        parsedImages: mineru.images,
        fallbackCircuit: rawData ? { mime: mimeType || 'image/jpeg', data: rawData } : undefined,
      });
      return {
        text: processed.markdown,
        source: 'mineru',
        figures: processed.figures,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[zhishitree] MinerU OCR 失败:', msg);
      if (!isMineruFallbackVisionEnabled()) {
        throw new Error(`MinerU 识别失败：${msg}`);
      }
    }
  }

  let best = '';
  let circuitDescription = '';

  if (ocrCfg.provider === 'gemini') {
    try {
      const jsonOcr = await generateGeminiOcrJson(ocrCfg, base64, mimeType);
      if (jsonOcr.rawOcrText?.trim()) {
        return {
          text: jsonOcr.rawOcrText.trim(),
          circuitDescription: jsonOcr.circuitDescription?.trim(),
          source: 'vision',
        };
      }
    } catch (e) {
      console.warn('[zhishitree] Gemini JSON OCR 失败，改用纯文本 OCR:', e);
    }
    const plain = await generateGeminiVisionPlainText(ocrCfg, base64, mimeType, buildOcrPrompt());
    return { text: plain, source: 'vision' };
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
  return { text: best, circuitDescription: circuitDescription || undefined, source: 'vision' };
}

async function analyzeOcrText(
  cfg: Pick<ResolvedAiConfig, 'apiKey' | 'modelId' | 'provider' | 'baseUrl'>,
  ocrText: string,
  presetCircuit?: string,
): Promise<QuestionAnalysis> {
  if (isOcrRefusal(ocrText)) {
    throw new Error(
      'OCR 结果无效（模型未真正读取图片）。请确认使用视觉模型 glm-4.6v / glm-4v-flash，勿用 glm-5.2 等纯文本模型识图。',
    );
  }
  const prompt = buildAnalysisFromTextPrompt(ocrText);
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

export async function analyzeQuestionImageWithAi(
  activeCfg: Pick<ResolvedAiConfig, 'apiKey' | 'modelId' | 'provider' | 'baseUrl'>,
  base64: string,
  mimeType: string,
): Promise<QuestionAnalysis> {
  if (!supportsVision(activeCfg.provider) && activeCfg.provider !== 'zhipu' && activeCfg.provider !== 'gemini') {
    throw new Error('当前 AI 提供商不支持图片分析，请在管理后台切换为 Gemini 或智谱 AI');
  }

  const ocrCfg = resolveOcrCredentials(activeCfg as ResolvedAiConfig) ?? activeCfg;
  const ocrMode = (process.env.AI_OCR_MODE || 'quality').trim().toLowerCase();

  // MinerU 优先时跳过 Gemini 一步识图
  if (
    ocrCfg.provider === 'gemini' &&
    ocrMode !== 'two-step' &&
    !isMineruOcrEnabled()
  ) {
    try {
      console.log('[zhishitree] 使用 Gemini 高质量一步识图');
      return await analyzeQuestionImageOnePass(ocrCfg, base64, mimeType);
    } catch (e) {
      console.warn('[zhishitree] Gemini 一步识图失败，改用两步:', e);
    }
  }

  const { text: ocrText, circuitDescription, source, figures: ocrFigures } = await extractOcrFromImage(
    ocrCfg,
    base64,
    mimeType,
  );
  if (!ocrText.trim()) {
    throw new Error('OCR 未识别到文字，请换更清晰的图片重试');
  }

  const corrected = await correctOcrWithLlm(activeCfg, ocrText, source);
  const finalCircuit = corrected.circuitDescription || circuitDescription;
  const analysis = await analyzeOcrText(activeCfg, corrected.text, finalCircuit);
  if (ocrFigures?.length) {
    analysis.figures = ocrFigures;
  }
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
