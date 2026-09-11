/**
 * The practice part of a weekend, end to end (docs/systems/weekend.md): the sessions of the format,
 * each team's programmes, and what every team knows when they are over.
 *
 * Kept apart from the season loop (M5, task 4) so the batch runner and the tests can run a normal
 * Friday and Saturday without a calendar around them.
 */
import type { Pack } from '@/data/schema/pack';
import { buildRaceInput, type RaceControlInput } from '../race/build-input';
import type { RaceInput } from '../race/types';
import type { SessionKind, TeamId, World } from '../types/world';
import type { PracticePlan, PracticeResult } from './practice';
import { defaultPlan, runPractice } from './practice';

/** The practice sessions of each weekend format (plan 5.3). */
export const PRACTICE_SESSIONS: Record<'standard' | 'sprint', readonly SessionKind[]> = {
  standard: ['fp1', 'fp2', 'fp3'],
  sprint: ['fp1'],
};

export type PracticeWeekend = {
  sessions: PracticeResult[];
  /** What each team knows after practice — ready to go into `world.knowledge`. */
  knowledge: World['knowledge'];
};

/**
 * Runs the weekend's practice on an already-built race input. `plans` overrides what a car runs;
 * anyone missing runs the session's default programme.
 */
export function runPracticeSessions(
  world: World,
  race: RaceInput,
  plans: Partial<Record<SessionKind, PracticePlan>> = {},
): PracticeWeekend {
  const weekend = world.season.calendar.find((r) => r.round === race.round);
  const format = weekend?.format ?? 'standard';
  const dataAnalysis: Record<TeamId, number> = Object.fromEntries(
    Object.values(world.teams).map((t) => [t.id, t.departments.dataAnalysis.quality]),
  );
  const knowledge: World['knowledge'] = Object.fromEntries(
    Object.entries(world.knowledge).map(([id, k]) => [id, { ...k }]),
  );
  const sessions: PracticeResult[] = [];

  for (const session of PRACTICE_SESSIONS[format]) {
    const result = runPractice({
      race,
      session,
      at: weekend?.raceDate ?? world.date,
      plans: plans[session] ?? defaultPlan(race.entries, session),
      dataAnalysis,
      known: Object.fromEntries(Object.entries(knowledge).map(([id, k]) => [id, k.weekend])),
    });
    for (const [teamId, learned] of Object.entries(result.learned)) {
      const team = knowledge[teamId];
      if (team) knowledge[teamId] = { ...team, weekend: learned };
    }
    sessions.push(result);
  }
  return { sessions, knowledge };
}

/**
 * A race weekend up to the lights: practice is run, every team learns what it learns, and the race
 * input is rebuilt so each strategist plans on what its own team now believes.
 */
export function weekendRaceInput(
  world: World,
  pack: Pack,
  round: number,
  seed: string = world.seed,
  options: RaceControlInput & { plans?: Partial<Record<SessionKind, PracticePlan>> } = {},
): { input: RaceInput; practice: PracticeWeekend; world: World } {
  const { plans, ...control } = options;
  const practice = runPracticeSessions(world, buildRaceInput(world, pack, round, seed, control), plans);
  const after: World = { ...world, knowledge: practice.knowledge };
  return { input: buildRaceInput(after, pack, round, seed, control), practice, world: after };
}
