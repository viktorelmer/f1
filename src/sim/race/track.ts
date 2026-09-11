/**
 * Track preparation: what the race needs from a track's geometry, computed once per race
 * (docs/systems/lap-segments.md). The lap is cut into segments — the simulation's step — at the
 * three timing lines, at the edges of every DRS zone and at the braking point of every corner that
 * follows a long straight. For each segment: its share of the lap, how much of it is straight, and
 * which way its straights and corners face, so wind can act by direction (plan 5.4).
 *
 * Timing sectors stay three: the protocol, the weather and the lap chart work in them, and every
 * segment belongs to exactly one of them.
 */
import { balance } from '@/data/balance';
import type { PackGeometry, PackTrack } from '@/data/schema/pack';
import type { SectorIndex } from './types';

export type SectorShape = {
  /** Share of the lap distance. */
  share: number;
  /** Share of the segment's length that is straight. */
  straightShare: number;
  /** Length-weighted unit heading of the straights, over the segment length (SVG axes, y down). */
  straight: [number, number];
  /** Share of the segment's length that is corner. */
  cornerShare: number;
  /** Mean cos 2θ and sin 2θ of corner headings — for the crosswind term, which depends on 2θ. */
  corner2: [number, number];
};

export type SegmentShape = SectorShape & {
  /** The timing sector this segment lies in: weather wetness and the protocol still work in three. */
  sector: SectorIndex;
  /** Share of the lap this segment has inside a DRS zone — 0 outside one, `share` when wholly in. */
  drsShare: number;
  /** Opens with a braking zone after a long straight — where cars actually overtake. */
  braking: boolean;
};

export type TrackModel = {
  track: PackTrack;
  /** Segment boundaries as lap fractions: `bounds[0]` is 0, the last is 1. */
  bounds: number[];
  segments: SegmentShape[];
};

/** Bends tighter than this radius count as corners. Matches the geometry import. */
const STRAIGHT_MIN_RADIUS_M = 450;

