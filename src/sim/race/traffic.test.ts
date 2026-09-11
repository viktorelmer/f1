import { describe, expect, it } from 'vitest';
import { balance } from '@/data/balance';
import { loadActivePack } from '@/data/packs/active';
import { prepareTrack } from './track';
import {
  dirtyAirLossS,
  drsGainS,
  type OvertakeFactors,
  overtakeProbability,
  slipstreamGainS,
} from './traffic';

const pack = loadActivePack();
const model = prepareTrack(
  pack.tracks.find((t) => t.id === 'al-rimal')!,
  pack.geometry.find((g) => g.trackId === 'al-rimal')!,
);

const factors = (over: Partial<OvertakeFactors> = {}): OvertakeFactors => ({
  paceAdvantageS: 0.2,
  drsOpen: true,
  drsZone: true,
  attackerRacecraft: 85,
  defenderRacecraft: 85,
  wearAdvantage: 0,
  overtakingDifficulty: 0.4,
  lap1: false,
  attackerPushes: false,
  defenderPushes: false,
  aggression: 0,
  ...over,
});

describe('dirty air and the tow', () => {
  it('costs more the closer the car behind, and nothing outside the window', () => {
    expect(dirtyAirLossS(0.3, 80, 0.6)).toBeGreaterThan(dirtyAirLossS(1.0, 80, 0.6));
    expect(dirtyAirLossS(balance.race.traffic.dirtyAirWindowS, 80, 0.6)).toBe(0);
  });

  it('hurts an aero-sensitive car on an aero track more', () => {
    expect(dirtyAirLossS(0.5, 70, 0.6)).toBeGreaterThan(dirtyAirLossS(0.5, 90, 0.6));
    expect(dirtyAirLossS(0.5, 80, 0.9)).toBeGreaterThan(dirtyAirLossS(0.5, 80, 0.2));
  });

  it('gives a tow on straights of a power track', () => {
    const straight = {
      share: 0.33,
      straightShare: 0.9,
      straight: [0.9, 0] as [number, number],
      cornerShare: 0.1,
      corner2: [0, 0] as [number, number],
    };
    const twisty = { ...straight, straightShare: 0.2 };
    expect(slipstreamGainS(0.4, straight, 0.9)).toBeGreaterThan(slipstreamGainS(0.4, twisty, 0.9));
    expect(slipstreamGainS(0.4, straight, 0.9)).toBeGreaterThan(slipstreamGainS(0.4, straight, 0.2));
  });

  it('scales DRS gain with the length of the zones in a sector', () => {
    const total = [0, 1, 2].reduce((s, k) => s + drsGainS(model, k as 0 | 1 | 2), 0);
    const expected = model.drsZones.reduce(
      (s, z) => s + (balance.race.drs.gainS * z.share) / balance.race.drs.referenceZoneShare,
      0,
    );
    expect(total).toBeCloseTo(expected, 10);
  });
});

describe('overtaking odds', () => {
  const p = (over: Partial<OvertakeFactors>) => overtakeProbability(factors(over));

  it('rise with pace, DRS, racecraft, fresher tyres and an ERS push', () => {
    expect(p({ paceAdvantageS: 0.5 })).toBeGreaterThan(p({ paceAdvantageS: 0.1 }));
    expect(p({ drsOpen: true })).toBeGreaterThan(p({ drsOpen: false }));
    expect(p({ attackerRacecraft: 95 })).toBeGreaterThan(p({ attackerRacecraft: 75 }));
    expect(p({ wearAdvantage: 0.3 })).toBeGreaterThan(p({ wearAdvantage: 0 }));
    expect(p({ attackerPushes: true })).toBeGreaterThan(p({}));
    expect(p({ defenderPushes: true })).toBeLessThan(p({}));
  });

  it('fall on a track that is hard to pass on and away from DRS zones', () => {
    expect(p({ overtakingDifficulty: 0.95 })).toBeLessThan(p({ overtakingDifficulty: 0.25 }));
    expect(p({ drsZone: false, drsOpen: false })).toBeLessThan(p({ drsZone: true, drsOpen: false }));
  });

  it('stop growing past the pace-advantage cap', () => {
    const cap = balance.race.overtaking.paceAdvantageCapS;
    expect(p({ paceAdvantageS: cap + 3 })).toBe(p({ paceAdvantageS: cap }));
  });

  it('let a car clearly faster over the lap through at a hard track, but not a marginally faster one', () => {
    // Regression: the odds once used the advantage in the passing sector only — a Mercedes a second
    // a lap faster sat behind a Williams for nine laps at Barcelona (seed d9e73675).
    const hard = { overtakingDifficulty: 0.7, drsOpen: true };
    expect(p({ ...hard, paceAdvantageS: 1 })).toBeGreaterThan(0.15);
    expect(p({ ...hard, paceAdvantageS: 0.3 })).toBeLessThan(0.1);
  });

  it('give a real chance to a car half a second a lap faster with DRS, so a queue can break up', () => {
    // Regression (ADR 005, п. 17): the attacker's pace used to be measured in the wake of the car it
    // was trying to pass, so a car 0.8 s a lap faster read as equal and a train never broke up —
    // ten undamaged cars sat behind a damaged one for the whole stint (Альберт-Парк, сид 2894873d).
    const track = { overtakingDifficulty: 0.5, drsOpen: true, drsZone: true };
    expect(p({ ...track, paceAdvantageS: 0.6 })).toBeGreaterThan(0.05);
    expect(p({ ...track, paceAdvantageS: 1 })).toBeGreaterThan(0.2);
    // Sitting in the queue at equal pace is still no chance at all.
    expect(p({ ...track, paceAdvantageS: 0 })).toBeLessThan(0.02);
  });

  it('keep a street circuit nearly impassable without a big advantage', () => {
    expect(p({ overtakingDifficulty: 0.98, paceAdvantageS: 0.2, drsOpen: true })).toBeLessThan(0.05);
  });
});
