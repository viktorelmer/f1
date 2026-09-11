/**
 * The pack the game runs on. The owner's real-world pack lives in `./local/` (gitignored, plan
 * section 10: a realistic pack stays with the project owner and never enters the repository); when
 * it is there, the app and the tests use it, otherwise the fictional default pack.
 *
 * Found with Vite's `import.meta.glob`, so this module works in the app and under Vitest; node
 * scripts read the folder themselves (`scripts/pack.ts`).
 */
import type { Pack } from '@/data/schema/pack';
import { loadPack, packFilesFrom } from './load';

const localFiles = import.meta.glob<unknown>('./local/*.json', { eager: true, import: 'default' });

/** True when a local pack is present: tests use it to skip hashes pinned for the default pack. */
export const isLocalPack = Object.keys(localFiles).length > 0;

let cached: Pack | undefined;

/** The active pack, validated once per process. */
export function loadActivePack(): Pack {
  cached ??= loadPack(
    packFilesFrom(
      Object.entries(localFiles).map(([path, json]) => [path.slice(path.lastIndexOf('/') + 1), json]),
    ),
  );
  return cached;
}
