import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import multer from 'multer';
import {
  authMiddleware,
  clearAuthCookie,
  publicUserPayload,
  requireAuth,
  requireQuestionAdmin,
  requireSuperAdmin,
  setAuthCookie,
  signToken,
} from './auth.js';
import {
  bulkCreateQuestions,
  countQuestions,
  countSuperAdmins,
  countUsers,
  createQuestion,
  createUser,
  db,
  deleteQuestion,
  bulkDeleteQuestions,
  getQuestionById,
  getUserById,
  getUserByUsername,
  listQuestions,
  listQuestionsForExport,
  updateQuestion,
  updateUserAdminFields,
} from './db.js';
import { isStaffRole, isSuperAdminRole, isValidRoleInput, normalizeRole, ROLES } from './roles.js';
import {
  analyzeStudentReflection,
  assessReflectionAnswers,
  type ReflectionAnalyzeResult,
} from './mistakeReflectionGemini.js';
import { splitExamPaperHeuristic, heuristicSplitLooksBroken, refineQuestionSplit } from './importPaper.js';
import { stripExamBoilerplate } from './examBoilerplate.js';
import { buildCooccurrenceGraph, type AnalysisShape } from './graph.js';
import { JUNIOR_SCIENCE_TREE, SCIENCE_TREE_VERSION } from './juniorScienceTreeData.js';
import { generateKnowledgeInsight } from './geminiInsight.js';
import {
  aiConfigUnavailableMessage,
  createAiModelFromInput,
  getEnvAiFallbackStatus,
  listAiModelsForAdmin,
  markAiModelDefault,
  removeAiModel,
  resolveAiModelForTest,
  resolveAiCredentials,
  resolveActiveAiCredentials,
  updateAiModelFromInput,
  type ResolvedAiConfig,
} from './aiModelConfig.js';
import { testAiModelConnection } from './aiModelTest.js';
import { checkMineruHealth, checkMineruHealthDetailed, isMineruOcrEnabled } from './mineruOcr.js';
import { getMineruSettingsPublic, updateMineruSettings } from './mineruSettings.js';
import {
  analyzeQuestionImageWithAi,
  enrichAnalysisWithSourceMedia,
  explainKnowledgePointWithAi,
} from './questionImageAnalyze.js';
import {
  analysisMatchBlob,
  buildScienceTreeCoverage,
  enrichMatchesWithReasons,
  getFlatScienceNodes,
  matchAnalysisToScienceTree,
  matchLabelsToScienceTree,
  matchTextToScienceTree,
  mergeScienceMatches,
} from './scienceTreeMatch.js';
import {
  applyScienceCorrect,
  applyScienceWrong,
  getRejectedNodeIdsForMistake,
  getScienceMasteryDetail,
  insertMappingReject,
  refundWrongDelta,
  tryConsumePracticeDedupe,
  type MasteryDetailRow,
} from './scienceMastery.js';
import { splitExamPaperGemini } from './paperSplitGemini.js';
import { splitQuestionAndAnswer } from './examContentSplit.js';
import { ingestPaperTextToPending } from './paperIngestPending.js';
import {
  examFileBaseName,
  extractExamTextFromBuffer,
  isIngestibleExamFileName,
  resolveUploadFileName,
} from './paperFileExtract.js';
import {
  extractMaterialText,
  isIngestibleMaterial,
  listMaterialDir,
} from './zhongkaoMaterials.js';
import { buildZhongkaoTopicTree } from './zhongkaoTopicTree.js';
import {
  parseQuestionsYaml,
  serializeQuestionsYaml,
  yamlItemToPreparedQuestion,
} from './questionYaml.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(root, '.env') });
dotenv.config({ path: path.join(root, '.env.local') });

const app = express();
const PORT = Number(process.env.API_PORT || process.env.PORT || 8787);

const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000,http://localhost:5174')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function isPrivateLanOrigin(origin: string): boolean {
  if (process.env.CORS_LAN === '0') return false;
  try {
    const { hostname } = new URL(origin);
    if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
    const m = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (!m) return false;
    const [, a, b] = m.map(Number);
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  } catch {
    return false;
  }
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || corsOrigins.includes(origin) || corsOrigins.includes('*')) {
        callback(null, true);
        return;
      }
      if (isPrivateLanOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

const paperUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
});

function paperIngestError(res: express.Response, e: unknown, next: express.NextFunction) {
  const msg = e instanceof Error ? e.message : '入库失败';
  if (msg.includes('GEMINI_API_KEY') || msg.includes('AI 模型 API') || msg.includes('未配置 AI')) {
    res.status(503).json({ error: msg });
    return;
  }
  if (msg.includes('为空') || msg.includes('未解析') || msg.includes('未能') || msg.includes('不支持')) {
    res.status(400).json({ error: msg });
    return;
  }
  next(e);
}

function requireAiConfig(res: express.Response): ResolvedAiConfig | null {
  const cfg = resolveActiveAiCredentials();
  if (!cfg?.apiKey) {
    res.status(503).json({ error: aiConfigUnavailableMessage() });
    return null;
  }
  return cfg;
}
app.use(authMiddleware);

function seedInitialAdmin() {
  const n = countUsers();
  if (n > 0) return;
  const u = process.env.INITIAL_ADMIN_USERNAME?.trim();
  const p = process.env.INITIAL_ADMIN_PASSWORD?.trim();
  if (!u || !p) return;
  const hash = bcrypt.hashSync(p, 10);
  createUser(u, hash, ROLES.SUPER_ADMIN, true);
  console.log(`[zhishitree] 已创建初始管理员账号: ${u}`);
}

seedInitialAdmin();

function parseQuestionBodyJson(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

app.get('/api/health', async (_req, res) => {
  const mineruSettings = await getMineruSettingsPublic();
  const mineruConfigured = isMineruOcrEnabled();
  const mineruHealthy = mineruConfigured
    ? await checkMineruHealth({
        apiUrl: mineruSettings.apiUrl,
        apiMode: mineruSettings.apiMode,
      })
    : false;
  res.json({
    ok: true,
    mineru: {
      configured: mineruConfigured,
      healthy: mineruHealthy,
      url: mineruSettings.apiUrl || undefined,
      enabled: mineruSettings.enabled,
      apiMode: mineruSettings.apiMode,
    },
  });
});

/** 错题图片 AI 分析（走服务端配置的模型，支持 Gemini / 智谱等） */
app.post('/api/analyze/question-image', async (req, res, next) => {
  try {
    const cfg = requireAiConfig(res);
    if (!cfg) return;
    const base64 = String(req.body?.base64 ?? req.body?.base64Image ?? '').trim();
    const mimeType = String(req.body?.mimeType ?? req.body?.mime_type ?? 'image/jpeg').trim();
    if (!base64) {
      res.status(400).json({ error: '请提供图片 base64 数据' });
      return;
    }
    const analysis = enrichAnalysisWithSourceMedia(
      await analyzeQuestionImageWithAi(cfg, base64, mimeType),
      base64,
      mimeType,
    );
    res.json({ analysis });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '分析失败';
    if (msg.includes('未配置 AI') || msg.includes('API Key') || msg.includes('不支持图片')) {
      res.status(503).json({ error: msg });
      return;
    }
    console.error('[zhishitree api] analyze/question-image:', e);
    res.status(502).json({ error: msg });
  }
});

/** 知识点详解（走服务端 AI） */
app.post('/api/analyze/explain-knowledge-point', async (req, res, next) => {
  try {
    const cfg = requireAiConfig(res);
    if (!cfg) return;
    const point = String(req.body?.point ?? '').trim();
    const contextSummary = String(req.body?.contextSummary ?? req.body?.context ?? '').trim();
    if (!point) {
      res.status(400).json({ error: '请提供知识点 point' });
      return;
    }
    const details = await explainKnowledgePointWithAi(cfg, point, contextSummary);
    res.json({ details });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '讲解生成失败';
    if (msg.includes('未配置 AI') || msg.includes('API Key')) {
      res.status(503).json({ error: msg });
      return;
    }
    console.error('[zhishitree api] analyze/explain-knowledge-point:', e);
    res.status(502).json({ error: msg });
  }
});

app.post('/api/auth/register', (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (username.length < 2 || username.length > 32) {
    res.status(400).json({ error: '用户名长度为 2～32 个字符' });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: '密码至少 6 位' });
    return;
  }
  if (getUserByUsername(username)) {
    res.status(409).json({ error: '用户名已存在' });
    return;
  }
  const isFirst = countUsers() === 0;
  const asSuper = isFirst && process.env.FIRST_USER_AS_ADMIN !== '0';
  const role = asSuper ? ROLES.SUPER_ADMIN : ROLES.USER;
  const approved = asSuper;
  const hash = bcrypt.hashSync(password, 10);
  const id = createUser(username, hash, role, approved);
  const created = getUserById(id);
  if (!created) {
    res.status(500).json({ error: '注册失败' });
    return;
  }
  const token = signToken(id, created.role);
  setAuthCookie(res, token);
  res.json({ user: publicUserPayload(created), pendingApproval: !created.approved && !isSuperAdminRole(created.role) });
});

