/**
 * MinerU 文档/图片 OCR
 * - 本地：mineru-api --host 0.0.0.0 --port 8000
 * - 云端 v4：https://mineru.net/api/v4（需 API Token）
 * - 云端 Agent：https://mineru.net/api/v1/agent（免 Token，IP 限频）
 */

import { unzipSync } from 'fflate';
import {
  parseMineruImagesDict,
  parseMineruImagesFromZipEntries,
  type ParsedMineruImage,
} from './examFigureExtract.js';
import {
  getEffectiveMineruConfig,
  isMineruOcrActive,
  resolveMineruBackend,
  type MineruApiMode,
  MINERU_DEFAULT_URLS,
} from './mineruSettings.js';

export type MineruOcrResult = {
  markdown: string;
  fileName: string;
  /** MinerU 裁剪的配图（电路图等） */
  images: ParsedMineruImage[];
};

export type MineruHealthOptions = {
  apiUrl?: string;
  apiMode?: MineruApiMode;
  apiKey?: string;
};

function baseUrlFrom(opts?: MineruHealthOptions): string | null {
  const cfg = getEffectiveMineruConfig();
  const url = (opts?.apiUrl?.trim() || cfg.apiUrl)?.trim();
  if (!url) return null;
  return url.replace(/\/$/, '');
}

function apiKeyFrom(opts?: MineruHealthOptions): string {
  return opts?.apiKey?.trim() || getEffectiveMineruConfig().apiKey;
}

function apiModeFrom(opts?: MineruHealthOptions): MineruApiMode {
  return opts?.apiMode || getEffectiveMineruConfig().apiMode;
}

function authHeaders(apiKey: string): Record<string, string> {
  if (!apiKey) return {};
  return { Authorization: `Bearer ${apiKey}` };
}

export function isMineruOcrEnabled(): boolean {
  return isMineruOcrActive();
}

function extensionForMime(mimeType: string): string {
  const m = mimeType.toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  if (m.includes('bmp')) return 'bmp';
  return 'jpg';
}

function extractMarkdownFromMineruResponse(data: unknown): string {
  const root = data as Record<string, unknown>;
  const parts: string[] = [];

  const results = root.results as Record<string, Record<string, unknown>> | undefined;
  if (results && typeof results === 'object') {
    for (const entry of Object.values(results)) {
      if (!entry || typeof entry !== 'object') continue;
      const md = entry.md_content ?? entry.md;
      if (typeof md === 'string' && md.trim()) parts.push(md.trim());
    }
  }

  if (typeof root.md_content === 'string' && root.md_content.trim()) {
    parts.push(root.md_content.trim());
  }

  return parts.join('\n\n').trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 从 Markdown 中的 http(s) 图片链接拉取并转为 base64 */
async function fetchMarkdownEmbeddedImages(markdown: string): Promise<ParsedMineruImage[]> {
  const urls = new Set<string>();
  const re = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    urls.add(m[1].trim());
  }
  const out: ParsedMineruImage[] = [];
  for (const url of urls) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      const mime = r.headers.get('content-type')?.split(';')[0]?.trim() || mimeFromUrl(url);
      out.push({
        name: url.split('/').pop() || `img-${out.length + 1}`,
        mime,
        data: buf.toString('base64'),
      });
    } catch {
      /* optional */
    }
  }
  return out;
}

function mimeFromUrl(url: string): string {
  const n = url.toLowerCase();
  if (n.includes('.png')) return 'image/png';
  if (n.includes('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function markdownFromZipBuffer(buffer: Uint8Array): string {
  const files = unzipSync(buffer);
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('full.md') || name === 'full.md') {
      return new TextDecoder().decode(data).trim();
    }
  }
  throw new Error('MinerU 云端 ZIP 中未找到 full.md');
}

function unpackZipBuffer(buffer: Uint8Array): { markdown: string; images: ParsedMineruImage[] } {
  const files = unzipSync(buffer);
  const markdown = markdownFromZipBuffer(buffer);
  const images = parseMineruImagesFromZipEntries(files);
  return { markdown, images };
}

