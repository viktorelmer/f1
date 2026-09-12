/**
 * The race engine the store talks to. In the browser it is the simulation worker; in tests (jsdom
 * has no workers) the same API runs in-process. Both return the same data.
 */
import * as Comlink from 'comlink';
import type { WeekendOutcome } from '@/sim/season/weekend';
import {
  type PlanChoice,
  type RaceApi,
  raceApi,
  type RaceRequest,
  type RaceRun,
  type WeekendRequest,
} from './race-api';

export type RaceEngine = {
  run(request: RaceRequest): Promise<RaceRun>;
  plans(request: RaceRequest): Promise<PlanChoice | null>;
  weekend(request: WeekendRequest): Promise<WeekendOutcome>;
};

export function createWorkerEngine(): RaceEngine {
  const worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
  const remote = Comlink.wrap<RaceApi>(worker);
  return {
    run: (request) => remote.run(request),
    plans: (request) => remote.plans(request),
    weekend: (request) => remote.weekend(request),
  };
}

export function createInlineEngine(): RaceEngine {
  return {
    run: (request) => Promise.resolve(raceApi.run(request)),
    plans: (request) => Promise.resolve(raceApi.plans(request)),
    weekend: (request) => Promise.resolve(raceApi.weekend(request)),
  };
}
