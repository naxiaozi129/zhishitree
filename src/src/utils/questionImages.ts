/** 将题干中的 {{image:id}} 展开为 markdown 图片，便于 Markdown 渲染 */
export function expandQuestionStemImages(stem: string, body?: Record<string, unknown>): string {
  if (!body?.images || !Array.isArray(body.images)) return stem;
  const map = new Map<string, { mime: string; data: string; alt?: string | null }>();
  for (const raw of body.images) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as { id?: string; mime?: string; data?: string; alt?: string | null };
    const id = String(o.id ?? '').trim();
    const data = String(o.data ?? '').trim();
    const mime = String(o.mime ?? 'image/png');
    if (id && data) map.set(id, { mime, data, alt: o.alt });
  }
  if (map.size === 0) return stem;
  return stem.replace(/\{\{image:([a-zA-Z0-9_-]+)\}\}/g, (_full, id: string) => {
    const img = map.get(id);
    if (!img) return _full;
    return `![${img.alt || id}](data:${img.mime};base64,${img.data})`;
  });
}

export function questionImagesFromBody(body?: Record<string, unknown>): Array<{ id: string; src: string; alt: string }> {
  if (!body?.images || !Array.isArray(body.images)) return [];
  const out: Array<{ id: string; src: string; alt: string }> = [];
  for (const raw of body.images) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as { id?: string; mime?: string; data?: string; alt?: string | null };
    const id = String(o.id ?? '').trim();
    const data = String(o.data ?? '').trim();
    if (!id || !data) continue;
    const mime = String(o.mime ?? 'image/png');
    out.push({ id, src: `data:${mime};base64,${data}`, alt: String(o.alt ?? id) });
  }
  return out;
}