async function fetchZipResult(zipUrl: string): Promise<{ markdown: string; images: ParsedMineruImage[] }> {
  const r = await fetch(zipUrl, { signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`下载 MinerU 结果失败（HTTP ${r.status}）`);
  const buf = new Uint8Array(await r.arrayBuffer());
  return unpackZipBuffer(buf);
}

function imagesFromMineruEntry(entry: Record<string, unknown> | undefined): ParsedMineruImage[] {
  if (!entry || typeof entry !== 'object') return [];
  const raw = entry.images as Record<string, string> | undefined;
  return parseMineruImagesDict(raw);
}

async function parseImageLocal(
  base64: string,
  mimeType: string,
  cfg: ReturnType<typeof getEffectiveMineruConfig>,
): Promise<MineruOcrResult> {
  const base = baseUrlFrom({ apiUrl: cfg.apiUrl });
  if (!base) throw new Error('未配置 MinerU API 地址');

  const raw = base64.replace(/^data:[^;]+;base64,/, '').trim();
  const buffer = Buffer.from(raw, 'base64');
  if (!buffer.length) throw new Error('图片数据为空');

  const ext = extensionForMime(mimeType);
  const fileName = `question.${ext}`;
  const url = `${base}/file_parse`;

  const form = new FormData();
  form.append('files', new Blob([buffer], { type: mimeType || 'image/jpeg' }), fileName);
  form.append('return_md', 'true');
  form.append('table_enable', 'true');
  form.append('formula_enable', 'true');
  form.append('return_images', 'true');
  form.append('image_analysis', 'true');
  form.append('return_middle_json', 'false');
  form.append('return_model_output', 'false');
  form.append('return_content_list', 'false');
  form.append('lang_list', cfg.lang || 'ch');
  form.append('parse_method', cfg.parseMethod || 'auto');
  form.append('backend', resolveMineruBackend(cfg.backend));

  const headers = authHeaders(cfg.apiKey);
  const r = await fetch(url, {
    method: 'POST',
    headers,
    body: form,
    signal: AbortSignal.timeout(cfg.timeoutMs || 180_000),
  });

  const text = await r.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`MinerU 返回非 JSON：${text.slice(0, 200)}`);
  }

  if (!r.ok) {
    const err = data as { detail?: string; message?: string; error?: string };
    const msg = err.detail || err.message || err.error || text.slice(0, 300);
    throw new Error(`MinerU 识别失败（HTTP ${r.status}）：${msg}`);
  }

  const markdown = extractMarkdownFromMineruResponse(data);
  if (!markdown) throw new Error('MinerU 未返回 Markdown 正文（md_content 为空）');

  const root = data as Record<string, unknown>;
  const results = root.results as Record<string, Record<string, unknown>> | undefined;
  let images: ParsedMineruImage[] = [];
  if (results && typeof results === 'object') {
    for (const entry of Object.values(results)) {
      const parsed = imagesFromMineruEntry(entry);
      if (parsed.length) images = parsed;
    }
  }

  console.log(
    `[zhishitree] MinerU 本地 OCR 成功，长度 ${markdown.length}，配图 ${images.length} 张`,
  );
  return { markdown, fileName, images };
}

