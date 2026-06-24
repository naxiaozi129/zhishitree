/**
 * 测试题干墨迹预处理：统计掩膜像素并可选保存净化图
 * 运行：npx tsx scripts/test-ink-preprocess.mts [图片] [--out 输出.jpg]
 */
import { config } from 'dotenv';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
config({ path: path.join(projectRoot, '.env.local') });

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outPath = outIdx >= 0 ? args[outIdx + 1] : undefined;
const imgPath = path.resolve(args.find((a) => !a.startsWith('--') && a !== outPath) || '../错题/电路1.jpg');

const buf = readFileSync(imgPath);
const base64 = buf.toString('base64');
const ext = path.extname(imgPath).toLowerCase();
const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';

const { preprocessImageForStemOcr } = await import('../server/examImageInkPreprocess.ts');
const result = await preprocessImageForStemOcr(base64, mimeType);

if (!result) {
  console.log('预处理未启用或失败');
  process.exit(1);
}

console.log(path.basename(imgPath), result.stats);
if (outPath) {
  writeFileSync(outPath, Buffer.from(result.base64, 'base64'));
  console.log('已保存:', outPath);
}
