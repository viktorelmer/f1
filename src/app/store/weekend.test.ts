import { beforeEach, describe, expect, it } from 'vitest';
import { fingerprint } from '@/sim/util/hash';
import type { PracticeLap } from '@/sim/weekend/practice';
import type { PracticeReplay } from '@/sim/weekend/practice-replay';
import type { QualifyingReplay } from '@/sim/weekend/qualifying-replay';
import { createInlineEngine } from '../worker/engine';
import { raceApi } from '../worker/race-api';
import { useCareer } from './career';
import { unwatchedControl } from './control';
import { setRaceEngine, useRace } from './race';
import { pendingStage, setWeekendEngine, useWeekend } from './weekend';

setWeekendEngine(createInlineEngine());
setRaceEngine(createInlineEngine());

const world = () => useCareer.getState().world;
const weekend = () => useWeekend.getState();

/** The practice on screen right now, or a failure saying what is there instead. */
function practice(): PracticeReplay {
  const play = useWeekend.getState().play;
  if (play?.kind !== 'practice') throw new Error(`the session on screen is ${play?.kind ?? 'none'}`);
  return play.replay;
}

const practiceLaps = (): readonly PracticeLap[] => practice().laps;

/** The player's first car — the one the pit wall talks to in these tests. */
const myDriver = () => world().teams[world().career.playerTeamId]?.drivers.race[0] ?? '';

function qualifying(): QualifyingReplay {
  const play = useWeekend.getState().play;
  if (play?.kind !== 'qualifying') throw new Error(`the session on screen is ${play?.kind ?? 'none'}`);
  return play.replay;
}

/** Walks the weekend on until the session named is the one waiting. */
async function until(stage: string) {
  while (pendingStage(world()) !== null && world().weekend!.stage !== stage)
    await weekend().simulateSession();
}

beforeEach(async () => {
  useCareer.getState().startDemoCareer('weekend-store');
  useWeekend.getState().leave();
  useWeekend.setState({ speed: 1, busy: false, error: null });
  await weekend().open();
});

describe('weekend store', () => {
  it('opens the round the season is waiting on and stops at its first session', () => {
    expect(world().weekend?.round).toBe(1);
    expect(pendingStage(world())).toBe('fp1');
    // The entry is declared before anything runs: a full set of tyres for every car.
    expect(Object.keys(world().weekend!.tyres)).toHaveLength(22);
  });

  it('plays a practice session on its clock and files it at the flag', async () => {
    await weekend().enter();
    const { phase, play, committed } = weekend();
    expect(phase).toBe('ready');
    expect(play?.kind).toBe('practice');
    expect(committed).toBe(false);
    // Nothing is in the world until the session is over.
    expect(world().season.calendar[0]!.sessions).toHaveLength(0);

    weekend().tick(1000);
    expect(weekend().timeS).toBeCloseTo(1, 10);
    weekend().skipToEnd();

    expect(weekend().committed).toBe(true);
    expect(pendingStage(world())).toBe('fp2');
    const fp1 = world().season.calendar[0]!.sessions.find((s) => s.session === 'fp1');
    expect(fp1?.classification).toHaveLength(22);
  });

  it('takes a new queue mid-session: the laps before it stand, the runs after it change', async () => {
    await weekend().enter();
    const before = practiceLaps();
    const driverId = myDriver();
    const atS = 20 * 60;

    weekend().seek(atS);
    await weekend().setRuns(driverId, [{ programme: 'long-run', compound: 'hard' }]);

    const after = practiceLaps();
    const upTo = (laps: readonly PracticeLap[]) => laps.filter((l) => l.atS <= atS);
    expect(fingerprint(upTo(after))).toBe(fingerprint(upTo(before)));
    const mine = (laps: readonly PracticeLap[]) => laps.filter((l) => l.driverId === driverId && l.atS > atS);
    expect(fingerprint(mine(after))).not.toBe(fingerprint(mine(before)));
    // The clock did not move while the session was re-run.
    expect(weekend().timeS).toBeCloseTo(atS, 10);
  });

  it('plays qualifying, sends a car out on the word, and leaves the grid in the world', async () => {
    await until('qualifying');
    await weekend().enter();
    expect(weekend().play?.kind).toBe('qualifying');
    const driverId = myDriver();
    weekend().seek(60);
    await weekend().sendOut(driverId);
    expect(weekend().qualifyingCommands).toEqual([{ atS: 60, part: 0, driverId }]);
    const run = qualifying().result.runs.find((r) => r.part === 0 && r.driverId === driverId)!;
    expect(run.by).toBe('player');
    expect(run.outAtS).toBe(60);

    weekend().skipToEnd();

    const grid = world().weekend!.grid;
    expect(grid).toHaveLength(22);
    const quali = world().season.calendar[0]!.sessions.find((s) => s.session === 'qualifying');
    expect(quali!.classification.map((c) => c.driverId).slice(0, 3)).toEqual(grid!.slice(0, 3));
  });

  it('drives the weekend race from the grid qualifying set and files it at the flag', async () => {
    await until('race');
    const grid = world().weekend!.grid!;
    await useRace.getState().startWeekend();
    const race = useRace.getState();
    expect(race.phase).toBe('ready');
    expect(race.mode).toBe('weekend');
    expect(race.replay!.input.entries.map((e) => e.driverId)).toHaveLength(22);
    // The race starts where qualifying left it.
    expect(race.replay!.input.grid).toEqual(grid);
    expect(world().season.calendar[0]!.status).toBe('upcoming');

    race.seek(race.replay!.durationS - 1);
    race.tick(2000);
    expect(useRace.getState().committed).toBe(true);
    // The race was the last session: the weekend is closed, the round completed, points counted.
    expect(world().weekend).toBeNull();
    expect(world().season.calendar[0]!.status).toBe('completed');
    const winner = race.replay!.result.classification[0]!;
    expect(world().season.standings.drivers[winner.driverId]).toBe(winner.points);
  });

  it('hands a session nobody watches to the team: every car sets a time', async () => {
    // The career starts with strategy manual: on screen the cars wait for the word.
    expect(world().career.delegation['race-strategy']).toBe('manual');
    await until('qualifying');
    await weekend().simulateSession();

    const quali = world().season.calendar[0]!.sessions.find((s) => s.session === 'qualifying')!;
    expect(quali.classification.every((c) => c.bestLapS !== null)).toBe(true);
  });

  it('leaves the same world as running the weekend in one call', async () => {
    const start = world();
    while (pendingStage(world()) !== null) await weekend().simulateSession();
    const played = world();

    // The same weekend with nobody watching: one code path, so it cannot drift (ADR 007, п. 2).
    const whole = raceApi.weekend({
      world: start,
      round: 1,
      seed: `${start.seed}:r1`,
      // The same hands on the wheel: nobody watched either run.
      control: unwatchedControl(),
    });
    expect(fingerprint(played)).toBe(fingerprint(whole.world));
  });
});
