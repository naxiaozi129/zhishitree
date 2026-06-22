/**
 * exam-paper-recognition 能力中心（HTTP 8080）代理
 *
 * 复用 Cursor Skill 同名识别服务（仓库 E:\mineru识别测试，默认 http://127.0.0.1:8080），
 * 走 parse(cloud_precision+OCR) → 内置 cleanup → AI validate(GLM) 全流程。
 *
 * 文档：.cursor/skills/exam-paper-recognition/SKILL.md / reference.md
 */

export const EXAM_RECOGNITION_DEFAULT_URL = 'http://127.0.0.1:8080';

export type ExamRecognitionResult = {
  markdown: string;
  imageCount: number;
  llmValidated: boolean;
  correctionCount: number;
  llmWarning?: string;
  mode?: string;
  /** 服务端裁剪出的独立配图（base64，已下载到本端） */
  figures?: { name: string; mime: string; data: string }[];
};

export type ExamRecognitionHealth = {
  ok: boolean;
  message: string;
  detail?: string;
};

export type ExamServiceHealthPayload = ExamRecognitionHealth & {
  enabled: boolean;
};

function baseUrl(): string {
  const raw = process.env.EXAM_RECOGNITION_API_URL?.trim() || EXAM_RECOGNITION_DEFAULT_URL;
  return raw.replace(/\/$/, '');
}

function timeoutMs(): number {
  const sec = Number(process.env.EXAM_RECOGNITION_TIMEOUT || 600);
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 600_000;
}

function pollIntervalMs(): number {
  const sec = Number(process.env.EXAM_RECOGNITION_POLL_INTERVAL || 2);
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 2000;
}

/** 是否启用 exam-paper-recognition 服务（默认开启，可用 EXAM_RECOGNITION_ENABLED=0 关闭） */
export function isExamRecognitionEnabled(): boolean {
  return process.env.EXAM_RECOGNITION_ENABLED !== '0';
}

function extFromMime(mimeType: string): string {
  const m = (mimeType || '').toLowerCase();
  if (m.includes('pdf')) return 'pdf';
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('bmp')) return 'bmp';
  if (m.includes('tif')) return 'tiff';
  return 'jpg';
}

