/**
 * The active pack for node scripts: the owner's local pack (`src/data/packs/local/`, gitignored)
 * when present, else the default. The app and tests find it through Vite (`src/data/packs/active.ts`).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPack, packFilesFrom } from '@/data/packs/load';
import type { Pack } from '@/data/schema/pack';

const LOCAL = join(import.meta.dirname, '..', 'src', 'data', 'packs', 'local');

export function loadActivePack(): Pack {
  const names = existsSync(LOCAL) ? readdirSync(LOCAL).filter((n) => n.endsWith('.json')) : [];
  return loadPack(
    packFilesFrom(names.map((n): [string, unknown] => [n, JSON.parse(readFileSync(join(LOCAL, n), 'utf8'))])),
  );
}
