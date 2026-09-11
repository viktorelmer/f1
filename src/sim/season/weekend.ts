/**
 * A race weekend, run whole (docs/systems/season.md): practice, qualifying, the sprint if the format
 * has one, and the race. Every session's result goes into the calendar, the points are added up from
 * it, and the world comes back with the date moved on.
 *
 * Pure, like everything in `sim`: the same world, round and seed give the same weekend.
 */
import type { Pack } from '@/data/schema/pack';
import { simulateRace } from '../race/simulate';
import type { RaceInput, RaceResult } from '../race/types';
import type { SessionResult, World } from '../types/world';
import type { PracticePlan } from '../weekend/practice';
import { weekendRaceInput } from '../weekend/run-practice';
import { standings } from './standings';
import type { SessionKind } from '../types/world';

export type WeekendOutcome = {
  /** The world after the weekend: results filed, standings updated, the date moved to race day. */
  world: World;
  sessions: SessionResult[];
  /** The race itself, for the screen and for anyone who wants the detail. */
  input: RaceInput;
  result: RaceResult;
  sprint: { input: RaceInput; result: RaceResult } | null;
};

export type WeekendOptions = {
  plans?: Partial<Record<SessionKind, PracticePlan>>;
};

export function runWeekend(
  world: World,
  pack: Pack,
  round: number,
  seed: string = world.seed,
  options: WeekendOptions = {},
): WeekendOutcome {
  const weekend = world.season.calendar.find((r) => r.round === round);
  if (!weekend) throw new RangeError(`No round ${round} in the ${world.season.year} calendar`);

  const run = weekendRaceInput(world, pack, round, seed, options);
  const result = simulateRace(run.input);

  const sessions: SessionResult[] = [
    ...run.practice.sessions.map((s) => s.session),
    ...(run.sprint ? [run.sprint.qualifying.session] : []),
    ...(run.sprint
      ? [{ session: 'sprint' as const, classification: run.sprint.result.classification.map(toEntry) }]
      : []),
    run.qualifying.session,
    { session: 'race', classification: result.classification.map(toEntry) },
  ];

  const calendar = world.season.calendar.map((r) =>
    r.round === round ? { ...r, status: 'completed' as const, sessions } : r,
  );
  const season = { ...world.season, calendar };
  const after: World = {
    ...run.world,
    date: weekend.raceDate,
    season: { ...season, standings: standings(season) },
  };
  return {
    world: after,
    sessions,
    input: run.input,
    result,
    sprint: run.sprint ? { input: run.sprint.input, result: run.sprint.result } : null,
  };
}

/** A race classification as the season records it: places, laps, points, nothing about the race. */
function toEntry(car: RaceResult['classification'][number]): SessionResult['classification'][number] {
  return {
    driverId: car.driverId,
    teamId: car.teamId,
    position: car.position,
    laps: car.laps,
    bestLapS: car.bestLapS,
    status: car.status === 'finished' ? 'finished' : 'dnf',
    points: car.points,
  };
}
