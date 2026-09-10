import { describe, expect, it } from 'vitest';
import { loadDefaultPack } from '@/data/packs/default';
import type { PackGeometry } from '@/data/schema/pack';
import { parsePath, prepareTrack, windInSector } from './track';

const pack = loadDefaultPack();
const track = (id: string) => pack.tracks.find((t) => t.id === id)!;
const geometry = (id: string) => pack.geometry.find((g) => g.trackId === id)!;

/** A square track, clockwise on screen: east along the top, south, west, north. Sides are 250 units. */
const square: PackGeometry = {
  trackId: 'square',
  viewBox: [0, 0, 1000, 1000],
  path: 'M0,0L250,0L250,250L0,250Z',
  sectors: [0.25, 0.75],
  drsZones: [{ from: 0.9, to: 0.1 }],
  pitLane: { entry: 0.97, exit: 0.03 },
  source: 'test',
};
const squareTrack = { ...track('al-rimal'), id: 'square', lengthKm: 4, drsZones: 1 };

describe('prepareTrack', () => {
  it('parses SVG path data into points', () => {
    expect(parsePath('M1,2L3.5,-4L5,6Z')).toEqual([
      [1, 2],
      [3.5, -4],
      [5, 6],
    ]);
  });

  it('splits every pack track into three sectors covering the whole lap', () => {
    for (const t of pack.tracks) {
      const model = prepareTrack(t, geometry(t.id));
      expect(model.sectors.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 10);
      for (const s of model.sectors) {
        expect(s.straightShare + s.cornerShare).toBeCloseTo(1, 6);
        expect(Math.hypot(...s.straight)).toBeLessThanOrEqual(s.straightShare + 1e-9);
      }
      expect(model.drsZones).toHaveLength(t.drsZones);
    }
  });

  it('assigns a DRS zone to the sector where it ends, even across the line', () => {
    const model = prepareTrack(squareTrack, square);
    expect(model.drsZones).toEqual([{ sector: 0, share: expect.closeTo(0.2, 10) as number }]);
  });

  it('records which way each sector’s straights face', () => {
    const model = prepareTrack(squareTrack, square);
    // Sector 1 (first quarter) runs east along the top: +x in SVG axes.
    expect(model.sectors[0].straight[0]).toBeGreaterThan(0.5);
    expect(Math.abs(model.sectors[0].straight[1])).toBeLessThan(1e-9);
  });
});

describe('wind by direction', () => {
  const model = prepareTrack(squareTrack, square);
  const east = model.sectors[0];

  it('is a tailwind for a straight running away from where it blows from', () => {
    // A westerly (blowing from 270°) pushes an eastbound car.
    expect(windInSector(east, 20, 270).tail).toBeGreaterThan(0);
    // An easterly is a headwind on the same straight.
    expect(windInSector(east, 20, 90).tail).toBeLessThan(0);
    // A northerly crosses it.
    expect(Math.abs(windInSector(east, 20, 0).tail)).toBeLessThan(1e-9);
  });

  it('scales with wind speed', () => {
    expect(windInSector(east, 30, 270).tail).toBeCloseTo(3 * windInSector(east, 10, 270).tail, 10);
  });
});
