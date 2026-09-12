/**
 * Practice as something you sit through (docs/systems/weekend-play.md): an hour on a clock, runs
 * that come back one after another, estimates that narrow as they do, and a pit wall that can
 * change what is left of the queue while the session runs.
 */
import { describe, expect, it } from 'vitest';
import { balance } from '@/data/balance';
import { loadActivePack } from '@/data/packs/active';
import { openWeekend, runSession } from '../season/weekend';
import type { PracticeRun, World } from '../types/world';
import { createWorld } from '../world/create-world';
import type { PracticeResult } from './practice';
import { buildPracticeReplay, practiceFrameAt } from './practice-replay';

const pack = loadActivePack();
const TEAM = 'kestrel';
const world = createWorld('practice-play', pack, {
  mode: 'takeover',
  teamId: TEAM,
  principalName: 'Test',
});
const round = world.season.calendar.find((r) => r.format === 'standard')!.round;
const mine = world.teams[TEAM]!.drivers.race;
const HOUR = balance.weekend.session.practiceMinutes * 60;

/** FP1 of a normal weekend, with whatever the pit wall says during it. */
function fp1(seed: string, options: Parameters<typeof runSession>[2] = {}): PracticeResult {
  const open: World = openWeekend(world, pack, round, seed);
  const outcome = runSession(open, pack, options);
  if (outcome.detail.kind !== 'practice') throw new Error('fp1 ran as something else');
  return outcome.detail.practice;
}

describe('the session on a clock', () => {
  const result = fp1('clock');
  const replay = buildPracticeReplay(result);

  it('lays every run out inside the hour, in order, without overlapping itself', () => {
    expect(replay.durationS).toBeGreaterThanOrEqual(HOUR);
    for (const driverId of Object.keys(result.minutes)) {
      const runs = replay.runs.filter((r) => r.driverId === driverId);
      for (const [i, run] of runs.entries()) {
        expect(run.endS).toBeGreaterThan(run.outAtS);
        expect(run.outAtS).toBeLessThanOrEqual(HOUR);
        if (i > 0) expect(run.outAtS).toBeGreaterThanOrEqual(runs[i - 1]!.endS);
      }
      // Every lap belongs to a run, and happens while that run is out.
      for (const lap of result.laps.filter((l) => l.driverId === driverId)) {
        const run = runs.find((r) => lap.atS > r.outAtS && lap.atS <= r.endS + 1e-6);
        expect(run, `lap ${lap.lap} of ${driverId} at ${lap.atS}s`).toBeDefined();
      }
    }
  });

  it('starts empty and ends as the classification, to the lap', () => {
    const start = practiceFrameAt(replay, 0);
    expect(start.laps).toHaveLength(0);
    expect(start.cars.every((c) => c.lapsDone === 0 && c.bestLapS === null)).toBe(true);

    const flag = practiceFrameAt(replay, replay.durationS);
    expect(flag.finished).toBe(true);
    expect(flag.laps).toHaveLength(result.laps.length);
    for (const car of result.session.classification) {
      const frame = flag.cars.find((c) => c.driverId === car.driverId)!;
      expect(frame.lapsDone).toBe(car.laps);
      expect(frame.bestLapS === null ? null : Math.round(frame.bestLapS * 1000) / 1000).toBe(car.bestLapS);
      expect(frame.state).toBe('done');
    }
    // The board is the classification: best lap first.
    expect(flag.cars.map((c) => c.driverId)).toEqual(result.session.classification.map((c) => c.driverId));
  });

  it('has cars in the garage and cars on track while the hour runs', () => {
    const states = new Set<string>();
    for (let t = 0; t <= replay.durationS; t += 30) {
      const frame = practiceFrameAt(replay, t);
      for (const car of frame.cars) states.add(car.state);
      // Laps only ever accumulate.
      expect(frame.laps.length).toBeGreaterThanOrEqual(practiceFrameAt(replay, t - 30).laps.length);
    }
    expect(states).toContain('out');
    expect(states).toContain('garage');
  });

  it('narrows what a team believes as its runs come back', () => {
    const learning = result.knowledgeAt.filter((k) => k.teamId === TEAM);
    expect(learning.length).toBeGreaterThan(0);
    const first = practiceFrameAt(replay, 0).knowledge[TEAM]!;
    const last = practiceFrameAt(replay, replay.durationS).knowledge[TEAM]!;
    expect(first).toEqual(result.startedWith[TEAM]);
    expect(last).toEqual(result.learned[TEAM]);
    // Never wider than it was: a session cannot unlearn.
    let previous = first.fuelPerLapKg.basis.sd;
    for (const step of learning) {
      expect(step.knowledge.fuelPerLapKg.basis.sd).toBeLessThanOrEqual(previous + 1e-9);
      previous = step.knowledge.fuelPerLapKg.basis.sd;
    }
    expect(last.fuelPerLapKg.basis.sd).toBeLessThan(first.fuelPerLapKg.basis.sd);
  });
});

