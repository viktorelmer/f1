/**
 * Replay: a finished race, laid out in time, so a screen can ask "what did the race look like at
 * t seconds?" (docs/systems/race-screen.md). Pure and deterministic — the race result is the only
 * source; nothing here rolls dice or reads a clock.
 *
 * Every car's sector-boundary crossings are known from the lap chart. Between two crossings a car
 * moves linearly through the sector — the "interpolation between simulation ticks" of plan 6.3,
 * with the right relative speeds per sector. A stop is carved out of the in-lap's last sector: the
 * car reaches the line area, then waits in the box.
 */
import { balance } from '@/data/balance';
import type { Compound } from '@/data/schema/race-balance';
import { fractionAtTimeShare, type LapMotion, lapMotion, timeShareAt } from './motion';
import { prepareTrack } from './track';
import { sampleAt } from './weather';
import type { Estimate } from '../knowledge/estimate';
import type {
  RaceEvent,
  RaceInput,
  RadioSettings,
  RaceResult,
  ScheduledStint,
  TrackStatus,
  WeatherSample,
} from './types';

type CarTimeline = {
  driverId: string;
  teamId: string;
  /** Start time of each segment (lap × 3 + sector) and its end; segment 0 starts at the signal. */
  starts: number[];
  ends: number[];
  /** Seconds at the end of each segment spent in the pit lane (only an in-lap's last sector). */
  pitS: number[];
  /** Where the car stood at the signal: its grid slot, as a fraction of a lap behind the line. */
  gridOffset: number;
  /** When it got across the line: from the grid slot to the line before, the first sector after. */
  launchS: number;
  finishTime: number | null;
  retireTime: number | null;
  retireReason: string | null;
};

export type Replay = {
  input: RaceInput;
  result: RaceResult;
  cars: CarTimeline[];
  /** Sector boundaries as fractions of the lap: [0, s2, s3, 1]. */
  /** Segment boundaries as lap fractions, `segments + 1` of them (docs/systems/lap-segments.md). */
  segmentBounds: number[];
  /** How a car spends its time round the lap — slow in corners, fast on straights (drawing only). */
  motion: LapMotion;
  /** Events in time order. */
  events: RaceEvent[];
  /** When the last car took the flag or retired: the end of the replay. */
  durationS: number;
  totalLaps: number;
};

export type CarStatus = 'running' | 'pit' | 'finished' | 'retired';

export type CarFrame = {
  driverId: string;
  teamId: string;
  position: number;
  status: CarStatus;
  retireReason: string | null;
  /** Laps completed plus the fraction of the current lap: 23.4 is 40% into lap 24. */
  progress: number;
  /** The lap being driven (or the last one, once finished or out). */
  lap: number;
  /** Behind the leader at the last timing line, seconds; null when lapped or out. */
  gapS: number | null;
  /** Laps behind the leader (0 when on the lead lap). */
  lapsDown: number;
  /** Behind the car ahead at the last timing line, seconds; null for the leader or when a lap apart. */
  intervalS: number | null;
  compound: Compound;
  tyreAge: number;
  /** 0..1 of the tyre used up — the team's own telemetry. */
  tyreWear: number;
  battery: number;
  fuelKg: number;
  stops: number;
  lastLapS: number | null;
  bestLapS: number | null;
  /** The strategist's plan as it stands: the stint being driven and the ones after it. */
  plan: readonly ScheduledStint[];
  /** The player's cars only: the radio as it runs now, and the strategist's latest forecast. */
  radio: RadioSettings | null;
  forecast: { position: Estimate; window: [number, number] | null; lap: number } | null;
};

export type RaceFrame = {
  timeS: number;
  /** The lap the leader is on, 1..totalLaps. */
  lap: number;
  totalLaps: number;
  status: TrackStatus;
  weather: WeatherSample;
  wetness: [number, number, number];
  cars: CarFrame[];
  /** Events up to this moment, oldest first. */
  events: RaceEvent[];
  finished: boolean;
};

