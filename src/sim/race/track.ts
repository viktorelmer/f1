/**
 * Track preparation: what the race needs from a track's geometry, computed once per race.
 * For each sector — its share of the lap, how much of it is straight, and which way its straights
 * and corners face — so wind can act by direction (plan 5.4) — and where DRS zones end.
 */
import type { PackGeometry, PackTrack } from '@/data/schema/pack';
import type { SectorIndex } from './types';

export type SectorShape = {
  /** Share of the lap distance. */
  share: number;
  /** Share of the sector's length that is straight. */
  straightShare: number;
  /** Length-weighted unit heading of the straights, over the sector length (SVG axes, y down). */
  straight: [number, number];
  /** Share of the sector's length that is corner. */
  cornerShare: number;
  /** Mean cos 2θ and sin 2θ of corner headings — for the crosswind term, which depends on 2θ. */
  corner2: [number, number];
};

export type DrsZone = { sector: SectorIndex; share: number };

export type TrackModel = {
  track: PackTrack;
  sectors: [SectorShape, SectorShape, SectorShape];
  drsZones: DrsZone[];
};

/** Bends tighter than this radius count as corners. Matches the geometry import. */
const STRAIGHT_MIN_RADIUS_M = 450;

type Point = [number, number];

export function parsePath(path: string): Point[] {
  const numbers = path.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  const points: Point[] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) points.push([numbers[i]!, numbers[i + 1]!]);
  return points;
}

function sectorOf(fraction: number, starts: readonly [number, number]): SectorIndex {
  if (fraction < starts[0]) return 0;
  if (fraction < starts[1]) return 1;
  return 2;
}

export function prepareTrack(track: PackTrack, geometry: PackGeometry): TrackModel {
  const points = parsePath(geometry.path);
  const n = points.length;
  const segments = points.map((p, i) => {
    const q = points[(i + 1) % n]!;
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    return { length: Math.hypot(dx, dy), heading: Math.atan2(dy, dx) };
  });
  const total = segments.reduce((s, seg) => s + seg.length, 0);
  const metresPerUnit = (track.lengthKm * 1000) / total;

  // A vertex is a corner when the path bends tighter than the threshold radius there.
  const cornerAtVertex = points.map((_, i) => {
    const prev = segments[(i - 1 + n) % n]!;
    const next = segments[i]!;
    let turn = next.heading - prev.heading;
    while (turn > Math.PI) turn -= 2 * Math.PI;
    while (turn < -Math.PI) turn += 2 * Math.PI;
    const span = ((prev.length + next.length) / 2) * metresPerUnit;
    return span > 0 && Math.abs(turn) / span > 1 / STRAIGHT_MIN_RADIUS_M;
  });

  const [s2, s3] = geometry.sectors;
  const bounds = [0, s2, s3, 1];
  const acc = [0, 1, 2].map(() => ({ len: 0, straightLen: 0, sx: 0, sy: 0, cornerLen: 0, c2: 0, s2: 0 }));

  let at = 0;
  segments.forEach((seg, i) => {
    const mid = (at + seg.length / 2) / total;
    at += seg.length;
    const a = acc[sectorOf(mid, [s2, s3])]!;
    a.len += seg.length;
    // A segment between two corner vertices is part of a corner; otherwise it is straight.
    if (cornerAtVertex[i] && cornerAtVertex[(i + 1) % n]) {
      a.cornerLen += seg.length;
      a.c2 += seg.length * Math.cos(2 * seg.heading);
      a.s2 += seg.length * Math.sin(2 * seg.heading);
    } else {
      a.straightLen += seg.length;
      a.sx += seg.length * Math.cos(seg.heading);
      a.sy += seg.length * Math.sin(seg.heading);
    }
  });

  const sectors = acc.map((a, k): SectorShape => ({
    share: bounds[k + 1]! - bounds[k]!,
    straightShare: a.len > 0 ? a.straightLen / a.len : 0,
    straight: a.len > 0 ? [a.sx / a.len, a.sy / a.len] : [0, 0],
    cornerShare: a.len > 0 ? a.cornerLen / a.len : 0,
    corner2: a.cornerLen > 0 ? [a.c2 / a.cornerLen, a.s2 / a.cornerLen] : [0, 0],
  })) as TrackModel['sectors'];

  const drsZones = geometry.drsZones.map(({ from, to }): DrsZone => {
    const share = to >= from ? to - from : 1 - from + to;
    // The pass resolves where the zone ends, i.e. at the end of the sector containing `to`.
    return { sector: sectorOf(to === 0 ? 0.9999 : to, [s2, s3]), share };
  });

  return { track, sectors, drsZones };
}

/**
 * Wind as the car feels it in a sector: `tail` is the along-track component on straights (kph,
 * positive = tailwind, weighted by straight share), `cross` the mean crosswind² share in corners.
 * `fromDeg` is where the wind comes from, clockwise from north; SVG x points east, y points south.
 */
export function windInSector(
  shape: SectorShape,
  windKph: number,
  fromDeg: number,
): { tail: number; cross: number } {
  const beta = (fromDeg * Math.PI) / 180;
  // The wind blows towards the opposite bearing: in SVG axes that is (-sin β, +cos β).
  const toX = -Math.sin(beta);
  const toY = Math.cos(beta);
  const tail = windKph * (shape.straight[0] * toX + shape.straight[1] * toY);
  // Mean sin²(φ − θ) over corners, with φ the wind's heading: ½ − ½·(cos2φ·C2 + sin2φ·S2).
  const phi = Math.atan2(toY, toX);
  const meanSin2 = 0.5 - 0.5 * (Math.cos(2 * phi) * shape.corner2[0] + Math.sin(2 * phi) * shape.corner2[1]);
  return { tail, cross: windKph * shape.cornerShare * meanSin2 };
}
