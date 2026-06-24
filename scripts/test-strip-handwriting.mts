/**
 * 本地验证题干去手写 / 噪声行剔除（无需 API）
 * 运行：npx tsx scripts/test-strip-handwriting.mts
 */
import {
  isGarbageHandwritingText,
  isUnitTokenSpamHandwriting,
  looksLikeHandwritingOcrNoise,
  normalizeBlackOriginalAnswer,
  blankHandwritingInStemOcr,
  normalizeStemLineBreaks,
  postProcessHandwrittenPair,
  stripHandwritingFromOcrText,
  supplementBlackDirectionFill,
  supplementRedCorrectionFill,
  supplementRedDerivationFill,
  STEM_FILL_BLANK,
} from '../server/examImageInkPreprocess.ts';

const hangzhouStem =
  '【杭州】连接在水平桌面上的物体M…当A重3N、B重5N时…若滑轮摩擦不计，则此时M受到的摩擦力大小为____N，方向是____。当B刚触地时…方向是____。';

const noiseLine = 'M A双#wMNm拉+ma摩擦力 A 回 =B1MSNmD 6f=N-3N=2N';
const garbageBlack = 'A双#wlvNm拉:na摩擦力 A回 =?AiSNmD Gf=1-3i=2iN';
const unitSpam = '3N 5N 2N 0N 8N 2n 5n 9009n 4N 96n 2n 5n 8n 2n 5n 8n 2n 5n 8n';
const stem =
  '（1）用弹簧测力计沿水平方向拉木块，木块在水平面上做匀速直线运动，弹簧测力计示数为 3N，则木块受到摩擦力方向为水平向左。';
const ocr = `${stem}\n${noiseLine}`;

const corrected = 'A对M3N拉力+M受到的摩擦力=B对M5N拉力 故 f=5N-3N=2N';

console.log('noise detected:', looksLikeHandwritingOcrNoise(noiseLine));
console.log('garbage black:', isGarbageHandwritingText(garbageBlack));
console.log('unit spam:', isUnitTokenSpamHandwriting(unitSpam));

const cleaned = stripHandwritingFromOcrText(ocr, {
  originalAnswer: garbageBlack,
  correctedAnswer: corrected,
});
console.log('--- cleaned ---');
console.log(cleaned.text);
console.log('--- recovered black ---');
console.log(cleaned.recoveredBlack || '(空)');
console.log('---');
console.log('noise removed:', !cleaned.text.includes('双#wMNm'));
console.log('stem kept:', cleaned.text.includes('弹簧测力计'));
console.log('no unit spam in recovery:', !/\d{4,}[Nn]/.test(cleaned.recoveredBlack));
console.log('spam blocked:', isGarbageHandwritingText(unitSpam));

const misclassified = postProcessHandwrittenPair('2 水平向左 水平向右', '');
console.log('promote red digit:', misclassified);

const pulleyBlack = postProcessHandwrittenPair('5（划掉）\n2\n水平向左\n水平向右\nC\n12\n6', '');
console.log('pulley promote:', pulleyBlack);

const hangzhouStemFull =
  '【杭州】连接在水平桌面上的物体M两端的轻质细绳分别绕过定滑轮与A、B两物体相连。当A重3N、B重5N时，M恰好沿水平方向做匀速直线运动。若滑轮摩擦不计，则此时M受到的摩擦力大小为____N，方向是水平向左。';
console.log(
  'supplement red 2:',
  supplementRedCorrectionFill('5（划掉）\n水平向左', hangzhouStemFull, ''),
);

const messyStem = `【杭州】…若滑轮摩擦不计，则此时M受到的摩擦力大小为5（划掉）2N，方向是水平向左。当B刚触地时，则M受到的摩擦力方向是水平向左。

$$\\text {   如   } f = 5 N - 3 N = 2 N$$`;
const blanked = blankHandwritingInStemOcr(messyStem, {
  originalAnswer: '5（划掉）\n水平向左\n水平向右',
  correctedAnswer: '2',
});
console.log('stem blanked has fill:', blanked.includes(`大小为${STEM_FILL_BLANK}N`));
console.log('stem blanked no direction fill:', !/方向是水平向左/.test(blanked));
console.log('stem blanked no red f=', !/f\s*=\s*5\s*N\s*[-−]\s*3\s*N/i.test(blanked));
console.log('stem blanked directions:', (blanked.match(/方向[是为]\s*____/g) || []).length >= 2);

const broken = '当B刚触地时，若\nA、M都不会与滑轮相碰，则M受到的摩擦力方向是____。';
console.log('join 若A、M:', normalizeStemLineBreaks(broken).includes('若A、M都不会'));

const brokenComma = '当B刚触地时，若\nA，M都不会与滑轮相碰，则M受到的摩擦力方向是____。';
console.log('join 若A，M:', normalizeStemLineBreaks(brokenComma).includes('若A，M都不会'));

console.log(
  'supplement red derivation:',
  supplementRedDerivationFill('5（划掉）\n水平向左\n水平向左', hangzhouStem, '2'),
);
console.log(
  'red derivation clean when contaminated:',
  supplementRedDerivationFill(
    '5（划掉）\n水平向左\n水平向左',
    hangzhouStem,
    'A对M…故f=2N ρ酒精<ρ水',
  ).includes('故 f = 5N'),
);

console.log(
  'supplement 2nd direction:',
  supplementBlackDirectionFill('5（划掉）\n水平向左', hangzhouStem + '当B刚触地时…方向是____'),
);

const stemLong =
  '（1）用弹簧测力计沿水平方向拉木块，木块在水平面上做匀速直线运动，弹簧测力计示数为 3N，则木块受到摩擦力方向为水平向左。';
const overStrip = stripHandwritingFromOcrText(stemLong, {
  originalAnswer: '2 水平向左 水平向右',
  correctedAnswer: '',
});
console.log('over-strip prevented:', overStrip.text.length > 40);

const longBlack =
  '若滑轮摩擦不计,则此时M受到的摩擦力大小为__5(划掉)__N,方向是水平向左';
console.log('normalize black:', normalizeBlackOriginalAnswer(longBlack));