export function buildReplay(input: RaceInput, result: RaceResult): Replay {
  const model = prepareTrack(input.track, input.geometry);
  const segments = model.segments.length;
  const events = [...result.events].sort((a, b) => a.timeS - b.timeS);

  const cars = result.classification.map((c): CarTimeline => {
    const laps = result.laps[c.driverId] ?? [];
    const starts: number[] = [];
    const ends: number[] = [];
    const pitS: number[] = [];
    let t = 0;
    for (const lap of laps) {
      lap.segmentsS.forEach((seconds, k) => {
        starts.push(t);
        // Each lap ends on its recorded line time, so rounded segment times never add up to drift.
        t = k === segments - 1 ? lap.lineTimeS : t + seconds;
        ends.push(t);
        pitS.push(k === segments - 1 ? lap.pitLaneS : 0);
      });
    }
    const retirement = events.find((e) => e.kind === 'retirement' && e.driverId === c.driverId);
    // The lap chart only holds completed laps. A car that stopped mid-lap is carried on through its
    // last lap at its previous lap's sector pace, up to the sector where it stopped.
    if (retirement && retirement.timeS > t) {
      const pace =
        laps.at(-1)?.segmentsS ?? model.segments.map((shape) => input.track.baseLapTime * shape.share);
      const lastSegment = retirement.segment ?? 0;
      for (let k = 0; k <= lastSegment && t < retirement.timeS; k++) {
        starts.push(t);
        t = k === lastSegment ? retirement.timeS : Math.min(retirement.timeS, t + pace[k]!);
        ends.push(t);
        pitS.push(0);
      }
    }
    // The first sector is driven from the moment the car gets across the line.
    const launchS = result.launchS[c.driverId] ?? 0;
    if (starts.length > 0) starts[0] = Math.min(launchS, ends[0]!);
    return {
      driverId: c.driverId,
      teamId: c.teamId,
      starts,
      ends,
      pitS,
      // A slot is the start's slot delay at the track's average speed — about 15 m, close to a real grid.
      launchS,
      gridOffset:
        (Math.max(0, input.grid.indexOf(c.driverId)) * balance.race.start.gridSlotS) /
        input.track.baseLapTime,
      finishTime: c.status === 'finished' ? c.totalTimeS : null,
      retireTime: retirement ? retirement.timeS : null,
      retireReason: c.retireReason,
    };
  });

  const durationS = Math.max(
    ...cars.map((c) => c.finishTime ?? c.retireTime ?? c.ends[c.ends.length - 1] ?? 0),
    events[events.length - 1]?.timeS ?? 0,
  );
  return {
    input,
    result,
    cars,
    segmentBounds: model.bounds,
    motion: lapMotion(input.track, input.geometry),
    events,
    durationS,
    totalLaps: input.track.laps,
  };
}

/** Index of the last element ≤ x in an ascending array (−1 if none). */
function lastAtOrBefore(xs: readonly number[], x: number): number {
  let lo = 0;
  let hi = xs.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! <= x) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

type Position = { segmentsDone: number; progress: number; inPit: boolean };

/** Where a car is at time t: segments completed and progress in laps. */
function locate(car: CarTimeline, bounds: Replay['segmentBounds'], motion: LapMotion, t: number): Position {
  const done = lastAtOrBefore(car.ends, t) + 1;
  if (done >= car.ends.length)
    return { segmentsDone: car.ends.length, progress: car.ends.length / (bounds.length - 1), inPit: false };
  const start = car.starts[done]!;
  const end = car.ends[done]!;
  const pit = car.pitS[done]!;
  const perLap = bounds.length - 1;
  const k = done % perLap;
  const lapBase = Math.floor(done / perLap);
  const driveEnd = end - pit;
  const share = Math.min(1, Math.max(0, (t - start) / Math.max(1e-6, driveEnd - start)));
  // The first sector starts on the grid slot: up to the line by the launch time, so the cars stand
  // in grid order at the signal and the launch order shows the moment they get away.
  if (done === 0 && (t <= 0 || t < car.launchS)) {
    // Here t < launchS whenever t > 0, so the division is safe.
    const moved = t <= 0 ? 0 : t / car.launchS;
    return { segmentsDone: 0, progress: -car.gridOffset * (1 - moved), inPit: false };
  }
  // The segment's time spread along the lap's speed profile: braking into corners, fast on straights.
  const [from, to] = [timeShareAt(motion, bounds[k]!), timeShareAt(motion, bounds[k + 1]!)];
  const fraction = fractionAtTimeShare(motion, from + (to - from) * share);
  return { segmentsDone: done, progress: lapBase + fraction, inPit: pit > 0 && t > driveEnd };
}

/** The crossing time of segment boundary `segment` (end of segment index segment−1) for a car. */
const crossingTime = (car: CarTimeline, segmentsDone: number) =>
  segmentsDone === 0 ? 0 : car.ends[segmentsDone - 1]!;

/** The last entry of a time-ordered log made by time `t`. */
function latest<T extends { timeS: number }>(log: readonly T[] | undefined, t: number): T | undefined {
  if (!log) return undefined;
  let found: T | undefined;
  for (const entry of log) {
    if (entry.timeS > t) break;
    found = entry;
  }
  return found;
}

/** The last plan revision made by time `t`. */
function planAt(history: RaceResult['planHistory'][string], t: number): readonly ScheduledStint[] {
  let i = history.length - 1;
  while (i > 0 && history[i]!.timeS > t) i--;
  return history[i]?.stints ?? [];
}