export type Point = [number, number];

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
  const b = balance.race.segments;

  // Braking points: where a corner sequence opens after a straight long enough to attack down.
  // Two laps of the loop, marks taken on the second, so the straight before the line counts too.
  const brakingAt: number[] = [];
  const isCorner = (i: number) => cornerAtVertex[i]! && cornerAtVertex[(i + 1) % n]!;
  let straightM = 0;
  let at = 0;
  for (let pass = 0; pass < 2; pass++) {
    at = 0;
    for (let i = 0; i < n; i++) {
      const seg = segments[i]!;
      if (isCorner(i)) {
        if (straightM >= b.brakingAfterStraightM && pass === 1) brakingAt.push(at / total);
        straightM = 0;
      } else straightM += seg.length * metresPerUnit;
      at += seg.length;
    }
  }

  // The three timing lines are always boundaries; a DRS edge or braking point joins them when it is
  // at least `minShare` of the lap away from every boundary already kept.
  const bounds = [0, s2, s3];
  const far = (f: number) =>
    bounds.every((k) => {
      const d = Math.abs(f - k);
      return Math.min(d, 1 - d) >= b.minShare;
    });
  const optional = [...geometry.drsZones.flatMap(({ from, to }) => [from, to]), ...brakingAt].sort(
    (x, y) => x - y,
  );
  for (const f of optional) if (f > 0 && f < 1 && far(f)) bounds.push(f);
  bounds.sort((x, y) => x - y);
  bounds.push(1);

  // No stretch of the lap may run longer than `maxShare` unwatched: a long one is split evenly, so
  // traffic, dirty air and the gap are re-read everywhere, not only where the track invites a move.
  for (let k = 0; k < bounds.length - 1; k++) {
    const span = bounds[k + 1]! - bounds[k]!;
    if (span <= b.maxShare) continue;
    const pieces = Math.ceil(span / b.maxShare);
    const cuts = Array.from({ length: pieces - 1 }, (_, i) => bounds[k]! + (span * (i + 1)) / pieces);
    bounds.splice(k + 1, 0, ...cuts);
    k += cuts.length;
  }

  /** How much of [from, to) lies inside a DRS zone, in lap fractions; zones may cross the line. */
  const drsShareOf = (from: number, to: number) =>
    geometry.drsZones.reduce((sum, z) => {
      const spans =
        z.to >= z.from
          ? [[z.from, z.to]]
          : [
              [z.from, 1],
              [0, z.to],
            ];
      return sum + spans.reduce((s2, [a, b]) => s2 + Math.max(0, Math.min(to, b!) - Math.max(from, a!)), 0);
    }, 0);

  const count = bounds.length - 1;
  const acc = Array.from({ length: count }, () => ({
    len: 0,
    straightLen: 0,
    sx: 0,
    sy: 0,
    cornerLen: 0,
    c2: 0,
    s2: 0,
  }));
  const segmentOf = (fraction: number) => {
    let lo = 0;
    let hi = count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (bounds[mid]! <= fraction) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  at = 0;
  segments.forEach((seg, i) => {
    const [from, to] = [at / total, (at + seg.length) / total];
    at += seg.length;
    // A piece between two corner vertices is part of a corner; otherwise it is straight. A piece
    // that straddles a boundary is shared between the segments by how much of it falls in each, so
    // no segment comes out empty however short it is.
    const corner = cornerAtVertex[i]! && cornerAtVertex[(i + 1) % n]!;
    for (let k = segmentOf(from); k < count && bounds[k]! < to; k++) {
      const length = (Math.min(to, bounds[k + 1]!) - Math.max(from, bounds[k]!)) * total;
      if (length <= 0) continue;
      const a = acc[k]!;
      a.len += length;
      if (corner) {
        a.cornerLen += length;
        a.c2 += length * Math.cos(2 * seg.heading);
        a.s2 += length * Math.sin(2 * seg.heading);
      } else {
        a.straightLen += length;
        a.sx += length * Math.cos(seg.heading);
        a.sy += length * Math.sin(seg.heading);
      }
    }
  });

  const brakingSet = new Set(brakingAt);
  const shapes = acc.map((a, k): SegmentShape => {
    const from = bounds[k]!;
    const mid = (from + bounds[k + 1]!) / 2;
    return {
      share: bounds[k + 1]! - from,
      straightShare: a.len > 0 ? a.straightLen / a.len : 0,
      straight: a.len > 0 ? [a.sx / a.len, a.sy / a.len] : [0, 0],
      cornerShare: a.len > 0 ? a.cornerLen / a.len : 0,
      corner2: a.cornerLen > 0 ? [a.c2 / a.cornerLen, a.s2 / a.cornerLen] : [0, 0],
      sector: sectorOf(mid, [s2, s3]),
      drsShare: drsShareOf(from, bounds[k + 1]!),
      braking: brakingSet.has(from),
    };
  });

  return { track, bounds, segments: shapes };
}

/**
 * A point-at-fraction function for a closed polyline — how the track map places a car that is
 * `fraction` of the way round the lap. The pack's paths are polylines, so this is exact, and
 * unlike SVGPathElement.getPointAtLength it needs no DOM.
 */
export function pathSampler(points: readonly Point[]): (fraction: number) => Point {
  const n = points.length;
  const cumulative = [0];
  for (let i = 1; i <= n; i++) {
    const [a, b] = [points[i - 1]!, points[i % n]!];
    cumulative.push(cumulative[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cumulative[n]!;
  return (fraction) => {
    const at = (((fraction % 1) + 1) % 1) * total;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cumulative[mid]! <= at) lo = mid;
      else hi = mid - 1;
    }
    const [a, b] = [points[lo]!, points[(lo + 1) % n]!];
    const span = cumulative[lo + 1]! - cumulative[lo]!;
    const s = span > 0 ? (at - cumulative[lo]!) / span : 0;
    return [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];
  };
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
