/**
 * What the simulation worker offers the UI (docs/systems/race-screen.md). Kept as a plain module so
 * the same code runs inside the worker (via Comlink) and in tests, where jsdom has no workers.
 */
import { loadActivePack } from '@/data/packs/active';
import type { Pack } from '@/data/schema/pack';
import { buildRaceInput } from '@/sim/race/build-input';
import { simulateRace } from '@/sim/race/simulate';
import type { RaceInput, RaceResult } from '@/sim/race/types';
import type { World } from '@/sim/types/world';

let pack: Pack | undefined;

export type RaceRun = { input: RaceInput; result: RaceResult };

export const raceApi = {
  /** Builds the race of `round` from the world and simulates it to the flag. */
  run(world: World, round: number, seed: string): RaceRun {
    pack ??= loadActivePack();
    const input = buildRaceInput(world, pack, round, seed);
    return { input, result: simulateRace(input) };
  },
};

export type RaceApi = typeof raceApi;
