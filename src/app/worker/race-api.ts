/**
 * What the simulation worker offers the UI (docs/systems/race-screen.md, race-control.md). Kept as
 * a plain module so the same code runs inside the worker (via Comlink) and in tests, where jsdom
 * has no workers.
 */
import { loadActivePack } from '@/data/packs/active';
import type { Pack } from '@/data/schema/pack';
import { buildRaceInput } from '@/sim/race/build-input';
import { raceStrategy, simulateRace } from '@/sim/race/simulate';
import type { PlanOption } from '@/sim/race/strategy';
import type { RaceCommand, RaceControl, RaceInput, RaceResult } from '@/sim/race/types';
import { runWeekend, type WeekendOutcome } from '@/sim/season/weekend';
import type { SessionKind, World } from '@/sim/types/world';
import type { PracticePlan } from '@/sim/weekend/practice';

let pack: Pack | undefined;

/** A race to run: the world, which round, the seed, and the player's side of it. */
export type RaceRequest = {
  world: World;
  round: number;
  seed: string;
  control: RaceControl | null;
  commands: readonly RaceCommand[];
};

export type RaceRun = { input: RaceInput; result: RaceResult };

/** The strategist's pre-race options for the player's team, and which one he would take. */
export type PlanChoice = { options: PlanOption[]; recommended: number };

const inputFor = (r: RaceRequest) => {
  pack ??= loadActivePack();
  return buildRaceInput(r.world, pack, r.round, r.seed, { control: r.control, commands: r.commands });
};

/** A whole weekend to run: practice, qualifying, the sprint if there is one, and the race. */
export type WeekendRequest = {
  world: World;
  round: number;
  seed: string;
  plans?: Partial<Record<SessionKind, PracticePlan>>;
};

export const raceApi = {
  /** Runs the weekend of `round` and gives back the world it leaves behind (docs/systems/season.md). */
  weekend(request: WeekendRequest): WeekendOutcome {
    pack ??= loadActivePack();
    return runWeekend(request.world, pack, request.round, request.seed, { plans: request.plans });
  },
  /** Builds the race of `round` from the world and simulates it to the flag. */
  run(request: RaceRequest): RaceRun {
    const input = inputFor(request);
    return { input, result: simulateRace(input) };
  },
  /** The plan options for the player's team before the start — the same the race will weigh. */
  plans(request: RaceRequest): PlanChoice | null {
    if (!request.control) return null;
    const { options, decision } = raceStrategy(inputFor(request), request.control.teamId);
    return { options, recommended: options.indexOf(decision.choice) };
  },
};

export type RaceApi = typeof raceApi;
