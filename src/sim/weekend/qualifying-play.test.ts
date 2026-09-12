/**
 * Qualifying as something you sit through (docs/systems/weekend-play.md): three parts on one clock,
 * a drop zone that means something while the part runs, and a pit wall that can send the car out.
 */
import { describe, expect, it } from 'vitest';
import { balance } from '@/data/balance';
import { loadActivePack } from '@/data/packs/active';
import { buildRaceInput } from '../race/build-input';
import type { RaceControl, RaceInput } from '../race/types';
import type { TyreAllocation } from '../types/world';
import { createWorld } from '../world/create-world';
import { buildQualifyingReplay, qualifyingFrameAt } from './qualifying-replay';
import { type QualifyingCommand, runQualifying } from './qualifying';

const pack = loadActivePack();
const TEAM = 'kestrel';
const world = createWorld('quali-play', pack, {
  mode: 'takeover',
  teamId: TEAM,
  principalName: 'Test',
});
const round = world.season.calendar.find((r) => r.trackId === 'al-rimal')!.round;
const mine = world.teams[TEAM]!.drivers.race;
const q = balance.weekend.qualifying;

const plenty = (race: RaceInput): Record<string, TyreAllocation> =>
  Object.fromEntries(race.entries.map((e) => [e.driverId, { soft: 9, medium: 9, hard: 9 }]));

const control = (mode: RaceControl['strategy']['mode']): RaceControl => ({
  teamId: TEAM,
  strategy: { mode, risk: 0.5, goal: 'fastest' },
  radio: { mode: 'delegated', aggression: 'normal', saving: 'none' },
  plans: {},
});

function session(seed: string, options: { control?: RaceControl; commands?: QualifyingCommand[] } = {}) {
  const race = buildRaceInput(world, pack, round, seed, { control: options.control ?? null });
  return runQualifying({
    race,
    session: 'qualifying',
    setupLossS: {},
    sets: plenty(race),
    commands: options.commands,
  });
}

describe('qualifying on a clock', () => {
  const result = session('clock');
  const replay = buildQualifyingReplay(result);

  it('lays the three parts end to end and puts every lap inside its own', () => {
    expect(replay.parts).toHaveLength(3);
    const clock = q.partMinutes.reduce((a, b) => a + b, 0) * 60;
    // The session is its three clocks, plus however long the last car of each part takes to finish
    // the lap it started before the flag.
    expect(replay.durationS).toBeGreaterThanOrEqual(clock);
    expect(replay.durationS).toBeLessThan(clock + 3 * 120);
    for (const [i, part] of replay.parts.entries()) {
      if (i > 0) expect(part.startS).toBe(replay.parts[i - 1]!.endS);
      expect(part.endS).toBeGreaterThanOrEqual(part.clockEndS);
    }
    for (const lap of replay.laps) {
      const part = replay.parts[lap.part]!;
      expect(lap.sessionStartS).toBeGreaterThanOrEqual(part.startS);
      // Every car is out on track before its part's clock runs out, and back inside the part.
      expect(lap.sessionStartS).toBeLessThanOrEqual(part.clockEndS);
      expect(lap.sessionEndS).toBeLessThanOrEqual(part.endS + 1e-6);
    }
  });

  it('moves a car from the garage onto its lap and back', () => {
    const run = result.runs.find((r) => r.part === 0 && r.driverId === mine[0])!;
    const lap = replay.laps.find((l) => l.part === 0 && l.driverId === mine[0])!;
    const at = (t: number) => qualifyingFrameAt(replay, t).cars.find((c) => c.driverId === mine[0])!;
    expect(at(Math.max(0, run.outAtS! - 1)).state).toBe('garage');
    expect(at((run.outAtS! + lap.sessionStartS) / 2).state).toBe('out-lap');
    const flying = at((lap.sessionStartS + lap.sessionEndS) / 2);
    expect(flying.state).toBe('flying');
    expect(flying.lapProgress).toBeGreaterThan(0);
    expect(flying.lapProgress).toBeLessThan(1);
    expect(at(lap.sessionEndS + 1).state).toBe('returning');
    expect(at(lap.sessionEndS + 1).timeS).toBeCloseTo(lap.timeS, 6);
  });

  it('ends each part with exactly five cars knocked out, and the last with the grid', () => {
    const endOfQ1 = qualifyingFrameAt(replay, replay.parts[0]!.endS - 0.001);
    expect(endOfQ1.part).toBe(0);
    expect(endOfQ1.cars.filter((c) => c.inDropZone)).toHaveLength(q.knockedOut);
    const inQ2 = qualifyingFrameAt(replay, replay.parts[1]!.startS + 1);
    expect(inQ2.cars.filter((c) => c.knockedOut)).toHaveLength(q.knockedOut);
    const flag = qualifyingFrameAt(replay, replay.durationS);
    expect(flag.finished).toBe(true);
    expect(flag.cars.map((c) => c.driverId)).toEqual(result.order);
  });

  it('is the classification at the flag, to the millisecond', () => {
    const flag = qualifyingFrameAt(replay, replay.durationS);
    for (const car of result.session.classification) {
      const frame = flag.cars.find((c) => c.driverId === car.driverId)!;
      expect(frame.position).toBe(car.position);
      if (car.bestLapS !== null) expect(Math.round(frame.timeS! * 1000) / 1000).toBe(car.bestLapS);
    }
  });
});

