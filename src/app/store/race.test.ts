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
    const direct = raceApi.run(useCareer.getState().world, 1, 'store-race');
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

  it('reports an engine failure instead of hanging', async () => {
    setRaceEngine({ run: () => Promise.reject(new Error('worker crashed')) });
    await useRace.getState().start();
    expect(useRace.getState()).toMatchObject({ phase: 'error', error: 'worker crashed' });
    setRaceEngine(createInlineEngine());
  });
});
