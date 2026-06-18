/**
 * 去掉模型在 $...$ 闭括号后紧跟的「纯文本回声」（如 $R_1$ R1）。
 * 采用保守策略，避免误伤正文或破坏 $ 配对（否则会整页重复渲染）。
 */

function escapeRegExp(t: string): string {
  return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 由 LaTeX 生成少量「影子串」，用于与尾部比对；不做过度归一化以免误匹配 */
function latexToPlainEchoesConservative(latex: string): string[] {
  const set = new Set<string>();
  const x = latex.trim();
  if (!x) return [];

  let y = x
    .replace(/\\text\{([^}]*)\}/g, '$1')
    .replace(/\\mathrm\{([^}]*)\}/g, '$1')
    .replace(/\\Omega/g, 'Ω')
    .replace(/\\cdot/g, '·')
    .replace(/\\sim/g, '~')
    .replace(/\\(leq|le)\b/gi, '≤')
    .replace(/\\(geq|ge)\b/gi, '≥');

  const compact = (s: string) => s.replace(/\s+/g, '');
  set.add(compact(y));

  const z = y
    .replace(/([A-Za-z])_\{([^}]+)\}/g, '$1$2')
    .replace(/([A-Za-z])_([0-9A-Za-z])/g, '$1$2');
  set.add(compact(z));

  return [...set].filter((s) => s.length >= 3 && s.length <= 64);
}

function stripEchoTail(math: string, tail: string): string {
  const t = tail;

  const dup = t.match(/^\s*\$([^$\n]+)\$/);
  if (dup && dup[1].replace(/\s+/g, '') === math.replace(/\s+/g, '')) {
    return t.slice(dup[0].length);
  }

  for (const e of latexToPlainEchoesConservative(math).sort((a, b) => b.length - a.length)) {
    const flexible = e
      .split('')
      .map((ch) => {
        if (ch === '≤') return '(?:≤|\\\\le|\\\\leq)';
        return escapeRegExp(ch);
      })
      .join('\\s*');
    try {
      const m = t.match(new RegExp('^\\s*' + flexible, 'i'));
      if (m) return t.slice(m[0].length);
    } catch {
      /* ignore */
    }
  }

  return tail;
}

function processInlineMathEchoes(s: string): string {
  let remaining = s;
  let out = '';

  while (remaining.length > 0) {
    const dollar = remaining.indexOf('$');
    if (dollar === -1) {
      out += remaining;
      break;
    }
    if (dollar > 0 && remaining[dollar - 1] === '\\') {
      out += remaining.slice(0, dollar + 1);
      remaining = remaining.slice(dollar + 1);
      continue;
    }

    out += remaining.slice(0, dollar);
    remaining = remaining.slice(dollar);

    if (remaining.startsWith('$$')) {
      const end = remaining.indexOf('$$', 2);
      if (end === -1) {
        out += remaining;
        break;
      }
      const inner = remaining.slice(2, end);
      out += '$$' + processInlineMathEchoes(inner) + '$$';
      remaining = remaining.slice(end + 2);
      continue;
    }

    const close = remaining.indexOf('$', 1);
    if (close === -1) {
      out += remaining;
      break;
    }

    const math = remaining.slice(1, close);
    if (math.includes('\n') || math === '') {
      out += '$';
      remaining = remaining.slice(1);
      continue;
    }

    let tail = remaining.slice(close + 1);
    tail = stripEchoTail(math, tail);
    out += '$' + math + '$';
    remaining = tail;
  }

  return out;
}

function lightRegexPass(s: string): string {
  let x = s;
  x = x.replace(/(\$[^$\n]+\$)(\s*\1)+/g, '$1');
  x = x.replace(/\$R_1\$\s*(?:R_1|R1)\b/gi, '$R_1$');
  x = x.replace(/\$R_2\$\s*(?:R_2|R2)\b/gi, '$R_2$');
  x = x.replace(/\$R_3\$\s*(?:R_3|R3)\b/gi, '$R_3$');
  x = x.replace(/\$([0-9]+(?:\.[0-9]+)?)V\$\s*\1V\b/g, (_, n) => `$${n}V$`);
  x = x.replace(/\$10\\Omega\$\s*10\\Omega\b/g, '$10\\Omega$');
  x = x.replace(/\$10\\Omega\$\s*10Ω\b/g, '$10\\Omega$');
  x = x.replace(/\$0\s*\\sim\s*3V\$\s*0\s*[~～]\s*3V/gi, '$0 \\sim 3V$');
  x = x.replace(/\$0\s*\\sim\s*0\.6A\$\s*0\s*[~～]\s*0\.6A/gi, '$0 \\sim 0.6A$');
  x = x.replace(/\$I_\{max\}\$\s*(?:I_\{max\}|I_max|Imax)\b/gi, '$I_{max}$');
  return x;
}

/** 对 Markdown 做轻量数学回声清理（保留 ``` 代码块） */
export function sanitizeGeminiMathEcho(md: string): string {
  const parts = md.split(/(```[\s\S]*?```)/g);
  return parts
    .map((part) => {
      if (part.startsWith('```')) return part;
      let s = part;
      for (let i = 0; i < 4; i++) {
        const next = processInlineMathEchoes(lightRegexPass(s));
        if (next === s) break;
        s = next;
      }
      return s;
    })
    .join('');
}