app.post('/api/auth/login', (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const row = getUserByUsername(username);
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    res.status(401).json({ error: '用户名或密码错误' });
    return;
  }
  const user = getUserById(row.id);
  if (!user) {
    res.status(401).json({ error: '用户名或密码错误' });
    return;
  }
  const token = signToken(user.id, user.role);
  setAuthCookie(res, token);
  res.json({ user: publicUserPayload(user), pendingApproval: !user.approved && !isSuperAdminRole(user.role) });
});

app.post('/api/auth/logout', (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.user) {
    res.json({ user: null });
    return;
  }
  res.json({ user: publicUserPayload(req.user) });
});

app.post('/api/mistakes', requireAuth, (req, res) => {
  const analysis = req.body?.analysis;
  if (!analysis || typeof analysis !== 'object') {
    res.status(400).json({ error: '缺少 analysis 对象' });
    return;
  }
  const summary = typeof analysis.summary === 'string' ? analysis.summary : '';
  const preview = summary.slice(0, 240);
  const r = db
    .prepare('INSERT INTO mistakes (user_id, analysis_json, summary_preview) VALUES (?, ?, ?)')
    .run(req.user!.id, JSON.stringify(analysis), preview);
  const newId = Number(r.lastInsertRowid);
  let scienceMatches: ReturnType<typeof enrichMatchesWithReasons> = [];
  try {
    const blob = analysisMatchBlob(analysis as AnalysisShape);
    const matches = matchAnalysisToScienceTree(analysis as AnalysisShape);
    scienceMatches = enrichMatchesWithReasons(blob, matches).filter((m) => m.score >= 28);
    const rejects = getRejectedNodeIdsForMistake(req.user!.id, newId);
    const nodeIds = matches.filter((m) => m.score >= 28 && !rejects.has(m.id)).map((m) => m.id);
    if (nodeIds.length) applyScienceWrong(req.user!.id, nodeIds);
  } catch {
    /* 掌握度同步失败不影响保存错题 */
  }
  res.json({ id: newId, scienceMatches });
});

app.get('/api/mistakes', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      'SELECT id, analysis_json, summary_preview, created_at FROM mistakes WHERE user_id = ? ORDER BY id DESC',
    )
    .all(req.user!.id) as { id: number; analysis_json: string; summary_preview: string; created_at: string }[];
  res.json({ items: rows });
});

app.get('/api/mistakes/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const row = db
    .prepare(
      'SELECT id, analysis_json, summary_preview, created_at, reflection_text, reflection_session FROM mistakes WHERE id = ? AND user_id = ?',
    )
    .get(id, req.user!.id) as
    | {
        id: number;
        analysis_json: string;
        summary_preview: string;
        created_at: string;
        reflection_text: string | null;
        reflection_session: string | null;
      }
    | undefined;
  if (!row) {
    res.status(404).json({ error: '记录不存在' });
    return;
  }
  let reflection_session: unknown = null;
  if (row.reflection_session) {
    try {
      reflection_session = JSON.parse(row.reflection_session) as unknown;
    } catch {
      reflection_session = null;
    }
  }
  res.json({
    id: row.id,
    analysis_json: row.analysis_json,
    summary_preview: row.summary_preview,
    created_at: row.created_at,
    reflection_text: row.reflection_text,
    reflection_session,
  });
});

/**
 * 第一步：学生自述错因 → AI 归纳盲区、追问、相似题
 * body: { reflectionText: string }
 */
app.post('/api/mistakes/:id/reflection/analyze', requireAuth, async (req, res, next) => {
  try {
    const cfg = requireAiConfig(res);
    if (!cfg) return;
    const apiKey = cfg.apiKey;
    const id = Number(req.params.id);
    const reflectionText = String(req.body?.reflectionText || '').trim();
    if (reflectionText.length < 8) {
      res.status(400).json({ error: '请至少写几句思考过程（不少于 8 个字）' });
      return;
    }
    const row = db
      .prepare('SELECT id, analysis_json FROM mistakes WHERE id = ? AND user_id = ?')
      .get(id, req.user!.id) as { id: number; analysis_json: string } | undefined;
    if (!row) {
      res.status(404).json({ error: '记录不存在' });
      return;
    }
    let analysis: Record<string, unknown>;
    try {
      analysis = JSON.parse(row.analysis_json) as Record<string, unknown>;
    } catch {
      res.status(400).json({ error: '错题解析数据损坏' });
      return;
    }
    const blob = analysisMatchBlob(analysis as AnalysisShape);
    const matches = matchAnalysisToScienceTree(analysis as AnalysisShape);
    const enriched = enrichMatchesWithReasons(blob, matches).filter((m) => m.score >= 28);
    const scienceContext = enriched.map((m) => `${m.label} — ${m.path}`).join('\n');

    const analyzeResult = await analyzeStudentReflection(
      apiKey,
      {
        analysis,
        reflectionText,
        scienceContext,
      },
      cfg.modelId,
      cfg,
    );

    const session = {
      v: 1 as const,
      reflectionText,
      analyzedAt: new Date().toISOString(),
      analyzeResult,
    };

    db.prepare('UPDATE mistakes SET reflection_text = ?, reflection_session = ? WHERE id = ? AND user_id = ?').run(
      reflectionText,
      JSON.stringify(session),
      id,
      req.user!.id,
    );

    res.json({ ...analyzeResult, session });
  } catch (e) {
    next(e);
  }
});

/**
 * 第二步：学生对追问与相似题作答 → AI 总评掌握情况
 * body: { followUpAnswers: string[], similarAnswers: string[] }
 */
