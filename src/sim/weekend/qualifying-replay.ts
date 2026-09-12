/**
 * Qualifying on the clock (docs/systems/weekend-play.md). The session already happens in time —
 * every lap knows when it started and ended, and traffic is the consequence of two cars being in
 * the same place in the same second — so playing it back needs no new simulation, only the parts
 * laid end to end and a frame function.
 *
 * `qualifyingFrameAt(replay, t)` is pure: the part, the time left in it, the board with the drop
 * zone, and where each car is on its lap.
 */
import { balance } from '@/data/balance';
import type { DriverId, TeamId } from '../types/world';
import type { QualifyingLap, QualifyingPart, QualifyingResult } from './qualifying';

export type QualifyingReplay = {
  result: QualifyingResult;
  /**
   * The parts on the session clock, laid one after another. `clockEndS` is when the part's own
   * clock runs out; `endS` is when the last car still on a lap is back, which is when the next part
   * can begin — a lap started before the flag is a lap that counts.
   */
  parts: { part: QualifyingPart; startS: number; clockEndS: number; endS: number; cars: DriverId[] }[];
  /** Every lap on the session clock, not the part clock. */
  laps: (QualifyingLap & { sessionStartS: number; sessionEndS: number })[];
  durationS: number;
};

/** What a car is doing: in the garage, on its way to the lap, on the lap, or back in. */
export type QualifyingCarState = 'garage' | 'out-lap' | 'flying' | 'returning' | 'out';

export type QualifyingCarFrame = {
  driverId: DriverId;
  teamId: TeamId;
  position: number;
  state: QualifyingCarState;
  /** The time that counts for this car right now, and the gap to the leader of the board. */
  timeS: number | null;
  gapS: number | null;
  /** How far along its flying lap the car is, 0..1 — null when it is not on one. */
  lapProgress: number | null;
  /** In the drop zone as the board stands: out of the session if the part ended now. */
  inDropZone: boolean;
  /** Already knocked out in an earlier part. */
  knockedOut: boolean;
};

export type QualifyingFrame = {
  timeS: number;
  durationS: number;
  part: QualifyingPart;
  /** Seconds left in the part, and whether the part has ended but the next has not begun. */
  partRemainingS: number;
  finished: boolean;
  cars: QualifyingCarFrame[];
  /** Laps completed so far, newest last. */
  laps: readonly QualifyingLap[];
};

export function buildQualifyingReplay(result: QualifyingResult): QualifyingReplay {
  const q = balance.weekend.qualifying;
  const parts: QualifyingReplay['parts'] = [];
  let startS = 0;
  for (const part of [0, 1, 2] as QualifyingPart[]) {
    const clockEndS = startS + q.partMinutes[part] * 60;
    const lastBack = Math.max(0, ...result.laps.filter((l) => l.part === part).map((l) => l.endS));
    parts.push({
      part,
      startS,
      clockEndS,
      endS: Math.max(clockEndS, startS + lastBack),
      cars: result.runs.filter((r) => r.part === part).map((r) => r.driverId),
    });
    startS = parts[parts.length - 1]!.endS;
  }
  const laps = result.laps.map((lap) => {
    const offset = parts[lap.part]!.startS;
    return { ...lap, sessionStartS: offset + lap.startS, sessionEndS: offset + lap.endS };
  });
  return { result, parts, laps, durationS: startS };
}

export function qualifyingFrameAt(replay: QualifyingReplay, timeS: number): QualifyingFrame {
  const q = balance.weekend.qualifying;
  const t = Math.max(0, Math.min(replay.durationS, timeS));
  const current = replay.parts.find((p) => t < p.endS) ?? replay.parts[replay.parts.length - 1]!;
  const done = replay.laps.filter((l) => l.sessionEndS <= t);

  /**
   * The time that counts for each car right now: the lap it has set in the part being run, and for
   * a car already out, the lap that settled its place — which is what a timing screen shows.
   */
  const counts = new Map<DriverId, QualifyingLap>();
  for (const lap of done) if (lap.part <= current.part) counts.set(lap.driverId, lap);

  const running = current.cars;
  const cars: QualifyingCarFrame[] = replay.result.session.classification.map((car) => {
    const lap = replay.laps.find((l) => l.driverId === car.driverId && l.part === current.part);
    const run = replay.result.runs.find((r) => r.driverId === car.driverId && r.part === current.part);
    const outAtS = run?.outAtS === undefined || run.outAtS === null ? null : current.startS + run.outAtS;
    const timed = counts.get(car.driverId);
    const state: QualifyingCarState = !running.includes(car.driverId)
      ? 'out'
      : outAtS === null || t < outAtS
        ? 'garage'
        : lap && t < lap.sessionStartS
          ? 'out-lap'
          : lap && t < lap.sessionEndS
            ? 'flying'
            : 'returning';
    return {
      driverId: car.driverId,
      teamId: car.teamId,
      position: 0,
      state,
      timeS: timed?.timeS ?? null,
      gapS: null,
      lapProgress: state === 'flying' && lap ? (t - lap.sessionStartS) / Math.max(1e-6, lap.timeS) : null,
      inDropZone: false,
      knockedOut: !running.includes(car.driverId),
    };
  });

  // The board: everyone still in the session, quickest first and no-time last; then the cars
  // already out, behind them, holding the places they were knocked out in.
  const settled = new Map(replay.result.order.map((id, i) => [id, i]));
  cars.sort((a, b) => {
    if (a.knockedOut !== b.knockedOut) return a.knockedOut ? 1 : -1;
    if (a.knockedOut) return settled.get(a.driverId)! - settled.get(b.driverId)!;
    return (a.timeS ?? Infinity) - (b.timeS ?? Infinity);
  });
  const leader = cars.find((c) => !c.knockedOut && c.timeS !== null)?.timeS ?? null;
  const survivors = current.part === 2 ? running.length : running.length - q.knockedOut;
  cars.forEach((car, i) => {
    car.position = i + 1;
    car.gapS = car.timeS !== null && leader !== null ? car.timeS - leader : null;
    car.inDropZone = !car.knockedOut && i >= survivors;
  });

  return {
    timeS: t,
    durationS: replay.durationS,
    part: current.part,
    partRemainingS: Math.max(0, current.clockEndS - t),
    finished: t >= replay.durationS,
    cars,
    laps: done,
  };
}
