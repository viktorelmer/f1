/**
 * The mock race for the race screen (plan rule 7). A run of the real simulation rather than
 * hand-written rows: 22 cars whose positions, gaps, tyres and events agree with each other are
 * easier to get from the engine than to type. The seed is the first of `mock-0`, `mock-1`, … whose
 * race has everything the screen has to show, so the mock keeps working when the pack or the race
 * model changes — the choice is still deterministic for a given pack and model.
 */
import { raceApi } from '@/app/worker/race-api';
import { loadActivePack } from '@/data/packs/active';
import { buildReplay, type Replay } from '@/sim/race/replay';
import type { RaceEventKind } from '@/sim/race/types';
import type { World } from '@/sim/types/world';
import { createWorld } from '@/sim/world/create-world';

export const MOCK_RACE = { careerSeed: 'mock-career', round: 1, teamId: 'kestrel' } as const;

/** What the mock race must contain: an event of each kind, two retirements, a plan revised twice. */
export const MOCK_RACE_NEEDS: readonly RaceEventKind[] = [
  'retirement',
  'safety-car',
  'vsc',
  'defence',
  'overtake',
  'pit',
  'strategy-call',
];
const MAX_TRIES = 1000;

let cached: { world: World; replay: Replay; seed: string } | undefined;

export function mockRace(): { world: World; replay: Replay; seed: string } {
  if (cached) return cached;
  const world = createWorld(MOCK_RACE.careerSeed, loadActivePack(), {
    mode: 'takeover',
    teamId: MOCK_RACE.teamId,
    principalName: 'Team Principal',
  });
  for (let i = 0; i < MAX_TRIES; i++) {
    const seed = `mock-${i}`;
    const { input, result } = raceApi.run(world, MOCK_RACE.round, seed);
    const kinds = new Set(result.events.map((e) => e.kind));
    const retired = result.classification.filter((c) => c.status === 'retired').length;
    const revised = Object.values(result.planHistory).some((h) => h.length > 2);
    if (MOCK_RACE_NEEDS.every((k) => kinds.has(k)) && retired >= 2 && revised) {
      cached = { world, replay: buildReplay(input, result), seed };
      return cached;
    }
  }
  throw new Error(`No mock race among ${MAX_TRIES} seeds has everything the race screen shows`);
}
