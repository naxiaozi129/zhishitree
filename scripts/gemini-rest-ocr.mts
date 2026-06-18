import { readFileSync } from 'node:fs';
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
config({ path: path.join(projectRoot, '.env.local') });

const imgPath =
  'C:/Users/admin/.cursor/projects/e/assets/c__Users_admin_AppData_Roaming_Cursor_User_workspaceStorage_empty-window_images_image-8840f03f-ebcd-44ea-baa8-c9a87ad46a81.png';

const OCR_PROMPT = `【任务】读取用户上传的题目图片，逐字转录图中全部文字。表格用 Markdown 表格。电路图用文字描述连接关系。直接输出正文。`;

const buf = readFileSync(imgPath);
const base64 = buf.toString('base64');
const key = process.env.GEMINI_API_KEY?.trim();
if (!key) throw new Error('no key');

const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
const body = {
  contents: [
    {
      parts: [
        { inline_data: { mime_type: 'image/png', data: base64 } },
        { text: OCR_PROMPT },
      ],
    },
  ],
  generationConfig: { temperature: 0 },
};

const r = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const text = await r.text();
console.log('status', r.status);
if (!r.ok) {
  console.log(text.slice(0, 500));
  process.exit(1);
}
const data = JSON.parse(text) as {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
};
const out = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
console.log('\n=== Gemini REST ===\n');
console.log(out);