app.post('/api/mistakes/:id/reflection/assess', requireAuth, async (req, res, next) => {
  try {
    const cfg = requireAiConfig(res);
    if (!cfg) return;
    const apiKey = cfg.apiKey;
    const id = Number(req.params.id);
    const followUpAnswers = Array.isArray(req.body?.followUpAnswers)
      ? req.body.followUpAnswers.map((x: unknown) => String(x ?? ''))
      : [];
    const similarAnswers = Array.isArray(req.body?.similarAnswers)
      ? req.body.similarAnswers.map((x: unknown) => String(x ?? ''))
      : [];

    const row = db
      .prepare('SELECT reflection_text, reflection_session, analysis_json FROM mistakes WHERE id = ? AND user_id = ?')
      .get(id, req.user!.id) as
      | {
          reflection_text: string | null;
          reflection_session: string | null;
          analysis_json: string;
        }
      | undefined;
    if (!row) {
      res.status(404).json({ error: '记录不存在' });
      return;
    }
    let session: {
      analyzeResult?: ReflectionAnalyzeResult;
      reflectionText?: string;
      [key: string]: unknown;
    };
    try {
      session = row.reflection_session ? (JSON.parse(row.reflection_session) as typeof session) : {};
    } catch {
      res.status(400).json({ error: '会话数据损坏，请重新提交第一步' });
      return;
    }
    if (!session.analyzeResult) {
      res.status(400).json({ error: '请先完成「提交思路并生成追问」' });
      return;
    }

    const reflectionText = row.reflection_text || session.reflectionText || '';
    const analysis = JSON.parse(row.analysis_json) as Record<string, unknown>;
    const summary = typeof analysis.summary === 'string' ? analysis.summary : '';

    const assessResult = await assessReflectionAnswers(
      apiKey,
      {
        analyzeResult: session.analyzeResult,
        reflectionText,
        followUpAnswers,
        similarAnswers,
        analysisSummary: summary.slice(0, 1200),
      },
      cfg.modelId,
      cfg,
    );

    const nextSession = {
      ...session,
      followUpAnswers,
      similarAnswers,
      assessedAt: new Date().toISOString(),
      assessResult,
    };

    db.prepare('UPDATE mistakes SET reflection_session = ? WHERE id = ? AND user_id = ?').run(
      JSON.stringify(nextSession),
      id,
      req.user!.id,
    );

    res.json({ ...assessResult, session: nextSession });
  } catch (e) {
    next(e);
  }
});

app.delete('/api/mistakes/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const r = db.prepare('DELETE FROM mistakes WHERE id = ? AND user_id = ?').run(id, req.user!.id);
  if (r.changes === 0) {
    res.status(404).json({ error: '记录不存在' });
    return;
  }
  res.json({ ok: true });
});

/** 某条错题映射到的知识树节点 + 命中说明（与入库时规则一致） */
app.get('/api/mistakes/:id/science-matches', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const row = db
    .prepare('SELECT id, analysis_json FROM mistakes WHERE id = ? AND user_id = ?')
    .get(id, req.user!.id) as { id: number; analysis_json: string } | undefined;
  if (!row) {
    res.status(404).json({ error: '记录不存在' });
    return;
  }
  try {
    const analysis = JSON.parse(row.analysis_json) as AnalysisShape;
    const blob = analysisMatchBlob(analysis);
    const matches = matchAnalysisToScienceTree(analysis);
    const enriched = enrichMatchesWithReasons(blob, matches).filter((m) => m.score >= 28);
    res.json({ matches: enriched });
  } catch {
    res.status(400).json({ error: '解析 analysis_json 失败' });
  }
});

/** 否决「本题 → 某知识点」映射，并退回一次错题扣分 */
app.post('/api/knowledge/reject-mapping', requireAuth, (req, res) => {
  const mistakeId = Number(req.body?.mistakeId);
  const nodeId = String(req.body?.nodeId || '').trim();
  if (!mistakeId || !nodeId) {
    res.status(400).json({ error: 'mistakeId、nodeId 必填' });
    return;
  }
  const row = db
    .prepare('SELECT id FROM mistakes WHERE id = ? AND user_id = ?')
    .get(mistakeId, req.user!.id) as { id: number } | undefined;
  if (!row) {
    res.status(404).json({ error: '错题记录不存在' });
    return;
  }
  insertMappingReject(req.user!.id, mistakeId, nodeId);
  refundWrongDelta(req.user!.id, nodeId);
  res.json({ ok: true });
});

/** 题库：登录用户可检索已发布题；草稿仅管理员可查 */
app.get('/api/questions', requireAuth, (req, res) => {
  const subject = typeof req.query.subject === 'string' ? req.query.subject : undefined;
  const q = typeof req.query.q === 'string' ? req.query.q : undefined;
  const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
  const offset = req.query.offset !== undefined ? Number(req.query.offset) : undefined;
  const qs = typeof req.query.status === 'string' ? req.query.status : undefined;
  let status: 'draft' | 'published' | 'pending' | 'all' | undefined = 'published';
  if (req.user && isStaffRole(req.user.role)) {
    if (qs === 'draft' || qs === 'published' || qs === 'pending' || qs === 'all') status = qs;
  }
  const total = countQuestions({ subject, q, status });
  const rows = listQuestions({ subject, q, status, limit, offset });
  res.json({
    total,
    items: rows.map((row) => ({
      id: row.id,
      title: row.title,
      stem: row.stem,
      subject: row.subject,
      difficulty: row.difficulty,
      created_by: row.created_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
      status: row.status,
      source: row.source,
      body: parseQuestionBodyJson(row.body_json),
    })),
  });
});

app.get('/api/questions/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const row = getQuestionById(id);
  if (!row) {
    res.status(404).json({ error: '题目不存在' });
    return;
  }
  if ((row.status === 'draft' || row.status === 'pending') && (!req.user || !isStaffRole(req.user.role))) {
    res.status(404).json({ error: '题目不存在' });
    return;
  }
  res.json({
    id: row.id,
    title: row.title,
    stem: row.stem,
    subject: row.subject,
    difficulty: row.difficulty,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    status: row.status,
    source: row.source,
    body: parseQuestionBodyJson(row.body_json),
  });
});

app.post('/api/questions', requireAuth, requireQuestionAdmin, (req, res) => {
  const statusRaw = req.body?.status;
  const status: 'draft' | 'published' | 'pending' =
    statusRaw === 'draft' ? 'draft' : statusRaw === 'pending' ? 'pending' : 'published';
  let stem = String(req.body?.stem || '').trim();
  if (!stem) {
    if (status === 'draft') stem = '(未输入题干)';
    else {
      res.status(400).json({ error: '题干 stem 不能为空' });
      return;
    }
  }
  const title = req.body?.title != null ? String(req.body.title).trim() || null : null;
  const subject = req.body?.subject != null ? String(req.body.subject).trim() || null : null;
  const difficultyRaw = req.body?.difficulty;
  let difficulty: number | null = null;
  if (difficultyRaw !== undefined && difficultyRaw !== null && difficultyRaw !== '') {
    const n = Number(difficultyRaw);
    if (Number.isNaN(n) || n < 1 || n > 5) {
      res.status(400).json({ error: 'difficulty 应为 1～5 的整数' });
      return;
    }
    difficulty = Math.round(n);
  }
  let body: Record<string, unknown> = {};
  if (req.body?.body != null && typeof req.body.body === 'object' && !Array.isArray(req.body.body)) {
    body = req.body.body as Record<string, unknown>;
  }
  const sourceRaw = req.body?.source;
  const source: 'manual' | 'import' =
    sourceRaw === 'import' ? 'import' : 'manual';
  const id = createQuestion({
    title,
    stem,
    body,
    subject,
    difficulty,
    createdBy: req.user!.id,
    status,
    source,
  });
  res.json({ id });
});

