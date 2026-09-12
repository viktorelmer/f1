import { describe, expect, it } from 'vitest';
import { balance } from '@/data/balance';
import { isLocalPack, loadActivePack } from '@/data/packs/active';
import { buildRaceInput } from '../race/build-input';
import type { RaceInput } from '../race/types';
import type { TyreAllocation } from '../types/world';
import { simulateRace } from '../race/simulate';
import { createRng } from '../rng/rng';
import { fingerprint } from '../util/hash';
import { createWorld } from '../world/create-world';
import { decideRunTime, runQualifying } from './qualifying';
import { weekendRaceInput } from '../season/weekend';

const pack = loadActivePack();
const world = createWorld('quali-tests', pack, {
  mode: 'takeover',
  teamId: 'kestrel',
  principalName: 'Test',
});
const roundOf = (trackId: string) => world.season.calendar.find((r) => r.trackId === trackId)!.round;
/** A rack nobody can run out of: these tests are about traffic and the clock, not about the entry. */
const plenty = (race: RaceInput): Record<string, TyreAllocation> =>
  Object.fromEntries(race.entries.map((e) => [e.driverId, { soft: 9, medium: 9, hard: 9 }]));
const quali = (track: string, seed: string) => {
  const race = buildRaceInput(world, pack, roundOf(track), seed);
  return runQualifying({ race, session: 'qualifying', setupLossS: {}, sets: plenty(race) });
};

describe('qualifying', () => {
  const result = quali('al-rimal', 'quali-1');
  const q = balance.weekend.qualifying;

  it('knocks five out of each of the first two parts and lines everyone up behind them', () => {
    const field = world.teams ? Object.values(world.teams).flatMap((t) => t.drivers.race).length : 0;
    expect(result.order).toHaveLength(field);
    expect(new Set(result.order).size).toBe(field);
    const ran = (part: 0 | 1 | 2) =>
      new Set(result.laps.filter((l) => l.part === part).map((l) => l.driverId));
    expect(ran(0).size).toBe(field);
    expect(ran(1).size).toBe(field - q.knockedOut);
    expect(ran(2).size).toBe(field - 2 * q.knockedOut);
    // Everyone who reached Q3 starts ahead of everyone who did not.
    const lastOfQ3 = Math.max(...[...ran(2)].map((id) => result.order.indexOf(id)));
    expect(lastOfQ3).toBe(ran(2).size - 1);
  });

  it('puts the cars in the order of their own best lap', () => {
    const best = new Map(result.session.classification.map((c) => [c.driverId, c.bestLapS!]));
    const q3 = result.order.slice(0, result.laps.filter((l) => l.part === 2).length);
    for (let i = 1; i < q3.length; i++)
      expect(best.get(q3[i]!)!).toBeGreaterThanOrEqual(best.get(q3[i - 1]!)!);
  });

  it('loses time to traffic, but never more than a driver would put up with', () => {
    let spoiled = 0;
    let clean = 0;
    for (let i = 0; i < 10; i++) {
      for (const lap of quali('al-rimal', `traffic-${i}`).laps) {
        if (lap.trafficS > 0) spoiled++;
        else clean++;
        expect(lap.trafficS).toBeLessThanOrEqual(
          pack.tracks.find((t) => t.id === 'al-rimal')!.baseLapTime * q.maxTrafficShare + 1e-9,
        );
      }
    }
    // Some laps are spoiled and most are not: a session where everyone is in the way is not a session.
    expect(spoiled).toBeGreaterThan(0);
    expect(clean).toBeGreaterThan(spoiled);
  });

  it('sends a car out later when the track is still coming to it, sooner when the time must be safe', () => {
    const ctx = { partS: 900, evolutionGainS: 0.8, lapS: 90 };
    const strong = { skill: 0.9, consistency: 0.9, rapport: 0.5 };
    const late = decideRunTime(
      ctx,
      strong,
      { goal: 'fastest', risk: 0.5, issuedBy: 'team-character' },
      createRng('q', 'a'),
    );
    const safe = decideRunTime(
      ctx,
      strong,
      { goal: 'safe', risk: 0.5, issuedBy: 'team-character' },
      createRng('q', 'a'),
    );
    expect(late.choice.outAtS).toBeGreaterThanOrEqual(safe.choice.outAtS);
    // A track that does not rubber in gives nobody a reason to hang about for it.
    const flat = decideRunTime(
      { ...ctx, evolutionGainS: 0 },
      strong,
      { goal: 'fastest', risk: 0.5, issuedBy: 'team-character' },
      createRng('q', 'a'),
    );
    expect(flat.choice.outAtS).toBeLessThanOrEqual(late.choice.outAtS);
  });

  it('puts the quickest package on pole more often than not', () => {
    // Marlowe is the pack's fastest car; over ten sessions it should take most of the poles.
    let poles = 0;
    for (let i = 0; i < 10; i++) {
      const pole = quali('al-rimal', `pole-${i}`).order[0]!;
      if (world.drivers[pole]!.contract?.teamId === 'marlowe') poles++;
    }
    expect(poles).toBeGreaterThanOrEqual(5);
  });

  it('is the grid the race starts from', () => {
    const { input, qualifying } = weekendRaceInput(world, pack, roundOf('al-rimal'), 'grid-1');
    expect(input.grid).toEqual(qualifying.order);
  });

  it('is deterministic, and pinned for the default pack', () => {
    expect(fingerprint(quali('al-rimal', 'quali-1').order)).toBe(fingerprint(result.order));
    if (!isLocalPack) expect(fingerprint(result.session)).toBe('03c8f75065e278');
  });
});

