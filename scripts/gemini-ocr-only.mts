import { readFileSync } from 'node:fs';
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGeminiClient, runWithGeminiNetwork } from '../server/geminiClient.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
config({ path: path.join(projectRoot, '.env.local') });

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const useProxy = process.argv.includes('--proxy');
const noProxy = process.argv.includes('--no-proxy');

const imgPath =
  args[0] ||
  'C:/Users/admin/.cursor/projects/e/assets/c__Users_admin_AppData_Roaming_Cursor_User_workspaceStorage_empty-window_images_image-8840f03f-ebcd-44ea-baa8-c9a87ad46a81.png';

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

async function main() {
  const buf = readFileSync(imgPath);
  const base64 = buf.toString('base64');
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error('无 GEMINI_API_KEY');

  const useProxyFlag = useProxy;
  const noProxyFlag = noProxy;
  if (noProxyFlag) delete process.env.GEMINI_HTTP_PROXY;

  console.log('proxy:', useProxyFlag || (!noProxyFlag && process.env.GEMINI_HTTP_PROXY) || 'none');

  const run = async () => {
    const ai = createGeminiClient(apiKey);
    const model = process.env.GEMINI_VISION_MODEL?.trim() || 'gemini-2.0-flash';
    const response = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          { inlineData: { data: base64, mimeType: 'image/png' } },
          { text: OCR_PROMPT },
        ],
      },
      config: { temperature: 0 },
    });
    return response.text?.trim() ?? '';
  };

  const text = noProxyFlag ? await run() : await runWithGeminiNetwork(run);

  console.log('\n=== Gemini OCR ===\n');
  console.log(text);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