app.patch('/api/questions/:id', requireAuth, requireQuestionAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = getQuestionById(id);
  if (!existing) {
    res.status(404).json({ error: '题目不存在' });
    return;
  }
  const patch: Parameters<typeof updateQuestion>[1] = {};
  if ('title' in req.body) {
    patch.title = req.body.title == null ? null : String(req.body.title).trim() || null;
  }
  if ('stem' in req.body) {
    const st = String(req.body.stem || '').trim();
    if (!st) {
      res.status(400).json({ error: '题干不能为空' });
      return;
    }
    patch.stem = st;
  }
  if (
    'body' in req.body &&
    req.body.body != null &&
    typeof req.body.body === 'object' &&
    !Array.isArray(req.body.body)
  ) {
    patch.body = req.body.body as Record<string, unknown>;
  }
  if ('subject' in req.body) {
    patch.subject = req.body.subject == null ? null : String(req.body.subject).trim() || null;
  }
  if ('difficulty' in req.body) {
    const d = req.body.difficulty;
    if (d === null || d === '') patch.difficulty = null;
    else {
      const n = Number(d);
      if (Number.isNaN(n) || n < 1 || n > 5) {
        res.status(400).json({ error: 'difficulty 应为 1～5 或 null' });
        return;
      }
      patch.difficulty = Math.round(n);
    }
  }
  if ('status' in req.body) {
    const s = req.body.status;
    if (s !== 'draft' && s !== 'published' && s !== 'pending') {
      res.status(400).json({ error: 'status 只能为 draft、published 或 pending' });
      return;
    }
    patch.status = s;
  }
  const ok = updateQuestion(id, patch);
  if (!ok) {
    res.status(400).json({ error: '没有可更新的字段' });
    return;
  }
  res.json({ ok: true });
});

app.delete('/api/questions/:id', requireAuth, requireQuestionAdmin, (req, res) => {
  const id = Number(req.params.id);
  const ok = deleteQuestion(id);
  if (!ok) {
    res.status(404).json({ error: '题目不存在' });
    return;
  }
  res.json({ ok: true });
});

/** 批量删除待审核题目 */
app.post('/api/questions/batch-delete', requireAuth, requireQuestionAdmin, (req, res) => {
  const raw = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const ids = raw.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) {
    res.status(400).json({ error: '请提供 ids 数组' });
    return;
  }
  const onlyPending = req.body?.onlyPending !== false;
  const count = bulkDeleteQuestions(ids, onlyPending ? { status: 'pending' } : undefined);
  if (count === 0) {
    res.status(404).json({ error: '未删除任何题目（可能不存在或不在待审核状态）' });
    return;
  }
  res.json({ ok: true, count });
});

/** 试卷文本预览拆分（启发式 + 可选 Gemini） */
app.post('/api/questions/preview-split', requireAuth, requireQuestionAdmin, async (req, res, next) => {
  try {
    const rawText = String(req.body?.text ?? '');
    if (!rawText.trim()) {
      res.status(400).json({ error: '请粘贴试卷正文 text' });
      return;
    }
    const text = stripExamBoilerplate(rawText);
    if (!text) {
      res.status(400).json({ error: '正文仅含卷头/注意事项，未检测到可拆分的试题' });
      return;
    }
    const useAiExplicit = req.body?.useAi;
    const aiCfg = resolveActiveAiCredentials();
    const key = aiCfg?.apiKey || '';
    const modelId = aiCfg?.modelId;
    const preferAi = useAiExplicit !== false && Boolean(key);

    let method: 'heuristic' | 'gemini' | 'heuristic_fallback' = 'heuristic';
    let items = refineQuestionSplit(text, splitExamPaperHeuristic(text));

    const runGemini = async () => {
      items = refineQuestionSplit(text, await splitExamPaperGemini(key, text, aiCfg?.modelId, aiCfg ?? undefined));
      method = 'gemini';
    };

    if (preferAi && key && heuristicSplitLooksBroken(items, text)) {
      try {
        await runGemini();
      } catch (e) {
        console.warn('[zhishitree] Gemini 拆题失败，改用启发式:', e);
        items = refineQuestionSplit(text, splitExamPaperHeuristic(text));
        method = 'heuristic_fallback';
      }
    } else if (useAiExplicit === true && !key) {
      res.status(503).json({ error: aiConfigUnavailableMessage() });
      return;
    } else if (!preferAi && key && heuristicSplitLooksBroken(items, text)) {
      try {
        await runGemini();
      } catch (e) {
        console.warn('[zhishitree] 启发式拆题异常且 Gemini 失败:', e);
      }
    }

    res.json({
      method,
      count: items.length,
      items: items.map((it) => {
        const { question, answer } = splitQuestionAndAnswer(it.stem);
        return {
          title: it.title,
          stem: question,
          body: {
            ...it.body,
            ...(answer ? { answerText: answer } : {}),
          },
        };
      }),
    });
  } catch (e) {
    next(e);
  }
});

/** 批量入库（导入校对后一次写入） */
app.post('/api/questions/import-batch', requireAuth, requireQuestionAdmin, (req, res) => {
  const rawItems = req.body?.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    res.status(400).json({ error: 'items 必须为非空数组' });
    return;
  }
  const publish = req.body?.publish !== false;
  const defaultSubject =
    req.body?.defaultSubject != null ? String(req.body.defaultSubject).trim() || null : null;
  const status: 'draft' | 'published' = publish ? 'published' : 'draft';

  const prepared: Parameters<typeof bulkCreateQuestions>[0] = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') continue;
    const stem = String((raw as { stem?: unknown }).stem ?? '').trim();
    if (!stem) continue;
    const title =
      (raw as { title?: unknown }).title != null
        ? String((raw as { title: unknown }).title).trim() || null
        : null;
    const subject =
      (raw as { subject?: unknown }).subject != null
        ? String((raw as { subject: unknown }).subject).trim() || null
        : defaultSubject;
    let difficulty: number | null = null;
    const dr = (raw as { difficulty?: unknown }).difficulty;
    if (dr !== undefined && dr !== null && dr !== '') {
      const n = Number(dr);
      if (!Number.isNaN(n) && n >= 1 && n <= 5) difficulty = Math.round(n);
    }
    let body: Record<string, unknown> = {};
    if (
      (raw as { body?: unknown }).body != null &&
      typeof (raw as { body: unknown }).body === 'object' &&
      !Array.isArray((raw as { body: unknown }).body)
    ) {
      body = (raw as { body: Record<string, unknown> }).body;
    }
    prepared.push({
      title,
      stem,
      body,
      subject,
      difficulty,
      createdBy: req.user!.id,
      status,
      source: 'import',
    });
  }

  if (prepared.length === 0) {
    res.status(400).json({ error: '没有有效的题目（需含 stem）' });
    return;
  }

  const ids = bulkCreateQuestions(prepared);
  res.json({ ok: true, count: ids.length, ids });
});

