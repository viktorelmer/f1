/**
 * The weekend as state (docs/systems/weekend-play.md): opened, moved on one session at a time,
 * closed — and identical to the same weekend run in one call, because it is the same code path.
 */
import { describe, expect, it } from 'vitest';
import { loadActivePack } from '@/data/packs/active';
import { fingerprint } from '../util/hash';
import type { SessionKind, World } from '../types/world';
import { checkWorld } from '../world/check-world';
import { createWorld } from '../world/create-world';
import { closeWeekend, openWeekend, planPractice, runSession, runWeekend, WEEKEND_SESSIONS } from './weekend';

const pack = loadActivePack();
const TEAM = 'kestrel';
const world = createWorld('weekend-state', pack, {
  mode: 'takeover',
  teamId: TEAM,
  principalName: 'Test',
});
const standard = world.season.calendar.find((r) => r.format === 'standard')!.round;
const sprint = world.season.calendar.find((r) => r.format === 'sprint')!.round;

/** A weekend played session by session, saved and loaded between every one of them. */
function play(from: World, round: number, seed: string): { world: World; stages: SessionKind[] } {
  let open = openWeekend(from, pack, round, seed);
  const stages: SessionKind[] = [];
  while (open.weekend!.stage !== 'done') {
    const outcome = runSession(open, pack);
    stages.push(outcome.stage);
    // Through JSON and back: what a save does between two sessions (M12), and the weekend must not
    // notice. Everything a session needs is the world, the seed and the plans it carries.
    open = JSON.parse(JSON.stringify(outcome.world)) as World;
  }
  return { world: closeWeekend(open), stages };
}

describe('a weekend played one session at a time', () => {
  it('runs the sessions of its format, in order', () => {
    expect(play(world, standard, 'order').stages).toEqual(WEEKEND_SESSIONS.standard);
    expect(play(world, sprint, 'order').stages).toEqual(WEEKEND_SESSIONS.sprint);
  });

  it('leaves exactly the world the same weekend run whole leaves', () => {
    for (const round of [standard, sprint]) {
      const played = play(world, round, `same-${round}`);
      const simulated = runWeekend(world, pack, round, `same-${round}`);
      expect(fingerprint(played.world)).toBe(fingerprint(simulated.world));
    }
  });

  it('keeps the player’s programmes until their session is run', () => {
    const mine = world.teams[TEAM]!.drivers.race;
    const skipped = Object.fromEntries(mine.map((id) => [id, []]));
    let open = openWeekend(world, pack, standard, 'plans');
    for (const session of WEEKEND_SESSIONS.standard.filter((s) => s.startsWith('fp')))
      open = planPractice(open, session, skipped);
    const played = (() => {
      let w = open;
      while (w.weekend!.stage !== 'done') w = runSession(w, pack).world;
      return closeWeekend(w);
    })();
    const whole = runWeekend(world, pack, standard, 'plans', {
      plans: { fp1: skipped, fp2: skipped, fp3: skipped },
    }).world;
    expect(fingerprint(played)).toBe(fingerprint(whole));
    // A team that sat out every practice arrives at the race on the prior it came with.
    expect(played.knowledge[TEAM]!.weekend!.laps).toBe(0);
  });

  it('holds together at every stage, and the grid appears when it is earned', () => {
    let open = openWeekend(world, pack, sprint, 'invariants');
    const seen: (SessionKind | 'done')[] = [];
    while (open.weekend!.stage !== 'done') {
      const stage = open.weekend!.stage;
      seen.push(stage);
      expect(checkWorld(open, pack)).toEqual([]);
      expect(open.weekend!.grid === null).toBe(stage !== 'race');
      expect(open.weekend!.sprintGrid === null).toBe(stage === 'fp1' || stage === 'sprint-qualifying');
      open = runSession(open, pack).world;
    }
    expect(checkWorld(open, pack)).toEqual([]);
    expect(seen).toEqual(WEEKEND_SESSIONS.sprint);
    // The round is only completed when the weekend is closed, and the clock moves to race day.
    expect(open.season.calendar.find((r) => r.round === sprint)!.status).toBe('upcoming');
    const closed = closeWeekend(open);
    expect(closed.season.calendar.find((r) => r.round === sprint)!.status).toBe('completed');
    expect(closed.date).toBe(closed.season.calendar.find((r) => r.round === sprint)!.raceDate);
    expect(closed.weekend).toBeNull();
  });

  it('pays the sprint’s points on Saturday, before the race has been run', () => {
    let open = openWeekend(world, pack, sprint, 'points');
    while (open.weekend!.stage !== 'qualifying') open = runSession(open, pack).world;
    const sprintResult = open.season.calendar
      .find((r) => r.round === sprint)!
      .sessions.find((s) => s.session === 'sprint')!;
    const winner = sprintResult.classification[0]!;
    expect(winner.points).toBeGreaterThan(0);
    expect(open.season.standings.drivers[winner.driverId]).toBe(winner.points);
  });

  it('refuses what makes no sense: no weekend, another weekend, an early close', () => {
    expect(() => runSession(world, pack)).toThrow(/No weekend is open/);
    const open = openWeekend(world, pack, standard, 'guards');
    expect(openWeekend(open, pack, standard, 'guards')).toBe(open);
    expect(() => openWeekend(open, pack, sprint, 'guards')).toThrow(/still open/);
    expect(() => closeWeekend(open)).toThrow(/still has fp1/);
    expect(() => openWeekend(world, pack, 99, 'guards')).toThrow(/No round 99/);
  });
});

describe('what a weekend knows is its own', () => {
  it('starts each round from the prior, and does not build on another track’s notes', () => {
    let played: World = world;
    for (const round of [1, 2, 3]) {
      played = runWeekend(played, pack, round, `per-round-${round}`).world;
      const known = played.knowledge[TEAM]!.weekend!;
      // The same round run on its own, by a team that has never raced: practice must teach the
      // same amount. Anything else means last round's laps are still being counted.
      const alone = runWeekend(world, pack, round, `per-round-${round}`).world.knowledge[TEAM]!.weekend!;
      expect(known.round).toBe(round);
      expect(known.laps).toBe(alone.laps);
      for (const driverId of world.teams[TEAM]!.drivers.race) {
        expect(known.setup[driverId]!.laps).toBe(alone.setup[driverId]!.laps);
        expect(known.setup[driverId]!.reading.frontWing.basis.sd).toBeCloseTo(
          alone.setup[driverId]!.reading.frontWing.basis.sd,
          9,
        );
      }
    }
  });

  it('qualifies twice on a sprint weekend, and not the same way twice', () => {
    const { sprint: saturday, qualifying } = (() => {
      const outcome = runWeekend(world, pack, sprint, 'two-qualis');
      const weekend = outcome.world.season.calendar.find((r) => r.round === sprint)!;
      return {
        sprint: weekend.sessions.find((s) => s.session === 'sprint-qualifying')!,
        qualifying: weekend.sessions.find((s) => s.session === 'qualifying')!,
      };
    })();
    expect(fingerprint(saturday.classification)).not.toBe(fingerprint(qualifying.classification));
  });
});
