import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
config({ path: path.join(projectRoot, '.env.local') });

const imgPath = process.argv[2] || path.resolve(projectRoot, '../错题/电路1.jpg');
const buf = readFileSync(imgPath);
const base64 = buf.toString('base64');

const { resolveActiveAiCredentials } = await import('../server/aiModelConfig.ts');
const cfg = resolveActiveAiCredentials()!;

// 与 server/questionImageAnalyze.ts 中 buildHandwrittenAnswersPrompt 保持一致
const prompt = `【任务】仅转录题目图片中的**手写作答**（用笔写的笔迹），按颜色分为 black / red 两栏。

【先排除印刷体（必做）】
- 试卷/书本印刷的题干、题号、选项文字、表头 → **一律不抄写**
- 印刷体特征：字体统一、墨色均匀、与版面对齐；手写字迹笔画粗细不一、有连笔或涂改

【颜色含义】
- **black（黑色笔迹）**：学生最初做题时写下的原始答案——填空数值、圈选/勾选选项、计算草稿、表格中手填数据等
- **red（红色笔迹）**：事后批改/订正——红笔写的正确答案、改错、批注说明；仅有红色勾/叉/划线而无文字时，在 red 中写「（红色勾画标记）」

【常见题型】
- 填空/表格：只抄学生手写的填入值（如 5、0.4、12N、水平向左），按题序分行
- 选择题：black 抄学生圈选或旁注（如 B、D）；red 抄红笔改正后的选项或解析
- 计算题：black 抄黑色草稿与步骤；red 抄红笔订正、批注（勿与 black 重复抄写同一段）

【输出】只输出一个 JSON 对象，不要 Markdown 代码块，不要其他文字：
{"black":"黑色手写内容","red":"红色手写内容"}
- 没有某颜色笔迹时，对应键值为空字符串 ""
- 多题/多空用换行分隔；看不清用 [?]`;

const url = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const body = {
  model: 'glm-4.6v',
  messages: [
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
        { type: 'text', text: prompt },
      ],
    },
  ],
  max_tokens: 2048,
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
console.log('HTTP', r.status);
try {
  const data = JSON.parse(raw);
  const text = data.choices?.[0]?.message?.content ?? '';
  console.log('\n--- 模型原始输出 ---\n');
  console.log(text || '(content 为空)');
  if (!text) console.log('完整响应:', JSON.stringify(data).slice(0, 800));
} catch {
  console.log(raw.slice(0, 1500));
}