async function parseImageCloudAgent(
  base64: string,
  mimeType: string,
  cfg: ReturnType<typeof getEffectiveMineruConfig>,
): Promise<MineruOcrResult> {
  const base = (cfg.apiUrl?.trim() || MINERU_DEFAULT_URLS.cloud_agent).replace(/\/$/, '');
  const raw = base64.replace(/^data:[^;]+;base64,/, '').trim();
  const buffer = Buffer.from(raw, 'base64');
  if (!buffer.length) throw new Error('图片数据为空');

  const ext = extensionForMime(mimeType);
  const fileName = `question.${ext}`;

  const createRes = await fetch(`${base}/parse/file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_name: fileName,
      language: cfg.lang || 'ch',
      enable_table: true,
      enable_formula: true,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const createText = await createRes.text();
  let createData = {} as { code?: number; msg?: string; data?: { task_id?: string; file_url?: string } };
  try {
    createData = createText ? JSON.parse(createText) : {};
  } catch {
    throw new Error(`MinerU Agent 返回非 JSON：${createText.slice(0, 200)}`);
  }
  if (!createRes.ok || createData.code !== 0) {
    throw new Error(`MinerU Agent 创建任务失败：${createData.msg || createText.slice(0, 200)}`);
  }

  const taskId = createData.data?.task_id;
  const fileUrl = createData.data?.file_url;
  if (!taskId || !fileUrl) throw new Error('MinerU Agent 未返回 task_id 或 file_url');

  const putRes = await fetch(fileUrl, {
    method: 'PUT',
    body: buffer,
    signal: AbortSignal.timeout(120_000),
  });
  if (!putRes.ok) {
    throw new Error(`MinerU Agent 上传文件失败（HTTP ${putRes.status}）`);
  }

  const deadline = Date.now() + (cfg.timeoutMs || 180_000);
  while (Date.now() < deadline) {
    const pollRes = await fetch(`${base}/parse/${taskId}`, { signal: AbortSignal.timeout(30_000) });
    const pollText = await pollRes.text();
    let pollData = {} as {
      code?: number;
      msg?: string;
      data?: { state?: string; markdown_url?: string; err_msg?: string };
    };
    try {
      pollData = pollText ? JSON.parse(pollText) : {};
    } catch {
      throw new Error(`MinerU Agent 轮询返回非 JSON：${pollText.slice(0, 200)}`);
    }
    if (!pollRes.ok || pollData.code !== 0) {
      throw new Error(`MinerU Agent 查询失败：${pollData.msg || pollText.slice(0, 200)}`);
    }

    const state = pollData.data?.state;
    if (state === 'done') {
      const mdUrl = pollData.data?.markdown_url;
      if (!mdUrl) throw new Error('MinerU Agent 完成但未返回 markdown_url');
      const mdRes = await fetch(mdUrl, { signal: AbortSignal.timeout(60_000) });
      if (!mdRes.ok) throw new Error(`下载 Markdown 失败（HTTP ${mdRes.status}）`);
      const markdown = (await mdRes.text()).trim();
      if (!markdown) throw new Error('MinerU Agent Markdown 为空');
      const images = await fetchMarkdownEmbeddedImages(markdown);
      console.log(
        `[zhishitree] MinerU Agent OCR 成功，长度 ${markdown.length}，配图 ${images.length} 张`,
      );
      return { markdown, fileName, images };
    }
    if (state === 'failed') {
      throw new Error(`MinerU Agent 解析失败：${pollData.data?.err_msg || '未知错误'}`);
    }
    await sleep(2000);
  }
  throw new Error('MinerU Agent 解析超时');
}

async function parseImageCloudV4(
  base64: string,
  mimeType: string,
  cfg: ReturnType<typeof getEffectiveMineruConfig>,
): Promise<MineruOcrResult> {
  if (!cfg.apiKey) throw new Error('MinerU 云端 API 未配置 Token');

  const base = (cfg.apiUrl?.trim() || MINERU_DEFAULT_URLS.cloud_v4).replace(/\/$/, '');
  const raw = base64.replace(/^data:[^;]+;base64,/, '').trim();
  const buffer = Buffer.from(raw, 'base64');
  if (!buffer.length) throw new Error('图片数据为空');

  const ext = extensionForMime(mimeType);
  const fileName = `question.${ext}`;
  const dataId = `zt_${Date.now()}`;

  const batchRes = await fetch(`${base}/file-urls/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(cfg.apiKey),
    },
    body: JSON.stringify({
      enable_formula: true,
      enable_table: true,
      language: cfg.lang || 'ch',
      model_version: 'vlm',
      files: [{ name: fileName, data_id: dataId, is_ocr: true }],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const batchText = await batchRes.text();
  let batchData = {} as {
    code?: number;
    msg?: string;
    data?: { batch_id?: string; file_urls?: string[] };
  };
  try {
    batchData = batchText ? JSON.parse(batchText) : {};
  } catch {
    throw new Error(`MinerU 云端返回非 JSON：${batchText.slice(0, 200)}`);
  }
  if (!batchRes.ok || batchData.code !== 0) {
    throw new Error(`MinerU 云端申请上传失败：${batchData.msg || batchText.slice(0, 200)}`);
  }

  const batchId = batchData.data?.batch_id;
  const uploadUrl = batchData.data?.file_urls?.[0];
  if (!batchId || !uploadUrl) throw new Error('MinerU 云端未返回 batch_id 或上传地址');

  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    body: buffer,
    signal: AbortSignal.timeout(120_000),
  });
  if (!putRes.ok) {
    throw new Error(`MinerU 云端上传文件失败（HTTP ${putRes.status}）`);
  }

  const deadline = Date.now() + (cfg.timeoutMs || 180_000);
  while (Date.now() < deadline) {
    const pollRes = await fetch(`${base}/extract-results/batch/${batchId}`, {
      headers: authHeaders(cfg.apiKey),
      signal: AbortSignal.timeout(30_000),
    });
    const pollText = await pollRes.text();
    let pollData = {} as {
      code?: number;
      msg?: string;
      data?: {
        extract_result?: Array<{
          state?: string;
          full_zip_url?: string;
          err_msg?: string;
          data_id?: string;
        }>;
      };
    };
    try {
      pollData = pollText ? JSON.parse(pollText) : {};
    } catch {
      throw new Error(`MinerU 云端轮询返回非 JSON：${pollText.slice(0, 200)}`);
    }
    if (!pollRes.ok || pollData.code !== 0) {
      throw new Error(`MinerU 云端查询失败：${pollData.msg || pollText.slice(0, 200)}`);
    }

    const results = pollData.data?.extract_result ?? [];
    const mine =
      results.find((r) => r.data_id === dataId) ?? results.find((r) => r.state) ?? results[0];
    const state = mine?.state;
    if (state === 'done') {
      const zipUrl = mine?.full_zip_url;
      if (!zipUrl) throw new Error('MinerU 云端完成但未返回 full_zip_url');
      const zipResult = await fetchZipResult(zipUrl);
      console.log(
        `[zhishitree] MinerU 云端 OCR 成功，长度 ${zipResult.markdown.length}，配图 ${zipResult.images.length} 张`,
      );
      return { markdown: zipResult.markdown, fileName, images: zipResult.images };
    }
    if (state === 'failed') {
      throw new Error(`MinerU 云端解析失败：${mine?.err_msg || '未知错误'}`);
    }
    await sleep(3000);
  }
  throw new Error('MinerU 云端解析超时');
}

