/**
 * Building a pack from files. A pack is the set of JSON files the default pack ships; a user pack
 * may provide any subset of them, and each missing file falls back to the default pack's. Pure: the
 * caller finds the files (Vite's glob in the app and tests, the file system in node scripts).
 */
import { type Pack, parsePack } from '@/data/schema/pack';
import { defaultPackFiles } from './default';

export type PackFiles = typeof defaultPackFiles;
export type PackFileKey = keyof PackFiles;

/** File name in a pack folder → its key in `PackFiles`. */
export const PACK_FILE_NAMES: Record<string, PackFileKey> = {
  'manifest.json': 'manifest',
  'tracks.json': 'tracks',
  'geometry.json': 'geometry',
  'engine-suppliers.json': 'engineSuppliers',
  'teams.json': 'teams',
  'drivers.json': 'drivers',
  'staff.json': 'staff',
  'regulations.json': 'regulations',
  'calendars.json': 'calendars',
  'new-team.json': 'newTeam',
};

/** Pack files from `[file name, parsed JSON]` pairs; unknown file names are an error, not ignored. */
export function packFilesFrom(entries: Iterable<[string, unknown]>): Partial<Record<PackFileKey, unknown>> {
  const files: Partial<Record<PackFileKey, unknown>> = {};
  for (const [name, json] of entries) {
    const key = PACK_FILE_NAMES[name];
    if (!key)
      throw new Error(`Unknown pack file "${name}". Known: ${Object.keys(PACK_FILE_NAMES).join(', ')}`);
    files[key] = json;
  }
  return files;
}

/** The default pack with some of its files replaced, validated. Throws with every issue listed. */
export function loadPack(overrides: Partial<Record<PackFileKey, unknown>> = {}): Pack {
  const result = parsePack({ ...defaultPackFiles, ...overrides });
  if (!result.success) {
    const id = (overrides.manifest as { id?: string } | undefined)?.id ?? 'default';
    throw new Error(`Pack "${id}" is invalid:\n${result.issues.join('\n')}`);
  }
  return result.pack;
}
