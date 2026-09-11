import { describe, expect, it } from 'vitest';
import { balance } from '@/data/balance';
import { isLocalPack, loadActivePack } from '@/data/packs/active';
import { buildRaceInput } from '../race/build-input';
import { createRng } from '../rng/rng';
import { fingerprint } from '../util/hash';
import { createWorld } from '../world/create-world';
import { decideRunTime, runQualifying } from './qualifying';
import { weekendRaceInput } from './run-practice';

const pack = loadActivePack();
const world = createWorld('quali-tests', pack, {
  mode: 'takeover',
  teamId: 'kestrel',
  principalName: 'Test',
});
const roundOf = (trackId: string) => world.season.calendar.find((r) => r.trackId === trackId)!.round;
const quali = (track: string, seed: string) =>
  runQualifying({
    race: buildRaceInput(world, pack, roundOf(track), seed),
    session: 'qualifying',
    setupLossS: {},
  });

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
    if (!isLocalPack) expect(fingerprint(result.session)).toBe('02c71dcff1dc7d');
  });
});