/** 导出题为 YAML（图片以 base64 独立字段保存，题干内为 {{image:id}} 占位） */
app.get('/api/questions/export/yaml', requireAuth, requireQuestionAdmin, (req, res) => {
  const statusRaw = typeof req.query.status === 'string' ? req.query.status : 'all';
  const status =
    statusRaw === 'draft' || statusRaw === 'published' || statusRaw === 'pending' ? statusRaw : 'all';
  const subject = typeof req.query.subject === 'string' ? req.query.subject.trim() : undefined;
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;
  const idsRaw = typeof req.query.ids === 'string' ? req.query.ids : '';
  const idList = idsRaw
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);

  let rows;
  if (idList.length > 0) {
    rows = idList
      .map((id) => getQuestionById(id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r));
  } else {
    rows = listQuestionsForExport({ status, subject, q, limit: 5000 });
  }

  const yaml = serializeQuestionsYaml(rows);
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="questions-${stamp}.yaml"`);
  res.send(yaml);
});

/** 从 YAML 批量导入题库 */
app.post('/api/questions/import-yaml', requireAuth, requireQuestionAdmin, (req, res, next) => {
  try {
    const yamlText = String(req.body?.yaml ?? req.body?.text ?? '').trim();
    if (!yamlText) {
      res.status(400).json({ error: '请提供 yaml 字段（YAML 文本）' });
      return;
    }
    const defaultStatus =
      req.body?.defaultStatus === 'draft' ||
      req.body?.defaultStatus === 'published' ||
      req.body?.defaultStatus === 'pending'
        ? req.body.defaultStatus
        : 'published';
    const defaultSubject =
      req.body?.defaultSubject != null ? String(req.body.defaultSubject).trim() || null : null;

    const items = parseQuestionsYaml(yamlText);
    if (items.length === 0) {
      res.status(400).json({ error: 'YAML 中未解析到任何题目' });
      return;
    }

    const prepared: Parameters<typeof bulkCreateQuestions>[0] = [];
    const errors: string[] = [];
    for (let i = 0; i < items.length; i++) {
      try {
        prepared.push(
          yamlItemToPreparedQuestion(items[i], req.user!.id, { defaultStatus, defaultSubject }),
        );
      } catch (e) {
        errors.push(`第 ${i + 1} 题：${e instanceof Error ? e.message : '无效'}`);
      }
    }
    if (prepared.length === 0) {
      res.status(400).json({ error: errors.join('；') || '没有有效题目' });
      return;
    }
    const ids = bulkCreateQuestions(prepared);
    res.json({ ok: true, count: ids.length, ids, skippedErrors: errors });
  } catch (e) {
    next(e);
  }
});

/**
 * 整卷录入：拆题 →（可选）AI 考点与标签 → 关键词匹配知识树 → 全部写入 questions.status=pending，待人审。
 * body: { text, paperTitle?, defaultSubject?, useAiSplit?, analyzeWithAi? }
 */
app.post('/api/questions/paper-ingest-pending', requireAuth, requireQuestionAdmin, async (req, res, next) => {
  try {
    const cfg = resolveActiveAiCredentials();
    const apiKey = cfg?.apiKey || '';
    const result = await ingestPaperTextToPending({
      text: String(req.body?.text ?? ''),
      paperTitle: req.body?.paperTitle != null ? String(req.body.paperTitle) : null,
      defaultSubject: req.body?.defaultSubject != null ? String(req.body.defaultSubject) : null,
      useAiSplit: Boolean(req.body?.useAiSplit),
      analyzeWithAi: req.body?.analyzeWithAi !== false,
      createdBy: req.user!.id,
      apiKey,
      modelId: cfg?.modelId,
      aiConfig: cfg ?? undefined,
      imagePool:
        req.body?.images && typeof req.body.images === 'object' && !Array.isArray(req.body.images)
          ? (req.body.images as Record<string, import('./questionYaml.js').QuestionImageRef>)
          : undefined,
    });
    res.json(result);
  } catch (e) {
    paperIngestError(res, e, next);
  }
});

/** 上传试卷文件并提取正文（docx / pdf / txt） */
app.post(
  '/api/questions/paper-extract-file',
  requireAuth,
  requireQuestionAdmin,
  paperUpload.single('file'),
  async (req, res, next) => {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: '请上传文件' });
        return;
      }
      const originalName = resolveUploadFileName(file.originalname, req.body?.originalFileName);
      if (!isIngestibleExamFileName(originalName)) {
        res.status(400).json({ error: '仅支持 docx / pdf / txt 格式' });
        return;
      }
      const extracted = await extractExamTextFromBuffer(file.buffer, originalName);
      res.json({
        text: extracted.text,
        format: extracted.format,
        charCount: extracted.charCount,
        fileName: examFileBaseName(originalName),
        originalName,
        imageCount: extracted.images ? Object.keys(extracted.images).length : 0,
        images: extracted.images ?? undefined,
      });
    } catch (e) {
      paperIngestError(res, e, next);
    }
  },
);

/** 上传试卷文件 → 拆题入库（pending 待审核） */
app.post(
  '/api/questions/paper-ingest-upload',
  requireAuth,
  requireQuestionAdmin,
  paperUpload.single('file'),
  async (req, res, next) => {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: '请上传文件' });
        return;
      }
      const originalName = resolveUploadFileName(file.originalname, req.body?.originalFileName);
      if (!isIngestibleExamFileName(originalName)) {
        res.status(400).json({ error: '仅支持 docx / pdf / txt 格式' });
        return;
      }
      const extracted = await extractExamTextFromBuffer(file.buffer, originalName);
      const text = extracted.text;
      const defaultTitle = examFileBaseName(originalName);
      const paperTitleRaw = req.body?.paperTitle != null ? String(req.body.paperTitle).trim() : '';
      const paperTitle = paperTitleRaw.slice(0, 200) || defaultTitle;
      const cfg = resolveActiveAiCredentials();
      const apiKey = cfg?.apiKey || '';
      const result = await ingestPaperTextToPending({
        text,
        paperTitle,
        defaultSubject:
          req.body?.defaultSubject != null ? String(req.body.defaultSubject).trim().slice(0, 80) || null : null,
        useAiSplit: req.body?.useAiSplit === 'false' ? false : Boolean(req.body?.useAiSplit ?? true),
        analyzeWithAi: req.body?.analyzeWithAi === 'false' ? false : req.body?.analyzeWithAi !== '0',
        createdBy: req.user!.id,
        sourceRelPath: `upload:${originalName}`,
        apiKey,
        modelId: cfg?.modelId,
        aiConfig: cfg ?? undefined,
        imagePool: extracted.images,
      });
      res.json({ ...result, originalName });
    } catch (e) {
      paperIngestError(res, e, next);
    }
  },
);

/** 中考专题知识树（由本地资料目录结构生成） */
app.get('/api/knowledge/zhongkao-topic-tree', requireAuth, (_req, res) => {
  const payload = buildZhongkaoTopicTree();
  res.json(payload);
});

/** 浏览本地「10.中考浙江科学」资料目录 */
app.get('/api/zhongkao/materials', requireAuth, (req, res) => {
  const pathParam = typeof req.query.path === 'string' ? req.query.path : '';
  res.json(listMaterialDir(pathParam));
});

app.get('/api/zhongkao/materials/preview', requireAuth, async (req, res, next) => {
  try {
    const relPath = typeof req.query.relPath === 'string' ? req.query.relPath : '';
    if (!relPath.trim()) {
      res.status(400).json({ error: '缺少 relPath' });
      return;
    }
    const { text, format, charCount } = await extractMaterialText(relPath);
    const preview = text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
    res.json({ relPath, format, charCount, preview });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '预览失败';
    res.status(400).json({ error: msg });
  }
});

/** 从资料文件拆题入库（pending 待审核） */
app.post('/api/zhongkao/materials/ingest', requireAuth, requireQuestionAdmin, async (req, res, next) => {
  try {
    const relPath = String(req.body?.relPath ?? '').trim();
    if (!relPath || !isIngestibleMaterial(relPath)) {
      res.status(400).json({ error: '请提供可入库的 docx / pdf / txt 文件 relPath' });
      return;
    }
    const { text } = await extractMaterialText(relPath);
    const fileName = relPath.split('/').pop() || relPath;
    const defaultTitle = fileName.replace(/\.(docx|doc|pdf|txt)$/i, '');
    const paperTitle =
      req.body?.paperTitle != null ? String(req.body.paperTitle).trim().slice(0, 200) || null : defaultTitle;
    const cfg = resolveActiveAiCredentials();
    const apiKey = cfg?.apiKey || '';
    const result = await ingestPaperTextToPending({
      text,
      paperTitle,
      defaultSubject:
        req.body?.defaultSubject != null ? String(req.body.defaultSubject).trim().slice(0, 80) || null : '初中科学',
      useAiSplit: Boolean(req.body?.useAiSplit),
      analyzeWithAi: req.body?.analyzeWithAi !== false,
      createdBy: req.user!.id,
      sourceRelPath: relPath,
      apiKey,
      modelId: cfg?.modelId,
      aiConfig: cfg ?? undefined,
    });
    res.json({ ...result, relPath });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '入库失败';
    if (msg.includes('GEMINI_API_KEY') || msg.includes('AI 模型 API') || msg.includes('未配置 AI')) {
      res.status(503).json({ error: msg });
      return;
    }
    if (msg.includes('不存在') || msg.includes('不支持') || msg.includes('未能') || msg.includes('为空') || msg.includes('未解析')) {
      res.status(400).json({ error: msg });
      return;
    }
    next(e);
  }
});

app.get('/api/knowledge/graph', requireAuth, (req, res) => {
  const rows = db
    .prepare('SELECT analysis_json FROM mistakes WHERE user_id = ?')
    .all(req.user!.id) as { analysis_json: string }[];
  const graph = buildCooccurrenceGraph(rows);
  res.json(graph);
});

/** 初中科学内置知识树（可扩充 id / keywords） */
app.get('/api/knowledge/junior-science-tree', requireAuth, (_req, res) => {
  res.json({ tree: JUNIOR_SCIENCE_TREE, version: SCIENCE_TREE_VERSION });
});

/** 将错题分析映射到知识树节点后的命中次数（每题每节点最多计 1 次） */
app.get('/api/knowledge/science-coverage', requireAuth, (req, res) => {
  const rows = db
    .prepare('SELECT analysis_json FROM mistakes WHERE user_id = ?')
    .all(req.user!.id) as { analysis_json: string }[];
  const map = buildScienceTreeCoverage(rows);
  const coverage: Record<string, number> = {};
  for (const [k, v] of map) coverage[k] = v;
  res.json({ coverage, mistakeCount: rows.length });
});

/** 文本 / 知识点标签 → 知识树节点（关键词 + 包含匹配） */
app.post('/api/knowledge/match-science', requireAuth, (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text : '';
  const labels = Array.isArray(req.body?.labels) ? req.body.labels.map((x) => String(x)) : [];
  const fromText = text.trim() ? matchTextToScienceTree(text) : [];
  const fromLabels = matchLabelsToScienceTree(labels);
  const merged = new Map<string, (typeof fromText)[0]>();
  for (const m of [...fromText, ...fromLabels]) {
    const p = merged.get(m.id);
    if (!p || p.score < m.score) merged.set(m.id, m);
  }
  const matches = [...merged.values()].sort((a, b) => b.score - a.score);
  const blob = [text, ...labels].join('\n');
  const enriched = enrichMatchesWithReasons(blob, matches);
  res.json({ matches: enriched });
});

/** 各知识点掌握度（含时间衰减后的 effective、置信度等）；父节点展示值由前端按子树 rollup */
app.get('/api/knowledge/science-mastery', requireAuth, (req, res) => {
  const uid = req.user!.id;
  const detailMap = getScienceMasteryDetail(uid);
  const mastery: Record<string, number> = {};
  const detail: Record<string, MasteryDetailRow> = {};
  for (const [k, v] of detailMap) {
    mastery[k] = v.mastery;
    detail[k] = v;
  }
  const mc = db.prepare('SELECT COUNT(*) AS c FROM mistakes WHERE user_id = ?').get(uid) as { c: number };
  res.json({
    mastery,
    detail,
    mistakeCount: mc.c,
    treeVersion: SCIENCE_TREE_VERSION,
  });
});

/**
 * 自主练习结果（做对加分 / 做错扣分），供题库、随堂测等调用。
 * body: { nodeIds: string[], correct: boolean, clientDedupeKey?: string }
 */
app.post('/api/knowledge/practice', requireAuth, (req, res) => {
  const nodeIds = Array.isArray(req.body?.nodeIds) ? req.body.nodeIds.map((x: unknown) => String(x)) : [];
  if (nodeIds.length === 0) {
    res.status(400).json({ error: 'nodeIds 不能为空' });
    return;
  }
  const correct = Boolean(req.body?.correct);
  const dedupeKey =
    typeof req.body?.clientDedupeKey === 'string' ? req.body.clientDedupeKey.trim().slice(0, 128) : '';
  if (dedupeKey && !tryConsumePracticeDedupe(req.user!.id, dedupeKey)) {
    res.json({ ok: true, duplicate: true });
    return;
  }
  if (correct) applyScienceCorrect(req.user!.id, nodeIds);
  else applyScienceWrong(req.user!.id, nodeIds);
  res.json({ ok: true, duplicate: false });
});

function csvEscapeCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** 导出掌握度明细（UTF-8 BOM，Excel 可打开） */
app.get('/api/knowledge/export/science-mastery', requireAuth, (req, res) => {
  const uid = req.user!.id;
  const detailMap = getScienceMasteryDetail(uid);
  const flat = getFlatScienceNodes();
  const header =
    'node_id,label,path,mastery_raw,effective,wrong,correct,streak,exposure,confidence,last_wrong_at,last_correct_at';
  const lines = [header];
  for (const n of flat) {
    const d = detailMap.get(n.id);
    if (!d) continue;
    lines.push(
      [
        csvEscapeCell(n.id),
        csvEscapeCell(n.label),
        csvEscapeCell(n.path),
        csvEscapeCell(d.mastery),
        csvEscapeCell(d.effective),
        csvEscapeCell(d.wrong_count),
        csvEscapeCell(d.correct_count),
        csvEscapeCell(d.streak_correct),
        csvEscapeCell(d.exposure_count),
        csvEscapeCell(d.confidence),
        csvEscapeCell(d.last_wrong_at),
        csvEscapeCell(d.last_correct_at),
      ].join(','),
    );
  }
  const body = '\uFEFF' + lines.join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="science-mastery.csv"');
  res.send(body);
});

/**
 * 按知识点选题（题库 body 可含 scienceNodeIds；否则用语干关键词匹配树）
 * GET ?nodeId=&limit=
 */
app.get('/api/knowledge/practice-candidates', requireAuth, (req, res) => {
  const nodeId = typeof req.query.nodeId === 'string' ? req.query.nodeId.trim() : '';
  const limit = Math.min(30, Math.max(1, Number(req.query.limit) || 6));
  if (!nodeId) {
    res.status(400).json({ error: 'nodeId 必填' });
    return;
  }
  const rows = db
    .prepare(
      `SELECT id, title, stem, body_json FROM questions WHERE status = 'published' ORDER BY id DESC LIMIT 500`,
    )
    .all() as { id: number; title: string | null; stem: string; body_json: string }[];
  const items: { id: number; title: string | null; stem: string }[] = [];
  for (const row of rows) {
    const body = parseQuestionBodyJson(row.body_json);
    const tagged = body.scienceNodeIds;
    let hit = false;
    if (Array.isArray(tagged) && tagged.some((x) => String(x) === nodeId)) hit = true;
    if (!hit) {
      const stemHits = matchTextToScienceTree(row.stem, 16);
      if (stemHits.some((h) => h.id === nodeId && h.score >= 28)) hit = true;
    }
    if (hit) {
      items.push({ id: row.id, title: row.title, stem: row.stem });
      if (items.length >= limit) break;
    }
  }
  res.json({ items, treeVersion: SCIENCE_TREE_VERSION });
});

app.post('/api/knowledge/ai-insight', requireAuth, async (req, res, next) => {
  try {
    const cfg = requireAiConfig(res);
    if (!cfg) return;
    const key = cfg.apiKey;
    const rows = db
      .prepare('SELECT analysis_json FROM mistakes WHERE user_id = ? ORDER BY id DESC LIMIT 200')
      .all(req.user!.id) as { analysis_json: string }[];
    const graph = buildCooccurrenceGraph(rows);
    const summaries: string[] = [];
    for (const row of rows.slice(0, 40)) {
      try {
        const a = JSON.parse(row.analysis_json) as { summary?: string };
        if (a.summary) summaries.push(a.summary);
      } catch {
        /* skip */
      }
    }
    const markdown = await generateKnowledgeInsight(
      key,
      {
        nodes: graph.nodes.map((n) => ({ label: n.label, count: n.count })),
        edges: graph.edges.map((e) => ({ source: e.source, target: e.target, weight: e.weight })),
        summaries,
      },
      cfg.modelId,
      cfg,
    );
    res.json({ markdown });
  } catch (e) {
    next(e);
  }
});

app.get('/api/admin/users', requireAuth, requireSuperAdmin, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT u.id, u.username, u.role, u.approved, u.created_at,
        (SELECT COUNT(*) FROM mistakes m WHERE m.user_id = u.id) AS mistake_count
       FROM users u ORDER BY u.id ASC`,
    )
    .all() as {
      id: number;
      username: string;
      role: string;
      approved: number;
      created_at: string;
      mistake_count: number;
    }[];
  res.json({
    users: rows.map((u) => ({
      id: u.id,
      username: u.username,
      role: u.role,
      approved: Boolean(u.approved),
      created_at: u.created_at,
      mistake_count: u.mistake_count,
    })),
  });
});

