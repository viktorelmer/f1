/**
 * The race engine the store talks to. In the browser it is the simulation worker; in tests (jsdom
 * has no workers) the same API runs in-process. Both return the same data.
 */
import * as Comlink from 'comlink';
import type { World } from '@/sim/types/world';
import { type RaceApi, raceApi, type RaceRun } from './race-api';

export type RaceEngine = {
  run(world: World, round: number, seed: string): Promise<RaceRun>;
};

export function createWorkerEngine(): RaceEngine {
  const worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
  const remote = Comlink.wrap<RaceApi>(worker);
  return { run: (world, round, seed) => remote.run(world, round, seed) };
}

export function createInlineEngine(): RaceEngine {
  return { run: (world, round, seed) => Promise.resolve(raceApi.run(world, round, seed)) };
}
