/**
 * 同一张题目图：MinerU vs Gemini 一步识图 OCR 对比
 * 运行：tsx scripts/compare-ocr-mineru-gemini.mts [图片路径]
 */
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGeminiClient, runWithGeminiNetwork } from '../server/geminiClient.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');

config({ path: path.join(projectRoot, '.env') });
config({ path: path.join(projectRoot, '.env.local'), override: true });

const defaultImage = path.resolve(
  projectRoot,
  '../assets/c__Users_admin_AppData_Roaming_Cursor_User_workspaceStorage_empty-window_images_image-8840f03f-ebcd-44ea-baa8-c9a87ad46a81.png',
);

const OCR_PROMPT = `【任务】读取用户上传的题目图片，逐字转录图中全部文字。

你是高精度 OCR 引擎。请**仅逐字转录**图片中的全部文字，不要分析、不要改写、不要编造。

硬性要求：
1. 题号、地区标注（如【金华】）、标点、括号原样保留。
2. 物理单位与符号准确：Ω（欧姆）、A（安培）、V（伏特）、W（瓦特）勿混淆；数字勿改（如 0.6 不可写成 0.5）。
3. 「电流与电阻」「电流与电压」等术语勿混淆，以图片为准。
4. **表格（必做）**：若图中有表格，必须用 Markdown 表格完整输出，**每一行、每一列、表头均不可省略**。
5. **电路图/示意图**：先尽量用文字描述连接关系；若无法准确还原拓扑，在转录末尾单独一行写：[电路图见原题配图]
6. 滑动变阻器规格、电表量程、定值电阻阻值等参数必须与原图一致。
7. 看不清的字用 [?] 标注，禁止猜测。

直接输出转录正文，不要 JSON，不要 Markdown 代码块，不要加「以下是」等前缀。`;

function loadImage(imagePath: string): { base64: string; mimeType: string } {
  const buf = readFileSync(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const mimeType =
    ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return { base64: buf.toString('base64'), mimeType };
}

async function runGemini(base64: string, mimeType: string): Promise<string> {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) throw new Error('未配置 GEMINI_API_KEY');

  const model = process.env.GEMINI_VISION_MODEL?.trim() || 'gemini-2.0-flash';
  return runWithGeminiNetwork(async () => {
    const ai = createGeminiClient(apiKey);
    const response = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          { inlineData: { data: base64, mimeType } },
          { text: OCR_PROMPT },
        ],
      },
      config: { temperature: 0 },
    });
    const text = response.text?.trim();
    if (!text) throw new Error('Gemini 未返回内容');
    return text;
  });
}