app.patch('/api/admin/users/:id', requireAuth, requireSuperAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: '无效 id' });
    return;
  }
  const target = getUserById(id);
  if (!target) {
    res.status(404).json({ error: '用户不存在' });
    return;
  }

  const patch: { role?: string; approved?: boolean } = {};

  if (req.body?.role !== undefined) {
    const roleInput = String(req.body.role);
    if (!isValidRoleInput(roleInput)) {
      res.status(400).json({ error: '无效角色，可选：user、question_admin、super_admin' });
      return;
    }
    const nextRole = normalizeRole(roleInput);
    if (req.user!.id === id && !isSuperAdminRole(nextRole)) {
      res.status(400).json({ error: '不能取消自己的超级管理员身份' });
      return;
    }
    if (isSuperAdminRole(target.role) && !isSuperAdminRole(nextRole) && countSuperAdmins() <= 1) {
      res.status(400).json({ error: '至少需要保留一名超级管理员' });
      return;
    }
    patch.role = nextRole;
  }

  if (req.body?.approved !== undefined) {
    patch.approved = Boolean(req.body.approved);
  }

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: '无有效更新字段' });
    return;
  }

  const updated = updateUserAdminFields(id, patch);
  if (!updated) {
    res.status(404).json({ error: '用户不存在' });
    return;
  }
  res.json({ user: publicUserPayload(updated) });
});

