/**
 * 从项目根目录加载 .env / .env.local，发起一次最小 Gemini 请求，用于检测密钥与网络是否可用。
 * 运行：npm run check-api
 */
import { config } from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');

config({ path: path.join(projectRoot, '.env') });
config({ path: path.join(projectRoot, '.env.local'), override: true });

const apiKey = String(
  process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '',
).trim();

if (!apiKey) {
  console.error('[失败] 未读取到 GEMINI_API_KEY（或 VITE_GEMINI_API_KEY）。');
  console.error(`       请在「${projectRoot}」下的 .env.local 中配置，或导出环境变量后再运行。`);
  process.exit(1);
}

const modelsToTry = ['gemini-2.0-flash', 'gemini-2.5-flash-preview-05-20', 'gemini-3-flash-preview'];

async function main() {
  const ai = new GoogleGenAI({ apiKey });
  let lastErr: unknown;

  for (const model of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: '只回复两个英文字母：OK。不要其它内容。',
      });
      const text = response.text?.trim() ?? '';
      console.log(`[成功] 模型「${model}」可用。`);
      console.log(`       返回摘要（前 80 字）：${text.slice(0, 80) || '(空)'}`);
      process.exit(0);
    } catch (e) {
      lastErr = e;
    }
  }

  console.error('[失败] 已依次尝试：' + modelsToTry.join(', '));
  console.error('       原因：' + (lastErr instanceof Error ? lastErr.message : String(lastErr)));
  process.exit(1);
}

main();
