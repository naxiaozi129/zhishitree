/**
 * 验证黑/红手写答案识别：黑=原始作答，红=批改订正
 * 运行：npx tsx scripts/verify-handwritten-answers.mts [图片路径...]
 */
import { config } from 'dotenv';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');

config({ path: path.join(projectRoot, '.env') });
config({ path: path.join(projectRoot, '.env.local'), override: true });

const defaultImages = [
  path.resolve(projectRoot, '../错题/电路1.jpg'),
  path.resolve(projectRoot, '../错题/微信图片_2026-06-17_213010_145.jpg'),
  path.resolve(projectRoot, '../错题/微信图片_2026-06-17_212930_015.jpg'),
];

const imagePaths = process.argv.slice(2).length
  ? process.argv.slice(2).map((p) => path.resolve(p))
  : defaultImages;

const { resolveActiveAiCredentials } = await import('../server/aiModelConfig.ts');
const { recognizeQuestionImageOnly } = await import('../server/questionImageAnalyze.ts');

const cfg = resolveActiveAiCredentials();
if (!cfg?.apiKey) {
  console.error('未配置 AI API Key，请检查 .env.local');
  process.exit(1);
}

console.log(`AI: ${cfg.provider} / ${cfg.modelId}`);
console.log(`AI_HANDWRITTEN_ANSWER=${process.env.AI_HANDWRITTEN_ANSWER ?? '(未设，默认开启)'}`);
console.log('---');

for (const imgPath of imagePaths) {
  if (!existsSync(imgPath)) {
    console.log(`\n[跳过] 文件不存在: ${imgPath}`);
    continue;
  }
  const buf = readFileSync(imgPath);
  const ext = path.extname(imgPath).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
  const base64 = buf.toString('base64');
  const name = path.basename(imgPath);

  console.log(`\n=== ${name} ===`);
  const t0 = Date.now();
  try {
    const result = await recognizeQuestionImageOnly(cfg, base64, mimeType, 'exam-service');
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`耗时 ${elapsed}s | OCR ${result.rawOcrText.length} 字 | pipeline=${result.ocrMeta.pipeline}`);
    console.log(`\n【黑色·原始作答】(${result.originalAnswer?.length ?? 0} 字)`);
    console.log(result.originalAnswer?.trim() || '(空)');
    console.log(`\n【红色·批改答案】(${result.correctedAnswer?.length ?? 0} 字)`);
    console.log(result.correctedAnswer?.trim() || '(空)');
    const stemPreview = (result.rawOcrText || '').replace(/!\[[^\]]*\]\([^)]+\)/g, '[图]');
    console.log(`\n【题干·填空留空】`);
    console.log(`  大小为____: ${/大小为____\s*N|大小为____N/.test(stemPreview)}`);
    console.log(`  方向____: ${/方向[是为]\s*____/.test(stemPreview)}`);
    console.log(`  无红笔推导: ${!/f\s*=\s*5\s*N\s*[-−]\s*3\s*N/i.test(stemPreview)}`);
    console.log(`  无若后换行: ${!/若\s*\n\s*[A-Za-z]/.test(stemPreview)}`);
    console.log(`  红栏含推导: ${/A对M|故\s*f\s*=/.test(result.correctedAnswer || '')}`);
    console.log(stemPreview.slice(0, 420));
  } catch (e) {
    console.error(`失败: ${e instanceof Error ? e.message : e}`);
  }
}
