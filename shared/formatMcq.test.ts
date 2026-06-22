/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { formatMcqOptionsPerLine, isMcqOptionLine } from './formatMcq';

describe('formatMcqOptionsPerLine', () => {
  it('splits inline options and adds blank lines', () => {
    const raw = '下列说法正确的是 A. 甲对 B. 乙错 C. 丙对 D. 丁错';
    const out = formatMcqOptionsPerLine(raw);
    expect(out).toContain('下列说法正确的是');
    expect(out).toMatch(/\n\nA\./);
    expect(out).toMatch(/\n\nB\./);
    expect(out).toMatch(/\n\nC\./);
  });

  it('splits tight-packed options', () => {
    const raw = '题目A.选项一B.选项二';
    const out = formatMcqOptionsPerLine(raw);
    expect(out).toContain('A.选项一');
    expect(out).toContain('B.选项二');
  });

  it('keeps A、B stem label in question body (测力计题)', () => {
    const raw =
      '小明将一个正常的铁质外壳测力计B的挂钩挂在铁架台上，静止时如图甲所示（铁架台略去）。接着，他把这个测力计按如图乙所示上、下各挂一个50g的钩码，并挂在测力计A下，则 A、B两测力计的示数分别是（g取10N/kg）（ ）';
    const out = formatMcqOptionsPerLine(raw);
    expect(out).not.toMatch(/\n\nA、B/);
    expect(out).toContain('A、B两测力计的示数分别是（g取10N/kg）（ ）');
    expect(isMcqOptionLine('A、B两测力计的示数分别是（g取10N/kg）（ ）')).toBe(false);
  });

  it('still splits real options after stem', () => {
    const raw =
      'A、B两测力计的示数分别是（g取10N/kg）（ ） A. 1.0N和1.0N B. 1.0N和0.5N C. 0.5N和1.0N D. 0.5N和0.5N';
    const out = formatMcqOptionsPerLine(raw);
    expect(out).toContain('A、B两测力计的示数分别是（g取10N/kg）（ ）');
    expect(out).toMatch(/\n\nA\.\s*1\.0N/);
    expect(out).toMatch(/\n\nB\.\s*1\.0N/);
  });
});
