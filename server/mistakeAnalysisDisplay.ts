/** 与服务端 / 前端共用的错因解析（保持逻辑一致） */
export type ParsedMistakeDiagnosis = {
  answerComparison?: string;
  causes: string[];
};

function normalizeCauseLine(raw: string): string {
  let cause = raw.trim();
  const arrowParts = cause.split(/\s*(?:→|->|=>|—>)\s*/u);
  if (arrowParts.length >= 2) {
    cause = arrowParts.slice(1).join(' — ').trim();
  }
  cause = cause
    .replace(/^(错答表现|可能原因|错因|答错表现)[：:]\s*/iu, '')
    .replace(/^\*\*|\*\*$/g, '')
    .trim();
  return cause;
}

export function parseMistakeCauses(specificMistake: string): ParsedMistakeDiagnosis {
  const text = specificMistake.trim();
  if (!text) return { causes: [] };

  let remainder = text;
  let answerComparison: string | undefined;

  const compPatterns = [
    /\*\*作答对比\*\*[：:]*\s*([\s\S]*?)(?=\n\s*[-*•]|\n\s*\*\*|$)/u,
    /作答对比[：:]\s*([^\n]+)/u,
  ];
  for (const re of compPatterns) {
    const m = remainder.match(re);
    if (m?.[1]?.trim()) {
      answerComparison = m[1].replace(/\s+/g, ' ').trim();
      remainder = remainder.replace(re, '').trim();
      break;
    }
  }

  const causes: string[] = [];
  for (const line of remainder.split(/\r?\n/)) {
    const bullet = line.match(/^\s*[-*•]\s+(.+)$/u);
    if (bullet?.[1]) {
      const cause = normalizeCauseLine(bullet[1]);
      if (cause && !/^作答对比/u.test(cause)) causes.push(cause);
    }
  }

  if (causes.length === 0) {
    const stripped = remainder
      .replace(/\*\*可能的原因\*\*[：:]?/gu, '')
      .replace(/可能的原因[：:]?/gu, '')
      .trim();
    for (const part of stripped.split(/\r?\n+/)) {
      const cause = normalizeCauseLine(part);
      if (cause.length > 4) causes.push(cause);
    }
  }

  return { answerComparison, causes };
}

export function resolveSelectedCauseLabels(
  specificMistake: string,
  indices: number[],
): string[] {
  const { causes } = parseMistakeCauses(specificMistake);
  return indices
    .filter((i) => i >= 0 && i < causes.length)
    .map((i) => causes[i]);
}