/** 调用 MinerU 解析单张题目图片（本地失败时自动尝试云端 Agent） */
export async function parseImageWithMineru(
  base64: string,
  mimeType: string,
): Promise<MineruOcrResult> {
  const cfg = getEffectiveMineruConfig();
  try {
    switch (cfg.apiMode) {
      case 'cloud_v4':
        return await parseImageCloudV4(base64, mimeType, cfg);
      case 'cloud_agent':
        return await parseImageCloudAgent(base64, mimeType, cfg);
      default:
        return await parseImageLocal(base64, mimeType, cfg);
    }
  } catch (localErr) {
    if (cfg.apiMode !== 'local') throw localErr;
    console.warn('[zhishitree] MinerU 本地不可用，自动改用云端 Agent:', localErr);
    const agentCfg = { ...cfg, apiUrl: MINERU_DEFAULT_URLS.cloud_agent, apiMode: 'cloud_agent' as MineruApiMode };
    return await parseImageCloudAgent(base64, mimeType, agentCfg);
  }
}

export type MineruHealthResult = {
  ok: boolean;
  message: string;
  detail?: string;
};

function connectionHint(base: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error && 'cause' in err ? String((err as { cause?: unknown }).cause) : '';
  const combined = `${msg} ${cause}`.toLowerCase();
  if (
    combined.includes('econnrefused') ||
    combined.includes('connect') ||
    combined.includes('无法连接') ||
    combined.includes('fetch failed') ||
    combined.includes('network')
  ) {
    return `无法访问 ${base}：端口无服务或地址错误。若在本机运行，请先执行 mineru-api --host 0.0.0.0 --port 8000；若在另一台机器，请填写该机 IP（勿用 127.0.0.1）。`;
  }
  if (combined.includes('timeout') || combined.includes('aborted')) {
    return `连接 ${base} 超时，请检查 MinerU 是否启动、防火墙是否放行端口。`;
  }
  return msg || '未知网络错误';
}