describe('the pit wall in qualifying', () => {
  it('lets the player send a car out earlier than the strategist would', () => {
    const base = session('send');
    const run = base.runs.find((r) => r.part === 0 && r.driverId === mine[0])!;
    expect(run.by).toBe('strategist');
    const early = Math.max(0, run.recommendedAtS - 120);
    const changed = session('send', { commands: [{ atS: early, part: 0, driverId: mine[0] }] });
    const moved = changed.runs.find((r) => r.part === 0 && r.driverId === mine[0])!;
    expect(moved.outAtS).toBe(early);
    expect(moved.by).toBe('player');
    // The strategist still decided — his recommendation, and everyone else's running, is untouched.
    expect(moved.recommendedAtS).toBe(run.recommendedAtS);
    const others = (r: typeof base) => r.runs.filter((x) => x.driverId !== mine[0]);
    expect(others(changed)).toEqual(others(base));
  });

  it('ignores a call that comes after the car has already gone', () => {
    const base = session('late');
    const run = base.runs.find((r) => r.part === 0 && r.driverId === mine[0])!;
    const late = session('late', {
      commands: [{ atS: run.recommendedAtS + 60, part: 0, driverId: mine[0] }],
    });
    expect(late.runs.find((r) => r.part === 0 && r.driverId === mine[0])!.outAtS).toBe(run.outAtS);
  });

  it('leaves a manual car in the garage until the player says go — and without a time if never', () => {
    const silent = session('manual', { control: control('manual') });
    for (const driverId of mine) {
      const run = silent.runs.find((r) => r.part === 0 && r.driverId === driverId)!;
      expect(run.outAtS).toBeNull();
      expect(run.by).toBe('unanswered');
      expect(silent.laps.some((l) => l.driverId === driverId)).toBe(false);
      const car = silent.session.classification.find((c) => c.driverId === driverId)!;
      expect(car.status).toBe('dns');
      expect(car.bestLapS).toBeNull();
      // No time in Q1 is the back of the grid.
      expect(car.position).toBeGreaterThan(silent.session.classification.length - 6);
    }

    const answered = session('manual', {
      control: control('manual'),
      commands: mine.map((driverId) => ({ atS: 60, part: 0 as const, driverId })),
    });
    for (const driverId of mine) {
      expect(answered.runs.find((r) => r.part === 0 && r.driverId === driverId)!.outAtS).toBe(60);
      expect(answered.laps.some((l) => l.part === 0 && l.driverId === driverId)).toBe(true);
    }
  });
});
