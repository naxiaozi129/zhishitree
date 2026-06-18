import type { QuestionImageRef } from './questionYaml.js';

const IMG_PLACEHOLDER_RE = /\{\{image:([a-zA-Z0-9_-]+)\}\}/g;

/** HTML 转纯文本，保留 {{image:id}} 占位符 */
export function htmlToExamText(html: string): string {
  let s = html;
  s = s.replace(/<img[^>]*src=["']({{image:[^"']+}})["'][^>]*>/gi, '\n$1\n');
  s = s.replace(/<img[^>]*src=["'](data:[^"']+)["'][^>]*>/gi, (_m, src: string) => {
    return `\n![image](${src})\n`;
  });
  s = s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

export function imageRefsInStem(stem: string): string[] {
  const ids: string[] = [];
  for (const m of stem.matchAll(IMG_PLACEHOLDER_RE)) {
    ids.push(m[1]);
  }
  return [...new Set(ids)];
}

export function attachImagesToBody(
  stem: string,
  pool: Record<string, QuestionImageRef>,
): { stem: string; images: QuestionImageRef[] } {
  const ids = imageRefsInStem(stem);
  const images = ids.map((id) => pool[id]).filter((x): x is QuestionImageRef => Boolean(x));
  return { stem, images };
}