app.get('/api/admin/ai-models', requireAuth, requireSuperAdmin, (_req, res) => {
  const models = listAiModelsForAdmin();
  const active = resolveActiveAiCredentials();
  res.json({
    models,
    active: active
      ? {
          source: active.source,
          configId: active.configId ?? null,
          configName: active.configName ?? null,
          provider: active.provider,
          modelId: active.modelId,
        }
      : null,
    envFallback: getEnvAiFallbackStatus(),
  });
});

app.post('/api/admin/ai-models', requireAuth, requireSuperAdmin, (req, res, next) => {
  try {
    const created = createAiModelFromInput({
      name: String(req.body?.name ?? ''),
      provider: String(req.body?.provider ?? 'gemini'),
      modelId: String(req.body?.modelId ?? req.body?.model_id ?? ''),
      apiKey: String(req.body?.apiKey ?? req.body?.api_key ?? ''),
      baseUrl: req.body?.baseUrl != null ? String(req.body.baseUrl) : req.body?.base_url != null ? String(req.body.base_url) : null,
      enabled: req.body?.enabled !== false,
      isDefault: Boolean(req.body?.isDefault ?? req.body?.is_default),
      note: req.body?.note != null ? String(req.body.note) : null,
    });
    res.status(201).json({ model: created });
  } catch (e) {
    next(e);
  }
});

app.patch('/api/admin/ai-models/:id', requireAuth, requireSuperAdmin, (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: '无效 id' });
      return;
    }
    const updated = updateAiModelFromInput(id, {
      name: req.body?.name != null ? String(req.body.name) : undefined,
      provider: req.body?.provider != null ? String(req.body.provider) : undefined,
      modelId:
        req.body?.modelId != null
          ? String(req.body.modelId)
          : req.body?.model_id != null
            ? String(req.body.model_id)
            : undefined,
      apiKey:
        req.body?.apiKey != null
          ? String(req.body.apiKey)
          : req.body?.api_key != null
            ? String(req.body.api_key)
            : undefined,
      baseUrl:
        req.body?.baseUrl !== undefined
          ? req.body.baseUrl != null
            ? String(req.body.baseUrl)
            : null
          : req.body?.base_url !== undefined
            ? req.body.base_url != null
              ? String(req.body.base_url)
              : null
            : undefined,
      enabled: typeof req.body?.enabled === 'boolean' ? req.body.enabled : undefined,
      isDefault:
        typeof req.body?.isDefault === 'boolean'
          ? req.body.isDefault
          : typeof req.body?.is_default === 'boolean'
            ? req.body.is_default
            : undefined,
      note: req.body?.note !== undefined ? (req.body.note != null ? String(req.body.note) : null) : undefined,
    });
    if (!updated) {
      res.status(404).json({ error: '配置不存在' });
      return;
    }
    res.json({ model: updated });
  } catch (e) {
    next(e);
  }
});

