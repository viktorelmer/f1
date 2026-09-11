/**
 * The championship tables (docs/systems/season.md). Both are a **derived** value: they are summed
 * from every session of the calendar, never accumulated as the season goes. A table that is computed
 * from the results cannot drift away from them, and `world.season.standings` is only a cache of this
 * — a test compares the two.
 *
 * Ties go to whoever has the better set of finishes: more wins, then more seconds, and so on.
 */
import type { DriverId, Season, SessionResult, TeamId } from '../types/world';

export type Standings = {
  drivers: Record<DriverId, number>;
  constructors: Record<TeamId, number>;
};

/** Every session of the calendar that has been run. */
export function playedSessions(season: Season): SessionResult[] {
  return season.calendar.flatMap((weekend) => weekend.sessions);
}

export function standings(season: Season): Standings {
  const drivers: Record<DriverId, number> = {};
  const constructors: Record<TeamId, number> = {};
  for (const session of playedSessions(season)) {
    for (const car of session.classification) {
      if (car.points === 0) continue;
      drivers[car.driverId] = (drivers[car.driverId] ?? 0) + car.points;
      constructors[car.teamId] = (constructors[car.teamId] ?? 0) + car.points;
    }
  }
  return { drivers, constructors };
}

/** How many times a driver finished in each place, for the tie-break. */
function finishCounts(season: Season, driverId: DriverId): number[] {
  const counts: number[] = [];
  for (const session of playedSessions(season)) {
    // Only the sessions that pay: practice and qualifying decide nothing in the championship.
    if (!session.classification.some((c) => c.points > 0)) continue;
    const car = session.classification.find((c) => c.driverId === driverId);
    if (!car || car.status !== 'finished') continue;
    counts[car.position - 1] = (counts[car.position - 1] ?? 0) + 1;
  }
  return counts;
}

/** Compares two lists of finishes the way a championship does: more wins first, then more seconds. */
function betterFinishes(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (b[i] ?? 0) - (a[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export type StandingsRow<Id extends string = string> = { id: Id; points: number; position: number };

/** The drivers' table in order, ties broken by the better set of finishes. */
export function driverTable(season: Season, ids: readonly DriverId[]): StandingsRow<DriverId>[] {
  const points = standings(season).drivers;
  const counts = new Map(ids.map((id) => [id, finishCounts(season, id)]));
  return [...ids]
    .sort(
      (a, b) =>
        (points[b] ?? 0) - (points[a] ?? 0) ||
        betterFinishes(counts.get(a)!, counts.get(b)!) ||
        (a < b ? -1 : 1),
    )
    .map((id, i) => ({ id, points: points[id] ?? 0, position: i + 1 }));
}

/** The constructors' table in order; a tie goes to the team whose best car finished higher. */
export function constructorTable(
  season: Season,
  teams: readonly TeamId[],
  driversOf: (teamId: TeamId) => readonly DriverId[],
): StandingsRow<TeamId>[] {
  const points = standings(season).constructors;
  const counts = new Map(
    teams.map((id) => {
      const total: number[] = [];
      for (const driverId of driversOf(id))
        for (const [place, n] of finishCounts(season, driverId).entries())
          total[place] = (total[place] ?? 0) + n;
      return [id, total];
    }),
  );
  return [...teams]
    .sort(
      (a, b) =>
        (points[b] ?? 0) - (points[a] ?? 0) ||
        betterFinishes(counts.get(a)!, counts.get(b)!) ||
        (a < b ? -1 : 1),
    )
    .map((id, i) => ({ id, points: points[id] ?? 0, position: i + 1 }));
}
