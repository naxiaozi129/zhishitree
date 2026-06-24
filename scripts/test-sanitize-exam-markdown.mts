/**
 * 验证 8080 纠错 JSON 泄漏清理
 * 运行：npx tsx scripts/test-sanitize-exam-markdown.mts
 */
import { readFileSync } from 'node:fs';
import { postprocessExamStemOcr, sanitizeExamServiceMarkdown } from '../server/examRecognitionService.ts';
import { normalizeStemLineBreaks } from '../server/examImageInkPreprocess.ts';

const samplePath = 'E:/mineru识别测试/outputs/20260624_013528_question.md';
const leaked = readFileSync(samplePath, 'utf-8');
const cleaned = sanitizeExamServiceMarkdown(leaked);

console.log('--- cleaned (first 400 chars) ---');
console.log(cleaned.slice(0, 400));
console.log('---');
console.log('no corrections key:', !/\"corrections\"/.test(cleaned));
console.log('has options:', /A\.\s*3N/.test(cleaned) && /B\.\s*2N/.test(cleaned));
console.log('has stem:', cleaned.includes('摩擦力'));

const garbled =
  '题干正文\n\nA. $M \\rightarrow N$ (向量力) 浮力\n\nB. $f = 5N - 3N = 2N$';
const fixed = postprocessExamStemOcr(garbled);
console.log('garbled fixed:', !fixed.includes('rightarrow'), fixed.includes('B. f = 5N'));

const broken = '…当B刚触地时，若\nA、M都不会与滑轮相碰…';
console.log('line join:', normalizeStemLineBreaks(broken).includes('若A、M都不会'));

const twoForceRaw = `【无锡】如图所示,在"探究二力平衡的条件"实验中,选质量为10g的卡片作为研究对象,在线的两端分别挂上等质量的重物,对卡片施加两个拉力,为探究这两个力满足什么条件才能平衡,则所挂重物的质量合适的是()。

(第6题)

B. 50g

C. 200g

往往重要的问题也难以找到多少才能减小自己所重力的影响。

D. 任意质量均可`;
const twoForceFixed = postprocessExamStemOcr(twoForceRaw);
console.log('two-force A:', /A\.\s*5\s*g/.test(twoForceFixed));
console.log('two-force B:', /B\.\s*10\s*g/.test(twoForceFixed));
console.log('two-force no garbled:', !twoForceFixed.includes('往往'));
console.log('two-force no 50g:', !/50\s*g/.test(twoForceFixed));