export function frameAt(replay: Replay, timeS: number): RaceFrame {
  const t = Math.max(0, Math.min(timeS, replay.durationS));
  const { result, totalLaps } = replay;
  /** Segments in a lap of this track: laps and lap counts are read off the segment count. */
  const perLap = replay.segmentBounds.length - 1;

  // ── Each car's state ──
  type CarState = { car: CarTimeline; pos: ReturnType<typeof locate>; status: CarStatus; frame: CarFrame };
  const states = replay.cars.map((car): CarState => {
    const retired = car.retireTime !== null && t >= car.retireTime;
    const finished = car.finishTime !== null && t >= car.finishTime;
    const pos = locate(car, replay.segmentBounds, replay.motion, retired ? car.retireTime! : t);
    const laps = result.laps[car.driverId] ?? [];
    const completedLaps = Math.min(laps.length, Math.floor(pos.segmentsDone / perLap));
    const current = laps[Math.min(completedLaps, laps.length - 1)];
    const previous = completedLaps > 0 ? laps[completedLaps - 1] : undefined;
    const done = laps.slice(0, completedLaps);
    const clean = done.filter((l) => l.lap > 1 && !l.pitted);
    const stops = done.filter((l) => l.pitted).length + (pos.inPit ? 1 : 0);
    const status: CarStatus = retired ? 'retired' : finished ? 'finished' : pos.inPit ? 'pit' : 'running';
    // A car on a fresh set after a stop starts its wear from zero.
    const freshAfterStop = previous?.pitted ?? false;
    return {
      car,
      pos,
      status,
      frame: {
        driverId: car.driverId,
        teamId: car.teamId,
        position: 0,
        status,
        retireReason: retired ? car.retireReason : null,
        progress: pos.progress,
        lap: Math.min(totalLaps, Math.max(1, completedLaps + (finished || retired ? 0 : 1))),
        gapS: null,
        lapsDown: 0,
        intervalS: null,
        compound: current?.compound ?? 'medium',
        tyreAge: current?.tyreAge ?? 0,
        tyreWear: freshAfterStop || !previous ? 0 : previous.tyreWear,
        battery: previous?.battery ?? 1,
        fuelKg: previous?.fuelKg ?? current?.fuelKg ?? 0,
        stops,
        lastLapS: previous?.lapTimeS ?? null,
        bestLapS: clean.length ? Math.min(...clean.map((l) => l.lapTimeS)) : null,
        plan: planAt(result.planHistory[car.driverId] ?? [], t),
        radio: latest(result.pitWall?.radio[car.driverId], t)?.settings ?? null,
        forecast: latest(result.pitWall?.forecasts[car.driverId], t) ?? null,
      },
    };
  });

  // ── Order: by distance covered (a finisher's is whole laps), ties by who crossed first; the
  // retired at the back, as the classification ranks them: laps done, then the later retirement.
  states.sort((a, b) => {
    const aOut = a.status === 'retired';
    const bOut = b.status === 'retired';
    if (aOut !== bOut) return aOut ? 1 : -1;
    if (aOut) {
      return (
        Math.floor(b.pos.segmentsDone / perLap) - Math.floor(a.pos.segmentsDone / perLap) ||
        b.car.retireTime! - a.car.retireTime!
      );
    }
    return (
      b.pos.progress - a.pos.progress ||
      crossingTime(a.car, a.pos.segmentsDone) - crossingTime(b.car, b.pos.segmentsDone)
    );
  });

  // ── Gaps and intervals at the last timing line each car crossed ──
  const leader = states[0]!;
  states.forEach((s, i) => {
    s.frame.position = i + 1;
    if (s.status === 'retired') return;
    const lapsBehind = Math.floor((leader.pos.segmentsDone - s.pos.segmentsDone) / perLap);
    s.frame.lapsDown = Math.max(0, lapsBehind);
    if (lapsBehind === 0 && i > 0 && s.pos.segmentsDone > 0) {
      // At the line the lap chart has the gap to the ms; between lines, the two cars' crossings.
      const atLine =
        s.pos.segmentsDone % perLap === 0
          ? result.laps[s.car.driverId]?.[s.pos.segmentsDone / perLap - 1]
          : undefined;
      s.frame.gapS =
        atLine?.gapToLeaderS ??
        crossingTime(s.car, s.pos.segmentsDone) - crossingTime(leader.car, s.pos.segmentsDone);
    } else if (i === 0) s.frame.gapS = 0;
    const ahead = states[i - 1];
    if (ahead && ahead.status !== 'retired' && s.pos.segmentsDone > 0) {
      const apart = Math.floor((ahead.pos.segmentsDone - s.pos.segmentsDone) / perLap);
      if (apart === 0) {
        s.frame.intervalS =
          crossingTime(s.car, s.pos.segmentsDone) - crossingTime(ahead.car, s.pos.segmentsDone);
      }
    }
  });

  // ── Race-wide state ──
  const events = replay.events.filter((e) => e.timeS <= t);
  let status: TrackStatus = 'green';
  for (const e of events) {
    if (e.kind === 'safety-car') status = 'sc';
    else if (e.kind === 'vsc' && status !== 'sc') status = 'vsc';
    else if (e.kind === 'safety-car-in' || e.kind === 'vsc-end') status = 'green';
  }
  const leaderLaps = Math.floor(leader.pos.segmentsDone / perLap);
  const conditions = result.conditions.filter((c) => c.lap <= leaderLaps).at(-1) ?? result.conditions[0];

  return {
    timeS: t,
    lap: Math.min(totalLaps, leaderLaps + 1),
    totalLaps,
    status,
    weather: sampleAt(replay.input.weather, t),
    wetness: conditions?.wetness ?? [0, 0, 0],
    cars: states.map((s) => s.frame),
    events,
    finished: t >= replay.durationS,
  };
}
