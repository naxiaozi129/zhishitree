import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractExamTextFromBuffer, isIngestibleExamFileName } from './paperFileExtract.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

export type MaterialItem = {
  name: string;
  relPath: string;
  kind: 'dir' | 'file';
  ext?: string;
  size?: number;
  modifiedAt?: string;
};

export type MaterialListPayload = {
  rootLabel: string;
  rootExists: boolean;
  currentPath: string;
  parentPath: string | null;
  items: MaterialItem[];
};

function slugId(input: string): string {
  return input
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'node';
}

export function getZhongkaoMaterialsRoot(): string {
  const env = process.env.ZHONGKAO_MATERIALS_DIR?.trim();
  if (env) return path.resolve(env);
  return path.join(projectRoot, '10.中考浙江科学');
}

/** 解析相对路径，禁止目录穿越 */
export function resolveMaterialPath(relPath: string): string | null {
  const root = getZhongkaoMaterialsRoot();
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.includes('..')) return null;
  const abs = path.resolve(root, normalized);
  if (!abs.startsWith(root)) return null;
  return abs;
}

export function listMaterialDir(relPath = ''): MaterialListPayload {
  const root = getZhongkaoMaterialsRoot();
  const rootExists = fs.existsSync(root);
  const currentPath = relPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const abs = currentPath ? resolveMaterialPath(currentPath) : root;

  if (!rootExists || !abs || !fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    return {
      rootLabel: path.basename(root),
      rootExists,
      currentPath,
      parentPath: null,
      items: [],
    };
  }

  const entries = fs.readdirSync(abs, { withFileTypes: true });
  const items: MaterialItem[] = entries
    .filter((e) => !e.name.startsWith('.'))
    .map((e) => {
      const rel = currentPath ? `${currentPath}/${e.name}` : e.name;
      const full = path.join(abs, e.name);
      const st = fs.statSync(full);
      if (e.isDirectory()) {
        return { name: e.name, relPath: rel.replace(/\\/g, '/'), kind: 'dir' as const };
      }
      const ext = path.extname(e.name).toLowerCase();
      return {
        name: e.name,
        relPath: rel.replace(/\\/g, '/'),
        kind: 'file' as const,
        ext,
        size: st.size,
        modifiedAt: st.mtime.toISOString(),
      };
    })
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });

  const parentPath =
    currentPath && currentPath.includes('/')
      ? currentPath.split('/').slice(0, -1).join('/')
      : currentPath
        ? ''
        : null;

  return {
    rootLabel: path.basename(root),
    rootExists,
    currentPath,
    parentPath,
    items,
  };
}

export async function extractMaterialText(relPath: string): Promise<{
  text: string;
  format: string;
  charCount: number;
}> {
  const abs = resolveMaterialPath(relPath);
  if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    throw new Error('文件不存在或不可读');
  }

  const buf = fs.readFileSync(abs);
  return extractExamTextFromBuffer(buf, abs);
}

export function isIngestibleMaterial(relPath: string): boolean {
  return isIngestibleExamFileName(relPath);
}

export { slugId };
