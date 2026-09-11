import { describe, expect, it } from 'vitest';
import { loadActivePack } from './active';
import { defaultPackFiles } from './default';
import { loadPack, packFilesFrom } from './load';

describe('loadPack', () => {
  it('replaces whole files and keeps the default pack for the rest', () => {
    const tracks = defaultPackFiles.tracks.map((t) => ({ ...t, name: `${t.name} (renamed)` }));
    const pack = loadPack(packFilesFrom([['tracks.json', tracks]]));
    expect(pack.tracks.every((t) => t.name.endsWith('(renamed)'))).toBe(true);
    expect(pack.teams).toHaveLength(defaultPackFiles.teams.length);
  });

  it('names the pack and lists every issue when a user file is broken', () => {
    const manifest = { ...defaultPackFiles.manifest, id: 'broken' };
    const drivers = defaultPackFiles.drivers.map((d, i) => (i === 0 ? { ...d, nationality: 'Britain' } : d));
    expect(() => loadPack({ manifest, drivers })).toThrow(/Pack "broken" is invalid:\n.*nationality/);
  });

  it('rejects a file it does not know instead of ignoring it', () => {
    expect(() => packFilesFrom([['driver.json', []]])).toThrow(/Unknown pack file "driver.json"/);
  });

  it('loads the active pack — the local one when present — as a valid pack', () => {
    const pack = loadActivePack();
    expect(pack.teams.length).toBeGreaterThan(1);
    expect(loadActivePack()).toBe(pack);
  });
});
