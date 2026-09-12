/**
 * The race engine the store talks to. In the browser it is the simulation worker; in tests (jsdom
 * has no workers) the same API runs in-process. Both return the same data.
 */
import * as Comlink from 'comlink';
import type { SessionOutcome, WeekendOutcome } from '@/sim/season/weekend';
import type { World } from '@/sim/types/world';
import {
  type PlanChoice,
  type RaceApi,
  raceApi,
  type RaceRequest,
  type RaceRun,
  type SessionRequest,
  type WeekendRequest,
} from './race-api';

export type OpenRequest = { world: World; round: number; seed: string };

export type RaceEngine = {
  run(request: RaceRequest): Promise<RaceRun>;
  plans(request: RaceRequest): Promise<PlanChoice | null>;
  weekend(request: WeekendRequest): Promise<WeekendOutcome>;
  /** The weekend as state: opened, then moved on one session at a time (weekend-play.md). */
  open(request: OpenRequest): Promise<World>;
  session(request: SessionRequest): Promise<SessionOutcome>;
  sessionPlans(request: SessionRequest): Promise<PlanChoice | null>;
};

export function createWorkerEngine(): RaceEngine {
  const worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
  const remote = Comlink.wrap<RaceApi>(worker);
  return {
    run: (request) => remote.run(request),
    plans: (request) => remote.plans(request),
    weekend: (request) => remote.weekend(request),
    open: (request) => remote.open(request),
    session: (request) => remote.session(request),
    sessionPlans: (request) => remote.sessionPlans(request),
  };
}

export function createInlineEngine(): RaceEngine {
  return {
    run: (request) => Promise.resolve(raceApi.run(request)),
    plans: (request) => Promise.resolve(raceApi.plans(request)),
    weekend: (request) => Promise.resolve(raceApi.weekend(request)),
    open: (request) => Promise.resolve(raceApi.open(request)),
    session: (request) => Promise.resolve(raceApi.session(request)),
    sessionPlans: (request) => Promise.resolve(raceApi.sessionPlans(request)),
  };
}
