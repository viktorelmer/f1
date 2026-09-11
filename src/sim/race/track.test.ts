import { describe, expect, it } from 'vitest';
import { balance } from '@/data/balance';
import { loadActivePack } from '@/data/packs/active';
import type { PackGeometry } from '@/data/schema/pack';
import { parsePath, prepareTrack, windInSector } from './track';

const pack = loadActivePack();
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

  it('cuts every pack track into segments covering the whole lap', () => {
    for (const t of pack.tracks) {
      const model = prepareTrack(t, geometry(t.id));
      expect(model.bounds[0]).toBe(0);
      expect(model.bounds.at(-1)).toBe(1);
      expect(model.segments).toHaveLength(model.bounds.length - 1);
      expect(model.segments.reduce((sum, x) => sum + x.share, 0)).toBeCloseTo(1, 10);
      for (const seg of model.segments) {
        expect(seg.share).toBeGreaterThan(0);
        expect(seg.straightShare + seg.cornerShare).toBeCloseTo(1, 6);
        expect(Math.hypot(...seg.straight)).toBeLessThanOrEqual(seg.straightShare + 1e-9);
      }
    }
  });

  it('keeps the three timing lines as segment boundaries, and each segment inside one sector', () => {
    for (const t of pack.tracks) {
      const g = geometry(t.id);
      const model = prepareTrack(t, g);
      for (const line of g.sectors) expect(model.bounds).toContain(line);
      // A segment lies inside one timing sector: its two ends agree on which one.
      model.segments.forEach((seg, k) => {
        const [from, to] = [model.bounds[k]!, model.bounds[k + 1]!];
        const sectorAt = (f: number) => (f < g.sectors[0] ? 0 : f < g.sectors[1] ? 1 : 2);
        expect(sectorAt(from)).toBe(seg.sector);
        expect(sectorAt(to - 1e-9)).toBe(seg.sector);
      });
    }
  });

  it('keeps every segment between the minimum and maximum share of a lap', () => {
    const { minShare, maxShare } = balance.race.segments;
    for (const t of pack.tracks) {
      const model = prepareTrack(t, geometry(t.id));
      // A boundary of its own may be closer than minShare to a timing line; nothing else may.
      for (const seg of model.segments) expect(seg.share).toBeLessThanOrEqual(maxShare + 1e-9);
      expect(model.segments.length).toBeGreaterThanOrEqual(Math.ceil(1 / maxShare));
      expect(model.segments.length).toBeLessThanOrEqual(Math.ceil(1 / minShare));
    }
  });

  it('accounts for every DRS zone across the segments it touches', () => {
    for (const t of pack.tracks) {
      const g = geometry(t.id);
      const model = prepareTrack(t, g);
      // The DRS lengths of the segments add up to exactly the zones of the geometry: an edge that
      // is too close to a boundary already kept does not get one of its own, but the share stays.
      const marked = model.segments.reduce((sum, seg) => sum + seg.drsShare, 0);
      const zones = g.drsZones.reduce(
        (sum, z) => sum + (z.to >= z.from ? z.to - z.from : 1 - z.from + z.to),
        0,
      );
      expect(marked).toBeCloseTo(zones, 9);
    }
  });

  it('marks the segments that lie in a DRS zone, and no others', () => {
    const model = prepareTrack(squareTrack, square);
    // The square track's single zone runs across the line, from 0.9 to 0.1.
    for (const [k, seg] of model.segments.entries()) {
      const mid = (model.bounds[k]! + model.bounds[k + 1]!) / 2;
      expect(seg.drsShare > 0).toBe(mid >= 0.9 || mid < 0.1);
    }
  });

  it('records which way each segment’s straights face', () => {
    const model = prepareTrack(squareTrack, square);
    // The first segment runs east along the top: +x in SVG axes.
    expect(model.segments[0]!.straight[0]).toBeGreaterThan(0.5);
    expect(Math.abs(model.segments[0]!.straight[1])).toBeLessThan(1e-9);
  });
});

describe('wind by direction', () => {
  const model = prepareTrack(squareTrack, square);
  const east = model.segments[0]!;

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