describe('changing the plan while the session runs', () => {
  const longRun: PracticeRun[] = [{ programme: 'long-run', compound: 'medium' }];
  const base = fp1('command');

  it('leaves everything before the call untouched and changes what comes after', () => {
    const driverId = mine[0];
    const first = base.runs.filter((r) => r.driverId === driverId)[0]!;
    // Said while the first run is out: it finishes, and the queue after it is ours.
    const atS = (first.outAtS + first.endS) / 2;
    const changed = fp1('command', { practiceCommands: [{ atS, driverId, runs: longRun }] });

    const before = (result: PracticeResult) =>
      result.laps.filter((l) => l.driverId === driverId && l.atS <= first.endS);
    expect(before(changed)).toEqual(before(base));
    const after = changed.runs.filter((r) => r.driverId === driverId && r.outAtS > first.endS);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((r) => r.programme === 'long-run')).toBe(true);
    // Nobody else heard it.
    const other = mine[1];
    expect(changed.laps.filter((l) => l.driverId === other)).toEqual(
      base.laps.filter((l) => l.driverId === other),
    );
  });

  it('does not interrupt the run a car is already on', () => {
    const driverId = mine[0];
    const first = base.runs.filter((r) => r.driverId === driverId)[0]!;
    const changed = fp1('command', {
      practiceCommands: [{ atS: first.outAtS + 1, driverId, runs: longRun }],
    });
    const kept = changed.runs.filter((r) => r.driverId === driverId)[0]!;
    expect(kept.programme).toBe(first.programme);
    expect(kept.endS).toBe(first.endS);
  });

  it('sends a parked car back out when its queue is already done', () => {
    const driverId = mine[0];
    const last = base.runs.filter((r) => r.driverId === driverId).at(-1)!;
    // The car is in the garage with the hour still running: the pit wall can still use the time.
    const atS = last.endS + 60;
    expect(atS).toBeLessThan(HOUR);
    const changed = fp1('command', { practiceCommands: [{ atS, driverId, runs: longRun }] });

    const before = (result: PracticeResult) =>
      result.laps.filter((l) => l.driverId === driverId && l.atS <= last.endS);
    expect(before(changed)).toEqual(before(base));
    const extra = changed.runs.filter((r) => r.driverId === driverId && r.outAtS >= atS);
    expect(extra.length).toBeGreaterThan(0);
    expect(extra.every((r) => r.programme === 'long-run')).toBe(true);
    // The car waited for the word: it did not go out before it was given.
    expect(extra[0]!.outAtS).toBeGreaterThanOrEqual(atS);
  });

  it('leaves every other car on its normal programme', () => {
    const driverId = mine[0];
    const changed = fp1('command', {
      plans: { [driverId]: [{ programme: 'long-run', compound: 'medium' }] },
    });
    // The pit wall spoke for one car; the other twenty ran the session they were going to run.
    const others = (result: PracticeResult) => result.laps.filter((l) => l.driverId !== driverId);
    expect(others(changed)).toEqual(others(base));
    expect(changed.runs.filter((r) => r.driverId === driverId)).toHaveLength(1);
  });

  it('is ignored when the hour is already gone', () => {
    const driverId = mine[0];
    const late = fp1('command', { practiceCommands: [{ atS: HOUR, driverId, runs: longRun }] });
    expect(late.laps.filter((l) => l.driverId === driverId)).toEqual(
      base.laps.filter((l) => l.driverId === driverId),
    );
  });
});
