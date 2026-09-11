/**
 * How a car moves round a lap between timing lines — for drawing, not for timing. The race knows
 * when each car crosses each sector line; inside a sector, a car spends its time the way a racing
 * car does: slow through corners, fast on the straights, braking into one and accelerating out.
 *
 * The profile comes from the track geometry: the corner radius along the path limits the speed
 * (v = √(a·R)), then acceleration and braking limits join the corners up. What the replay uses is
 * the profile's shape — the share of lap time spent reaching each point — so the sector times
 * from the race stay exact and only the motion inside a sector changes.
 */
import { balance } from '@/data/balance';
import type { PackGeometry, PackTrack } from '@/data/schema/pack';
import { parsePath, type Point } from './track';

export type LapMotion = {
  /** Share of the lap time spent reaching each of the evenly spaced points round the lap (first 0, last 1). */
  timeShare: number[];
  /** The lap time the profile itself implies, in seconds — a sanity check on the motion constants. */
  lapS: number;
};

/** Circumradius of three points, in the points' units; Infinity when they lie on a line. */
function radius(a: Point, b: Point, c: Point): number {
  const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
  const ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
  const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  return cross < 1e-9 ? Infinity : (ab * bc * ca) / (2 * cross);
}

export function lapMotion(track: PackTrack, geometry: PackGeometry): LapMotion {
  const m = balance.race.motion;
  const points = parsePath(geometry.path);
  const n = points.length;
  const cumulative = [0];
  for (let i = 1; i <= n; i++) {
    const [a, b] = [points[i - 1]!, points[i % n]!];
    cumulative.push(cumulative[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cumulative[n]!;
  const lengthM = track.lengthKm * 1000;
  const metresPerUnit = lengthM / total;

  // Evenly spaced samples along the path.
  const count = Math.max(12, Math.round(lengthM / m.sampleM));
  const stepM = lengthM / count;
  const at: Point[] = [];
  let seg = 0;
  for (let i = 0; i < count; i++) {
    const d = (i / count) * total;
    while (cumulative[seg + 1]! < d) seg++;
    const [a, b] = [points[seg]!, points[(seg + 1) % n]!];
    const span = cumulative[seg + 1]! - cumulative[seg]!;
    const s = span > 0 ? (d - cumulative[seg]!) / span : 0;
    at.push([a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s]);
  }

  // Cornering speed from the radius over a window either side of each sample.
  const w = Math.max(1, Math.round(m.curvatureWindowM / stepM));
  const vMax = m.maxSpeedKph / 3.6;
  const v = at.map((p, i) => {
    const r = radius(at[(i - w + count) % count]!, p, at[(i + w) % count]!) * metresPerUnit;
    return Math.min(vMax, Math.sqrt(m.lateralAccelMs2 * r));
  });

  // Acceleration out of corners and braking into them; twice round, as the lap is a loop.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i <= count; i++) {
      const [prev, cur] = [(i - 1) % count, i % count];
      v[cur] = Math.min(v[cur]!, Math.sqrt(v[prev]! ** 2 + 2 * m.accelMs2 * stepM));
    }
    for (let i = count - 1; i >= 0; i--) {
      const next = (i + 1) % count;
      v[i] = Math.min(v[i]!, Math.sqrt(v[next]! ** 2 + 2 * m.brakeMs2 * stepM));
    }
  }

  const timeShare = [0];
  for (let i = 0; i < count; i++) timeShare.push(timeShare[i]! + (2 * stepM) / (v[i]! + v[(i + 1) % count]!));
  const lapS = timeShare[count]!;
  return { timeShare: timeShare.map((s) => s / lapS), lapS };
}

/** Share of lap time spent reaching `fraction` of the lap distance. */
export function timeShareAt(motion: LapMotion, fraction: number): number {
  const { timeShare } = motion;
  const count = timeShare.length - 1;
  const x = Math.min(1, Math.max(0, fraction)) * count;
  const i = Math.min(count - 1, Math.floor(x));
  return timeShare[i]! + (timeShare[i + 1]! - timeShare[i]!) * (x - i);
}

/** The fraction of the lap distance reached after `share` of the lap time. */
export function fractionAtTimeShare(motion: LapMotion, share: number): number {
  const { timeShare } = motion;
  const count = timeShare.length - 1;
  const target = Math.min(1, Math.max(0, share));
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (timeShare[mid]! <= target) lo = mid;
    else hi = mid - 1;
  }
  const span = timeShare[lo + 1]! - timeShare[lo]!;
  return (lo + (span > 0 ? (target - timeShare[lo]!) / span : 0)) / count;
}