function stripBase64Prefix(raw: string): string {
  return raw.replace(/^data:[^;]+;base64,/, '').trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 从 markdown 中解析 /api/results/{result_id}/images/{name} 形式的配图引用 */
function extractResultImageRefs(markdown: string): { resultId: string; name: string; raw: string }[] {
  const re = /\/api\/results\/([a-zA-Z0-9_-]+)\/images\/([^\s)]+)/g;
  const out: { resultId: string; name: string; raw: string }[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    const resultId = m[1];
    const name = decodeURIComponent(m[2].split('?')[0]).split('/').pop() || m[2];
    const key = `${resultId}/${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ resultId, name, raw: m[0] });
  }
  return out;
}

function mimeFromImageName(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.webp')) return 'image/webp';
  if (n.endsWith('.gif')) return 'image/gif';
  if (n.endsWith('.bmp')) return 'image/bmp';
  return 'image/jpeg';
}

/** 把 8080 端保存的配图下载为 base64，供前端独立展示（避免相对 URL 在浏览器裂图） */
async function fetchExamServiceFigures(
  markdown: string,
): Promise<{ name: string; mime: string; data: string }[]> {
  const refs = extractResultImageRefs(markdown);
  if (!refs.length) return [];
  const base = baseUrl();
  const out: { name: string; mime: string; data: string }[] = [];
  for (const ref of refs) {
    const url = `${base}/api/results/${ref.resultId}/images/${encodeURIComponent(ref.name)}`;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!r.ok) {
        console.warn(`[zhishitree] [exam-service] 下载配图失败 ${ref.name}: HTTP ${r.status}`);
        continue;
      }
      const buf = Buffer.from(await r.arrayBuffer());
      if (!buf.length) continue;
      out.push({
        name: ref.name,
        mime: mimeFromImageName(ref.name),
        data: buf.toString('base64'),
      });
    } catch (e) {
      console.warn(`[zhishitree] [exam-service] 下载配图异常 ${ref.name}:`, e);
    }
  }
  return out;
}

export async function checkExamRecognitionHealth(): Promise<ExamRecognitionHealth> {
  const base = baseUrl();
  try {
    // /api/health 会探测本地 MinerU（8001），常超过 6s；/api/v1/info 仅返回能力清单，适合探活
    const r = await fetch(`${base}/api/v1/info`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) {
      return { ok: false, message: `识别服务响应异常（HTTP ${r.status}）`, detail: base };
    }
    const data = (await r.json().catch(() => ({}))) as { service?: string };
    if (data.service && data.service !== 'exam-recognition') {
      return { ok: false, message: `识别服务类型不匹配：${data.service}`, detail: base };
    }
    return { ok: true, message: 'exam-paper-recognition 服务在线', detail: base };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      message: `无法连接 exam-paper-recognition 服务（${base}）`,
      detail: `请在 E:\\mineru识别测试 运行 py -3.13 run.py。${msg}`,
    };
  }
}

type TaskStatusData = {
  status?: string;
  error?: string;
  result?: {
    markdown?: string;
    image_count?: number;
    llm_validated?: boolean;
    correction_count?: number;
    llm_warning?: string;
    mode?: string;
  };
};

/**
 * 上传图片到 8080 服务并轮询至完成。
 * 默认 cloud_precision + OCR + 表格 + 公式 + AI 纠错。
 */
export async function recognizeExamViaService(
  base64: string,
  mimeType: string,
  opts?: { mode?: string; language?: string; ocr?: boolean; llmValidate?: boolean },
): Promise<ExamRecognitionResult> {
  const base = baseUrl();
  const raw = stripBase64Prefix(base64);
  const buffer = Buffer.from(raw, 'base64');
  if (!buffer.length) throw new Error('图片数据为空');

  const fileName = `question.${extFromMime(mimeType)}`;
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType || 'image/jpeg' }), fileName);
  form.append('mode', opts?.mode || 'cloud_precision');
  form.append('language', opts?.language || 'ch');
  form.append('page_range', '');
  form.append('ocr', String(opts?.ocr ?? true));
  form.append('formula', 'true');
  form.append('table', 'true');
  form.append('llm_validate', String(opts?.llmValidate ?? true));

  const createRes = await fetch(`${base}/api/tasks`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const createText = await createRes.text();
  let createData = {} as { task_id?: string; error?: string };
  try {
    createData = createText ? JSON.parse(createText) : {};
  } catch {
    throw new Error(`识别服务返回非 JSON：${createText.slice(0, 200)}`);
  }
  if (!createRes.ok || !createData.task_id) {
    throw new Error(`识别服务创建任务失败：${createData.error || createText.slice(0, 200)}`);
  }

  const taskId = createData.task_id;
  const deadline = Date.now() + timeoutMs();
  while (Date.now() < deadline) {
    const statusRes = await fetch(`${base}/api/tasks/${taskId}`, {
      signal: AbortSignal.timeout(30_000),
    });
    const statusText = await statusRes.text();
    let statusJson = {} as { data?: TaskStatusData };
    try {
      statusJson = statusText ? JSON.parse(statusText) : {};
    } catch {
      throw new Error(`识别服务轮询返回非 JSON：${statusText.slice(0, 200)}`);
    }
    if (!statusRes.ok) {
      throw new Error(`识别服务查询失败（HTTP ${statusRes.status}）`);
    }

    const task = statusJson.data ?? {};
    const state = task.status;
    if (state === 'done') {
      const result = task.result ?? {};
      const markdown = (result.markdown || '').trim();
      if (!markdown) throw new Error('识别服务完成但未返回 Markdown 正文');
      const figures = await fetchExamServiceFigures(markdown);
      return {
        markdown,
        imageCount: result.image_count ?? figures.length,
        llmValidated: Boolean(result.llm_validated),
        correctionCount: result.correction_count ?? 0,
        llmWarning: result.llm_warning,
        mode: result.mode,
        figures,
      };
    }
    if (state === 'failed') {
      throw new Error(`识别服务解析失败：${task.error || '未知错误'}`);
    }
    await sleep(pollIntervalMs());
  }
  throw new Error('识别服务解析超时');
}