describe('a sprint weekend', () => {
  const sprintRound = world.season.calendar.find((r) => r.format === 'sprint')!.round;

  it('runs its own qualifying and a short race on sprint points', () => {
    const weekend = weekendRaceInput(world, pack, sprintRound, 'sprint-1');
    expect(weekend.sprint).not.toBeNull();
    const { qualifying: sq, input, result } = weekend.sprint!;
    expect(sq.session.session).toBe('sprint-qualifying');
    expect(input.format).toBe('sprint');
    expect(input.distanceLaps).toBeLessThan(input.track.laps);
    expect(input.distanceLaps).toBeGreaterThan(2);
    expect(input.grid).toEqual(sq.order);
    // Sprint points, and only where the sprint table pays.
    const paid = result.classification.filter((c) => c.points > 0);
    expect(paid.length).toBeLessThanOrEqual(input.regulation.points.sprint.length);
    expect(Math.max(...result.classification.map((c) => c.points))).toBe(input.regulation.points.sprint[0]);
  });

  it('needs no second compound: a sprint can be run on one set', () => {
    const { sprint } = weekendRaceInput(world, pack, sprintRound, 'sprint-2');
    const oneCompound = sprint!.result.classification.filter((c) => c.compounds.length === 1);
    expect(oneCompound.length).toBeGreaterThan(0);
  });

  it('leaves a normal weekend without a sprint', () => {
    const normal = world.season.calendar.find((r) => r.format === 'standard')!.round;
    expect(weekendRaceInput(world, pack, normal, 'sprint-3').sprint).toBeNull();
  });
});

describe('the stewards', () => {
  it('add seconds at the flag for causing a collision, and the classification stands on them', () => {
    let penalised = 0;
    for (let i = 0; i < 20; i++) {
      const { input } = weekendRaceInput(world, pack, roundOf('al-rimal'), `stewards-${i}`);
      const result = simulateRace(input);
      for (const car of result.classification) {
        if (car.penaltyS === 0) continue;
        penalised++;
        // The penalty is in the total time, and the event says so.
        const events = result.events.filter((e) => e.kind === 'penalty' && e.driverId === car.driverId);
        expect(events.length).toBeGreaterThan(0);
        expect(car.penaltyS).toBe(events.length * balance.race.stewards.penaltyS);
      }
      // Whoever is classified ahead is ahead on the time that counts.
      const finished = result.classification.filter((c) => c.status === 'finished' && c.lapsDown === 0);
      for (let k = 1; k < finished.length; k++)
        expect(finished[k]!.totalTimeS).toBeGreaterThanOrEqual(finished[k - 1]!.totalTimeS);
    }
    expect(penalised).toBeGreaterThan(0);
  }, 60_000);
});