/** 云端 Agent 直调，避免数据库里的 local 配置覆盖环境变量 */
async function runMineruCloudAgentDirect(base64: string, mimeType: string): Promise<string> {
  const base = 'https://mineru.net/api/v1/agent';
  const raw = base64.replace(/^data:[^;]+;base64,/, '').trim();
  const buffer = Buffer.from(raw, 'base64');
  const ext = mimeType.includes('png') ? 'png' : 'jpg';
  const fileName = `question.${ext}`;

  const createRes = await fetch(`${base}/parse/file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_name: fileName,
      language: 'ch',
      enable_table: true,
      enable_formula: true,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const createData = (await createRes.json()) as {
    code?: number;
    msg?: string;
    data?: { task_id?: string; file_url?: string };
  };
  if (!createRes.ok || createData.code !== 0) {
    throw new Error(`MinerU Agent 创建任务失败：${createData.msg}`);
  }
  const taskId = createData.data?.task_id;
  const fileUrl = createData.data?.file_url;
  if (!taskId || !fileUrl) throw new Error('MinerU Agent 未返回 task_id 或 file_url');

  const putRes = await fetch(fileUrl, { method: 'PUT', body: buffer, signal: AbortSignal.timeout(120_000) });
  if (!putRes.ok) throw new Error(`MinerU Agent 上传失败（HTTP ${putRes.status}）`);

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const pollRes = await fetch(`${base}/parse/${taskId}`, { signal: AbortSignal.timeout(30_000) });
    const pollData = (await pollRes.json()) as {
      code?: number;
      msg?: string;
      data?: { state?: string; markdown_url?: string; err_msg?: string };
    };
    if (!pollRes.ok || pollData.code !== 0) {
      throw new Error(`MinerU Agent 查询失败：${pollData.msg}`);
    }
    const state = pollData.data?.state;
    if (state === 'done') {
      const mdUrl = pollData.data?.markdown_url;
      if (!mdUrl) throw new Error('MinerU Agent 完成但未返回 markdown_url');
      const mdRes = await fetch(mdUrl, { signal: AbortSignal.timeout(60_000) });
      if (!mdRes.ok) throw new Error(`下载 Markdown 失败（HTTP ${mdRes.status}）`);
      return (await mdRes.text()).trim();
    }
    if (state === 'failed') {
      throw new Error(`MinerU Agent 解析失败：${pollData.data?.err_msg || '未知错误'}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('MinerU Agent 解析超时');
}

function cleanMineruMarkdown(raw: string): string {
  const lines = raw.split('\n');
  const start = lines.findIndex((l) => /^\d+\.\d+\./.test(l.trim()) || l.includes('【金华】'));
  return start >= 0 ? lines.slice(start).join('\n').trim() : raw.trim();
}

function scoreTable(text: string): { hasTable: boolean; rows: number } {
  const lines = text.split('\n').filter((l) => l.includes('|'));
  return { hasTable: lines.length >= 2, rows: lines.length };
}

function hasCircuitImageRef(text: string): boolean {
  return /!\[.*?\]\(.*?\)/.test(text) || /images\//.test(text);
}

function hasCircuitTextDesc(text: string): boolean {
  return /电路|串联|并联|滑动变阻|电流表|电压表/.test(text);
}

function printSection(title: string, text: string) {
  console.log('\n' + '='.repeat(60));
  console.log(title);
  console.log('='.repeat(60));
  console.log(text);
  const table = scoreTable(text);
  console.log('\n--- 简要指标 ---');
  console.log(`字符数: ${text.length}`);
  console.log(`Markdown 表格: ${table.hasTable ? `是（${table.rows} 行）` : '否'}`);
  console.log(`嵌入图片引用: ${hasCircuitImageRef(text) ? '是' : '否'}`);
  console.log(`电路文字描述: ${hasCircuitTextDesc(text) ? '是' : '否'}`);
}

async function main() {
  const imagePath = process.argv[2] ? path.resolve(process.argv[2]) : defaultImage;
  console.log(`图片: ${imagePath}`);
  const { base64, mimeType } = loadImage(imagePath);

  let mineruText = '';
  let mineruSource = '';

  try {
    console.log('\n[MinerU] 云端 Agent（免 Token）...');
    mineruText = cleanMineruMarkdown(await runMineruCloudAgentDirect(base64, mimeType));
    mineruSource = 'MinerU 云端 Agent';
    printSection(`${mineruSource} 输出`, mineruText);
  } catch (e) {
    console.error('\n[MinerU 失败]', e instanceof Error ? e.message : e);
  }

  try {
    console.log('\n[Gemini] 一步视觉 OCR...');
    const geminiText = await runGemini(base64, mimeType);
    printSection('Gemini 一步识图 OCR 输出', geminiText);
  } catch (e) {
    console.error('\n[Gemini 失败]', e instanceof Error ? e.message : e);
  }

  if (mineruText) {
    console.log('\n' + '#'.repeat(60));
    console.log('对比结论（自动生成，供参考）');
    console.log('#'.repeat(60));
    console.log('- MinerU：布局驱动，表格/图片分区识别，输出结构化 Markdown');
    console.log('- Gemini：整图理解，表格靠 prompt 约束，电路图多为文字描述');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
