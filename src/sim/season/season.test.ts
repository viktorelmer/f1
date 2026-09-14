import { describe, expect, it } from 'vitest';
import { isLocalPack, loadActivePack } from '@/data/packs/active';
import { fingerprint } from '../util/hash';
import { createWorld } from '../world/create-world';
import type { World } from '../types/world';
import { advanceToNextEvent, nextEvent, upcoming } from './events';
import { constructorTable, driverTable, playedSessions, standings } from './standings';
import { runWeekend } from './weekend';

const pack = loadActivePack();
const TEAM = 'kestrel';
const start = createWorld('season-tests', pack, {
  mode: 'takeover',
  teamId: TEAM,
  principalName: 'Test',
});

/** A whole season, run once and shared by the tests below: 22 rounds is a couple of seconds. */
const season = (() => {
  let world: World = start;
  for (const round of start.season.calendar.map((r) => r.round)) {
    world = advanceToNextEvent(world);
    world = runWeekend(world, pack, round, `M5-season-${round}`).world;
  }
  return world;
})();

describe('the clock between races', () => {
  it('lines up the preseason test and every round, soonest first', () => {
    const events = upcoming(start);
    expect(events[0]!.kind).toBe('preseason-test');
    expect(events.filter((e) => e.kind === 'weekend')).toHaveLength(start.season.calendar.length);
    for (let i = 1; i < events.length; i++)
      expect(events[i]!.date).toBeGreaterThanOrEqual(events[i - 1]!.date);
  });

  it('moves to the day of the next event and never backwards', () => {
    const moved = advanceToNextEvent(start);
    expect(moved.date).toBe(nextEvent(start)!.date);
    expect(advanceToNextEvent(moved).date).toBe(moved.date);
  });

  it('has nothing left but the end of the season once every round is run', () => {
    const left = upcoming(season);
    expect(left).toHaveLength(1);
    expect(left[0]!.kind).toBe('season-end');
  });
});

describe('M5 DoD: a season of 22 rounds', () => {
  it('runs to the last race with every session filed', () => {
    expect(season.season.calendar).toHaveLength(22);
    for (const weekend of season.season.calendar) {
      expect(weekend.status).toBe('completed');
      const kinds = weekend.sessions.map((s) => s.session);
      expect(kinds).toContain('race');
      expect(kinds).toContain('qualifying');
      expect(kinds.filter((k) => k === 'sprint')).toHaveLength(weekend.format === 'sprint' ? 1 : 0);
      for (const session of weekend.sessions) expect(session.classification).toHaveLength(22);
    }
    // The twenty-second race is a race like any other: everyone is classified and someone wins.
    const last = season.season.calendar[21]!.sessions.find((s) => s.session === 'race')!;
    expect(last.classification[0]!.points).toBeGreaterThan(0);
    expect(new Set(last.classification.map((c) => c.position)).size).toBe(22);
  });

  it('adds up: the tables are the sum of the sessions, and the cache matches', () => {
    const fromSessions = {
      drivers: {} as Record<string, number>,
      constructors: {} as Record<string, number>,
    };
    for (const session of playedSessions(season.season))
      for (const car of session.classification) {
        if (car.points === 0) continue;
        fromSessions.drivers[car.driverId] = (fromSessions.drivers[car.driverId] ?? 0) + car.points;
        fromSessions.constructors[car.teamId] = (fromSessions.constructors[car.teamId] ?? 0) + car.points;
      }
    expect(standings(season.season)).toEqual(fromSessions);
    // What the world carries is only a cache of the same sum.
    expect(season.season.standings).toEqual(standings(season.season));

    // A constructor has exactly what its two drivers scored.
    const drivers = Object.values(season.drivers);
    for (const [teamId, points] of Object.entries(season.season.standings.constructors)) {
      const mine = drivers.filter((d) => d.contract?.teamId === teamId);
      const sum = mine.reduce((total, d) => total + (season.season.standings.drivers[d.id] ?? 0), 0);
      expect(points).toBe(sum);
    }
  });

  it('pays points only where the table pays, and only to the classified', () => {
    const regulation = pack.regulations.find((r) => r.season === season.season.year)!;
    for (const weekend of season.season.calendar) {
      for (const session of weekend.sessions) {
        const table = session.session === 'race' ? regulation.points.race : regulation.points.sprint;
        const paid = session.classification.filter((c) => c.points > 0);
        if (session.session !== 'race' && session.session !== 'sprint') {
          expect(paid).toHaveLength(0);
          continue;
        }
        expect(paid.length).toBeLessThanOrEqual(table.length);
        for (const car of paid) expect(car.points).toBe(table[car.position - 1]);
      }
    }
  });

  it('orders the tables by points, then by the better set of finishes', () => {
    const ids = Object.keys(season.drivers);
    const table = driverTable(season.season, ids);
    expect(table).toHaveLength(ids.length);
    for (let i = 1; i < table.length; i++) expect(table[i]!.points).toBeLessThanOrEqual(table[i - 1]!.points);
    expect(table[0]!.points).toBeGreaterThan(0);

    const teams = Object.keys(season.teams);
    const constructors = constructorTable(season.season, teams, (id) => season.teams[id]!.drivers.race);
    for (let i = 1; i < constructors.length; i++)
      expect(constructors[i]!.points).toBeLessThanOrEqual(constructors[i - 1]!.points);
    expect(constructors[0]!.points).toBe(Math.max(...Object.values(season.season.standings.constructors)));
  });

  it('ends on the last race day, with the world still sound', () => {
    expect(season.date).toBe(season.season.calendar[21]!.raceDate);
    expect(season.season.year).toBe(start.season.year);
    expect(Object.keys(season.drivers)).toHaveLength(Object.keys(start.drivers).length);
  });

  it.skipIf(isLocalPack)('is deterministic: the same seed gives the same championship', () => {
    expect(fingerprint(season.season.standings)).toBe('02926a438cfa87');
  });
});
