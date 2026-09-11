import { beforeEach, describe, expect, it } from 'vitest';
import { fingerprint } from '@/sim/util/hash';
import { raceApi } from '../worker/race-api';
import { createInlineEngine } from '../worker/engine';
import { useCareer } from './career';
import { setRaceEngine, useRace } from './race';

setRaceEngine(createInlineEngine());

beforeEach(() => {
  useCareer.getState().startDemoCareer('store-tests');
  useRace.setState({
    phase: 'setup',
    replay: null,
    timeS: 0,
    speed: 1,
    paused: false,
    round: 1,
    seed: 'store-race',
  });
});

describe('career store', () => {
  it('opens a demo career at Kestrel, the same for the same seed', () => {
    const a = useCareer.getState().world;
    useCareer.getState().startDemoCareer('store-tests');
    expect(useCareer.getState().world.career.playerTeamId).toBe('kestrel');
    expect(fingerprint(useCareer.getState().world)).toBe(fingerprint(a));
  });
});

describe('race store', () => {
  it('runs the race through the engine and holds it as a replay', async () => {
    await useRace.getState().start();
    const { phase, replay } = useRace.getState();
    expect(phase).toBe('ready');
    expect(replay!.result.classification).toHaveLength(22);
    // The engine runs the same deterministic simulation the worker would.
    const direct = raceApi.run({
      world: useCareer.getState().world,
      round: 1,
      seed: 'store-race',
      control: useRace.getState().startControl,
      commands: [],
    });
    expect(fingerprint(replay!.result)).toBe(fingerprint(direct.result));
  });

  it('plays back at the chosen speed, pauses, and stops at the flag', async () => {
    await useRace.getState().start();
    const race = useRace.getState;
    race().tick(1000);
    expect(race().timeS).toBeCloseTo(1, 10);
    race().setSpeed(15);
    race().tick(1000);
    expect(race().timeS).toBeCloseTo(16, 10);
    race().togglePause();
    race().tick(5000);
    expect(race().timeS).toBeCloseTo(16, 10);
    race().togglePause();
    race().seek(1e9);
    expect(race().timeS).toBe(race().replay!.durationS);
    race().tick(1000);
    expect(race().timeS).toBe(race().replay!.durationS);
    race().restart();
    expect(race().timeS).toBe(0);
  });

  it('re-runs the race on a command: the same up to its moment, different after it', async () => {
    await useRace.getState().start();
    const race = useRace.getState;
    const before = race().replay!.result;
    const driverId = useCareer.getState().world.teams.kestrel!.drivers.race[0];
    race().seek(1200);
    await race().command({ kind: 'radio', driverId, radio: { pace: 'push', aggression: 'aggressive' } });
    expect(race().commands).toEqual([
      { timeS: 1200, kind: 'radio', driverId, radio: { pace: 'push', aggression: 'aggressive' } },
    ]);
    const after = race().replay!.result;
    expect(race().timeS).toBe(1200);
    const upTo = (r: typeof before) => r.events.filter((e) => e.timeS < 1200);
    expect(upTo(after)).toEqual(upTo(before));
    expect(after.laps[driverId]).not.toEqual(before.laps[driverId]);
  });

  it('drops a picked plan when the race changes', async () => {
    const race = useRace.getState;
    await race().setStrategy({ mode: 'manual', risk: 0.5, goal: 'fastest' });
    await race().loadPlans();
    race().choosePlan(race().plans!.options[0]!.plan);
    expect(Object.keys(race().control.plans)).toHaveLength(2);
    race().setRound(2);
    expect(race().control.plans).toEqual({});
    expect(race().plans).toBeNull();
  });

  it('reports an engine failure instead of hanging', async () => {
    setRaceEngine({
      run: () => Promise.reject(new Error('worker crashed')),
      plans: () => Promise.resolve(null),
    });
    await useRace.getState().start();
    expect(useRace.getState()).toMatchObject({ phase: 'error', error: 'worker crashed' });
    setRaceEngine(createInlineEngine());
  });
});