/** 健康检查（返回详细原因，便于管理后台展示） */
export async function checkMineruHealthDetailed(opts?: MineruHealthOptions): Promise<MineruHealthResult> {
  const mode = apiModeFrom(opts);
  const base = baseUrlFrom(opts);
  if (!base) {
    return { ok: false, message: '未配置 API 地址', detail: '请填写 MinerU API 根地址' };
  }

  try {
    if (mode === 'local') {
      const headers = authHeaders(apiKeyFrom(opts));
      const paths = ['/health', '/docs', '/'];
      let lastErr: unknown = null;
      for (const path of paths) {
        try {
          const r = await fetch(`${base}${path}`, {
            headers,
            signal: AbortSignal.timeout(6000),
          });
          if (r.ok) {
            return { ok: true, message: '本地 mineru-api 连接正常' };
          }
          lastErr = new Error(`HTTP ${r.status} ${path}`);
        } catch (e) {
          lastErr = e;
        }
      }
      return {
        ok: false,
        message: '无法连接本地 mineru-api',
        detail: connectionHint(base, lastErr),
      };
    }
    if (mode === 'cloud_agent') {
      const r = await fetch(`${base}/parse/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_name: 'healthcheck.jpg' }),
        signal: AbortSignal.timeout(8000),
      });
      const text = await r.text();
      try {
        const data = JSON.parse(text) as { code?: number; msg?: string };
        if (r.ok && data.code === 0) {
          return { ok: true, message: 'MinerU Agent API 连接正常' };
        }
        return {
          ok: false,
          message: 'MinerU Agent API 响应异常',
          detail: data.msg || text.slice(0, 200),
        };
      } catch {
        return { ok: false, message: 'MinerU Agent API 返回非 JSON', detail: text.slice(0, 200) };
      }
    }
    const apiKey = apiKeyFrom(opts);
    if (!apiKey) {
      return { ok: false, message: '未配置 API Token', detail: 'MinerU 云端 API 需在管理后台填写 Token' };
    }
    const r = await fetch(`${base}/file-urls/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(apiKey),
      },
      body: JSON.stringify({ files: [{ name: 'healthcheck.jpg', data_id: 'health' }] }),
      signal: AbortSignal.timeout(8000),
    });
    const text = await r.text();
    try {
      const data = JSON.parse(text) as { code?: number; msg?: string };
      if (r.ok && (data.code === 0 || text.includes('batch_id'))) {
        return { ok: true, message: 'MinerU 云端 API 连接正常' };
      }
      return {
        ok: false,
        message: 'MinerU 云端 API 认证或参数失败',
        detail: data.msg || text.slice(0, 200),
      };
    } catch {
      return { ok: false, message: 'MinerU 云端 API 返回异常', detail: text.slice(0, 200) };
    }
  } catch (e) {
    return {
      ok: false,
      message: '连接检测失败',
      detail: connectionHint(base, e),
    };
  }
}

/** 健康检查（布尔，兼容旧调用） */
export async function checkMineruHealth(opts?: MineruHealthOptions): Promise<boolean> {
  return checkMineruHealthDetailed(opts).ok;
}