app.post('/api/admin/ai-models/test', requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const configId = req.body?.configId != null ? Number(req.body.configId) : undefined;
    const resolved = resolveAiModelForTest({
      configId: Number.isInteger(configId) && configId! > 0 ? configId : undefined,
      provider: req.body?.provider != null ? String(req.body.provider) : undefined,
      modelId:
        req.body?.modelId != null
          ? String(req.body.modelId)
          : req.body?.model_id != null
            ? String(req.body.model_id)
            : undefined,
      apiKey:
        req.body?.apiKey != null
          ? String(req.body.apiKey)
          : req.body?.api_key != null
            ? String(req.body.api_key)
            : undefined,
      baseUrl:
        req.body?.baseUrl !== undefined
          ? req.body.baseUrl != null
            ? String(req.body.baseUrl)
            : null
          : req.body?.base_url !== undefined
            ? req.body.base_url != null
              ? String(req.body.base_url)
              : null
            : undefined,
    });
    const result = await testAiModelConnection(resolved);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

app.post('/api/admin/ai-models/:id/test', requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: '无效 id' });
      return;
    }
    const resolved = resolveAiModelForTest({ configId: id });
    const result = await testAiModelConnection(resolved);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

app.post('/api/admin/ai-models/:id/set-default', requireAuth, requireSuperAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: '无效 id' });
    return;
  }
  const model = markAiModelDefault(id);
  if (!model) {
    res.status(404).json({ error: '配置不存在' });
    return;
  }
  res.json({ model });
});

app.delete('/api/admin/ai-models/:id', requireAuth, requireSuperAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: '无效 id' });
    return;
  }
  if (!removeAiModel(id)) {
    res.status(404).json({ error: '配置不存在' });
    return;
  }
  res.json({ ok: true });
});

app.get('/api/admin/mineru-settings', requireAuth, requireSuperAdmin, async (_req, res, next) => {
  try {
    const settings = await getMineruSettingsPublic();
    res.json({ settings });
  } catch (e) {
    next(e);
  }
});

app.patch('/api/admin/mineru-settings', requireAuth, requireSuperAdmin, (req, res, next) => {
  try {
    const body = req.body ?? {};
    const patch: Record<string, unknown> = {};
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
    if (body.apiUrl != null) patch.apiUrl = String(body.apiUrl);
    if (body.lang != null) patch.lang = String(body.lang);
    if (body.parseMethod != null) patch.parseMethod = String(body.parseMethod);
    if (typeof body.fallbackVision === 'boolean') patch.fallbackVision = body.fallbackVision;
    if (typeof body.llmCorrect === 'boolean') patch.llmCorrect = body.llmCorrect;
    if (body.timeoutMs != null) patch.timeoutMs = Number(body.timeoutMs);
    if (body.backend != null) patch.backend = String(body.backend);
    if (body.apiMode != null) patch.apiMode = String(body.apiMode);
    if (body.apiKey != null) patch.apiKey = String(body.apiKey);
    updateMineruSettings(patch);
    void getMineruSettingsPublic()
      .then((settings) => res.json({ settings }))
      .catch(next);
  } catch (e) {
    next(e);
  }
});

app.post('/api/admin/mineru-settings/test', requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const settings = await getMineruSettingsPublic();
    const apiUrl = body.apiUrl != null ? String(body.apiUrl).trim() : settings.apiUrl;
    const apiMode =
      body.apiMode === 'local' || body.apiMode === 'cloud_v4' || body.apiMode === 'cloud_agent'
        ? body.apiMode
        : settings.apiMode;
    const url = apiUrl;
    if (!url) {
      res.status(400).json({ ok: false, message: '请先填写 MinerU API 地址' });
      return;
    }
    if (apiMode === 'cloud_v4' && !String(body.apiKey ?? '').trim() && !settings.hasApiKey) {
      res.status(400).json({ ok: false, message: 'MinerU 云端 API 请先填写 API Token' });
      return;
    }
    const result = await checkMineruHealthDetailed({
      apiUrl: url,
      apiMode,
      apiKey: body.apiKey != null ? String(body.apiKey).trim() : undefined,
    });
    res.json({
      ok: result.ok,
      message: result.message,
      detail: result.detail,
      url,
    });
  } catch (e) {
    next(e);
  }
});

const distDir = path.join(root, 'dist');
const distIndex = path.join(distDir, 'index.html');
const serveStatic =
  fs.existsSync(distIndex) &&
  (process.env.SERVE_STATIC === '1' ||
    (process.env.NODE_ENV === 'production' && process.env.SERVE_STATIC !== '0'));

if (serveStatic) {
  app.use(express.static(distDir, { index: false }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      next();
      return;
    }
    res.sendFile(distIndex);
  });
} else {
  app.get('/', (_req, res) => {
    res.status(200).json({
      ok: true,
      hint: '当前为 API 模式，浏览器请访问前端页面，或运行 npm run start:lan 启动完整服务。',
      devWeb: `http://${lanHost()}:3000`,
      prodWeb: `http://${lanHost()}:8787`,
      health: '/api/health',
    });
  });
}

function lanHost(): string {
  if (process.env.LAN_HOST) return process.env.LAN_HOST;
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    if (!list) continue;
    for (const net of list) {
      if (net.family !== 'IPv4' || net.internal) continue;
      if (net.address.startsWith('192.168.') || net.address.startsWith('10.')) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

function printListenUrls(port: number, mode: 'api' | 'full') {
  const ip = lanHost();
  if (mode === 'full') {
    console.log(`[zhishitree] 局域网访问: http://${ip}:${port}/`);
    console.log(`[zhishitree] 本机访问:   http://127.0.0.1:${port}/`);
  } else {
    console.log(`[zhishitree] API 本机:   http://127.0.0.1:${port}/api/health`);
    console.log(`[zhishitree] 前端开发:   http://${ip}:3000/ （8787 仅为 API，不能直接打开网页）`);
    console.log(`[zhishitree] 局域网完整: 请先运行 npm run start:lan → http://${ip}:8787/`);
  }
}

function isSqliteConstraint(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = 'code' in err ? String((err as { code: string }).code) : '';
  return code.includes('SQLITE_CONSTRAINT');
}

/** 统一 JSON 错误响应，避免 body-parser / 未捕获异常变成纯文本 Internal Server Error */
app.use(
  (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: '请求体不是有效的 JSON，请检查客户端是否发送了合法 JSON' });
      return;
    }
    if (err instanceof SyntaxError && err.message.includes('JSON')) {
      res.status(400).json({ error: '请求体 JSON 解析失败' });
      return;
    }

    if (isSqliteConstraint(err)) {
      console.error('[zhishitree api] SQLite constraint:', err);
      res.status(409).json({ error: '数据冲突（例如用户名已存在）' });
      return;
    }

    console.error('[zhishitree api]', err);
    const status =
      err && typeof err === 'object' && 'status' in err && typeof (err as { status: unknown }).status === 'number'
        ? (err as { status: number }).status
        : 500;
    const safeStatus = status >= 400 && status < 600 ? status : 500;
    const expose =
      process.env.NODE_ENV !== 'production' && err instanceof Error ? err.message : '';
    res.status(safeStatus).json({
      error:
        safeStatus === 500
          ? expose
            ? `服务器内部错误：${expose}`
            : '服务器内部错误'
          : err instanceof Error
            ? err.message
            : '请求失败',
    });
  },
);

const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  printListenUrls(PORT, serveStatic ? 'full' : 'api');
});
