import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.DATABASE_PATH || path.join(root, 'data', 'zhishitree.db');

console.log('\n===', dbPath, '===');
try {
  const db = new Database(dbPath);
  db.pragma('wal_checkpoint(FULL)');
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[];
  for (const { name } of tables) {
    const c = (db.prepare(`SELECT COUNT(*) AS c FROM ${name}`).get() as { c: number }).c;
    console.log(`  ${name}: ${c}`);
  }
  db.close();
} catch (e) {
  console.log('  ERR', e instanceof Error ? e.message : e);
  process.exit(1);
}
