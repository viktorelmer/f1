import { describe, expect, it } from 'vitest';
import { balance } from '@/data/balance';
import { loadDefaultPack } from '@/data/packs/default';
import { prepareTrack } from './track';
import {
  dirtyAirLossS,
  drsGainS,
  type OvertakeFactors,
  overtakeProbability,
  slipstreamGainS,
} from './traffic';

const pack = loadDefaultPack();
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

  it('keep a street circuit nearly impassable without a big advantage', () => {
    expect(p({ overtakingDifficulty: 0.98, paceAdvantageS: 0.2, drsOpen: true })).toBeLessThan(0.05);
  });
});
