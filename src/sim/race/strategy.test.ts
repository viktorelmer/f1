import { describe, expect, it } from 'vitest';
import { loadActivePack } from '@/data/packs/active';
import type { DecisionMakerProfile } from '../decide/decide';
import { createRng } from '../rng/rng';
import { fingerprint } from '../util/hash';
import {
  decidePitCall,
  decideRaceStrategy,
  type PitCallContext,
  pitCallOptions,
  planOptions,
  type StintModel,
} from './strategy';
import { isDry } from './tyres';

const pack = loadActivePack();
const track = (id: string) => pack.tracks.find((t) => t.id === id)!;
const model = (id: string, over: Partial<StintModel> = {}): StintModel => ({
  track: track(id),
  twoCompoundRule: true,
  tyreDegFactor: track(id).profile.tyreDegFactor,
  carTyreManagement: 80,
  driverTyreManagement: 85,
  trackTempC: 32,
  wetness: 0,
  averageFuelKg: 50,
  ...over,
});

const STRONG: DecisionMakerProfile = { skill: 1, consistency: 1, rapport: 0 };
const WEAK: DecisionMakerProfile = { skill: 0.1, consistency: 0.1, rapport: 0 };
const intent = { goal: 'fastest' as const, risk: 0.5, issuedBy: 'team-character' as const };

describe('plan options', () => {
  it('cover the race distance and obey the two-dry-compound rule', () => {
    for (const id of ['al-rimal', 'porto-rocca', 'parco-reale']) {
      const laps = track(id).laps;
      for (const o of planOptions(laps, model(id))) {
        expect(o.plan.stints.reduce((s, st) => s + st.laps, 0)).toBe(laps);
        expect(new Set(o.plan.stints.map((s) => s.compound)).size).toBeGreaterThan(1);
        expect(o.plan.stints).toHaveLength(o.stops + 1);
      }
    }
  });

  it('stop more on a track that eats tyres', () => {
    const best = (id: string, deg: number) => {
      const m = model(id, { tyreDegFactor: deg });
      return planOptions(track(id).laps, m).reduce((a, b) => (b.timeS < a.timeS ? b : a));
    };
    expect(best('al-rimal', 1.8).stops).toBeGreaterThan(best('al-rimal', 0.5).stops);
  });

  it('run a wet start on wet-weather tyres without the dry-compound rule', () => {
    const options = planOptions(
      track('northfield').laps,
      model('northfield', { wetness: 0.6, trackTempC: 18 }),
    );
    const best = options.reduce((a, b) => (b.timeS < a.timeS ? b : a));
    expect(isDry(best.plan.stints[0]!.compound)).toBe(false);
  });
});

describe('decideRaceStrategy', () => {
  const options = planOptions(track('al-rimal').laps, model('al-rimal'));
  const bestTime = Math.min(...options.map((o) => o.timeS));

  it('lets a strong strategist pick near the best plan, a weak one scatter', () => {
    const lost = (profile: DecisionMakerProfile, stream: string) => {
      const rng = createRng('strategy', stream);
      return Array.from(
        { length: 300 },
        () => decideRaceStrategy(options, profile, intent, rng).choice.timeS - bestTime,
      );
    };
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(lost(STRONG, 'strong'))).toBeLessThan(2);
    expect(mean(lost(WEAK, 'weak'))).toBeGreaterThan(mean(lost(STRONG, 'strong')));
  });

  it('is deterministic by stream', () => {
    const run = () => decideRaceStrategy(options, WEAK, intent, createRng('M2', 'decisions:kestrel:plan'));
    expect(fingerprint(run().choice)).toBe(fingerprint(run().choice));
  });
});

describe('decidePitCall', () => {
  const base: PitCallContext = {
    trigger: 'safety-car',
    remainingLaps: 25,
    current: { compound: 'medium', wear: 0.45 },
    compoundsUsed: ['medium'],
    status: 'sc',
    model: model('al-rimal'),
    damageS: 0,
  };

  it('offers staying out and boxing for each sensible compound', () => {
    const options = pitCallOptions(base);
    expect(options.map((o) => o.call)).toContain('stay');
    expect(options.filter((o) => o.call === 'pit').map((o) => o.compound)).toEqual([
      'soft',
      'medium',
      'hard',
    ]);
    for (const o of options) expect(o.stints.reduce((s, st) => s + st.laps, 0)).toBe(25);
  });

  it('counts what damage will cost if the car stays out, and that a stop repairs it', () => {
    const clean = pitCallOptions(base).find((o) => o.call === 'stay')!;
    const damaged = pitCallOptions({ ...base, damageS: 0.8 }).find((o) => o.call === 'stay')!;
    // Damage rides along to the first stop of the plan, and only there.
    expect(damaged.timeS - clean.timeS).toBeCloseTo(0.8 * clean.stints[0]!.laps, 6);
    // Boxing now repairs it, so those options are untouched.
    const pitClean = pitCallOptions(base).filter((o) => o.call === 'pit');
    const pitDamaged = pitCallOptions({ ...base, damageS: 0.8 }).filter((o) => o.call === 'pit');
    expect(pitDamaged.map((o) => o.timeS)).toEqual(pitClean.map((o) => o.timeS));
  });

  it('boxes a badly damaged car under the safety car, and leaves a clean one out', () => {
    // Fresh tyres: nothing to gain from a stop unless the car is dragging damage to the flag.
    const fresh = { ...base, current: { compound: 'medium' as const, wear: 0.05 } };
    const call = (damageS: number) =>
      decidePitCall(
        pitCallOptions({ ...fresh, damageS }),
        STRONG,
        intent,
        createRng('M4', 'decisions:kestrel:calls'),
      ).choice.call;
    expect(call(0)).toBe('stay');
    expect(call(0.8)).toBe('pit');
  });

  it('never keeps a dry race on one compound to the flag', () => {
    const stay = pitCallOptions(base).find((o) => o.call === 'stay')!;
    expect(new Set(stay.stints.map((s) => s.compound)).size).toBeGreaterThan(1);
  });

  it('takes the cheap stop under the safety car more reliably with a strong strategist', () => {
    const pits = (profile: DecisionMakerProfile, stream: string) => {
      const rng = createRng('call', stream);
      const options = pitCallOptions(base);
      return Array.from(
        { length: 300 },
        () => decidePitCall(options, profile, intent, rng).choice.call === 'pit',
      ).filter(Boolean).length;
    };
    expect(pits(STRONG, 'strong')).toBeGreaterThan(pits(WEAK, 'weak'));
    expect(pits(STRONG, 'strong')).toBeGreaterThan(270);
  });

  it('boxes for wet-weather tyres when the rain gets heavy on slicks', () => {
    const wet: PitCallContext = {
      ...base,
      trigger: 'weather',
      status: 'green',
      current: { compound: 'medium', wear: 0.2 },
      compoundsUsed: ['soft', 'medium'],
      model: model('al-rimal', { wetness: 0.55, trackTempC: 20 }),
    };
    const rng = createRng('call', 'rain');
    const options = pitCallOptions(wet);
    const calls = Array.from({ length: 200 }, () => decidePitCall(options, STRONG, intent, rng).choice);
    expect(calls.filter((c) => c.call === 'pit' && !isDry(c.compound)).length).toBeGreaterThan(190);
  });

  it('only chooses the tyre after a puncture', () => {
    const options = pitCallOptions({ ...base, trigger: 'puncture', status: 'green' });
    expect(options.every((o) => o.call === 'pit')).toBe(true);
  });
});
