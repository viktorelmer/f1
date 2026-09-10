import { describe, expect, it } from 'vitest';
import { balance } from '@/data/balance';
import { createRng } from '../rng/rng';
import { gameDate } from '../types/game-date';
import { fingerprint } from '../util/hash';
import { confidenceLabel, type Estimate, measure, observe, refine } from './estimate';

const at = gameDate(2027, 1, 4);
const potential = balance.estimate.quantities['driver.potential'];
const context = { quantity: potential, at, sources: ['scouting'] as const };

const ESTIMATE_KEYS = ['basis', 'confidence', 'high', 'low', 'observedAt', 'sources', 'value'];

describe('observe', () => {
  it('produces an estimate that holds neither the truth nor the bias', () => {
    const estimate = observe(83, { sd: 6, bias: 4 }, createRng('s', 'obs'), context);
    expect(Object.keys(estimate).sort()).toEqual(ESTIMATE_KEYS);
    expect(Object.keys(estimate.basis).sort()).toEqual(['max', 'mean', 'min', 'sd', 'wideSd']);
    expect(estimate.value).not.toBe(83);
    expect(JSON.stringify(estimate)).not.toMatch(/truth|bias/);
  });

  it('brackets the value with an interval of z·sd each side, inside the bounds', () => {
    const e = observe(50, { sd: 5, bias: 0 }, createRng('s', 'obs'), context);
    expect(e.high - e.value).toBeCloseTo(balance.estimate.intervalZ * 5, 10);
    expect(e.value - e.low).toBeCloseTo(balance.estimate.intervalZ * 5, 10);

    const top = observe(99, { sd: 8, bias: 0 }, createRng('s', 'top'), context);
    expect(top.high).toBeLessThanOrEqual(potential.max);
    expect(top.low).toBeGreaterThanOrEqual(potential.min);
    expect(top.value).toBeLessThanOrEqual(potential.max);
  });

  it('returns the truth exactly for a perfect, unbiased observer', () => {
    const e = observe(71, { sd: 0, bias: 0 }, createRng('s', 'x'), context);
    expect([e.value, e.low, e.high, e.confidence]).toEqual([71, 71, 71, 1]);
  });

  it('contains the truth in its interval about 80% of the time when unbiased', () => {
    const rng = createRng('s', 'coverage');
    const N = 4000;
    let hits = 0;
    for (let i = 0; i < N; i++) {
      const e = observe(50, { sd: 6, bias: 0 }, rng, context);
      if (e.low <= 50 && 50 <= e.high) hits++;
    }
    expect(hits / N).toBeGreaterThan(0.77);
    expect(hits / N).toBeLessThan(0.83);
  });

  it('maps spread to confidence and to a discrete label', () => {
    const conf = (sd: number) => observe(50, { sd, bias: 0 }, createRng('s', 'c'), context).confidence;
    expect(conf(0)).toBe(1);
    expect(conf(potential.wideSd)).toBe(0);
    expect(conf(3)).toBeGreaterThan(conf(9));
    expect(confidenceLabel(0.9)).toBe('high');
    expect(confidenceLabel(0.5)).toBe('medium');
    expect(confidenceLabel(0.1)).toBe('low');
  });

  it('is deterministic: seed + input → fixed hash', () => {
    const run = () =>
      Array.from({ length: 20 }, (_, i) =>
        observe(40 + i, { sd: 7, bias: -2 }, createRng('M1', `knowledge:test:${i}`), context),
      );
    expect(fingerprint(run())).toBe(fingerprint(run()));
    expect(fingerprint(run())).toBe('011d7e5d68d10d');
  });
});

describe('refine', () => {
  const rng = createRng('s', 'refine');

  it('narrows the interval with every observation', () => {
    let e: Estimate = observe(60, { sd: 10, bias: 0 }, rng, context);
    for (let i = 0; i < 5; i++) {
      const next = refine(e, measure(60, { sd: 10, bias: 0 }, rng, at));
      expect(next.high - next.low).toBeLessThan(e.high - e.low);
      expect(next.confidence).toBeGreaterThan(e.confidence);
      e = next;
    }
  });

  it('converges on the truth when the observer is unbiased', () => {
    let e: Estimate = observe(60, { sd: 10, bias: 0 }, rng, context);
    for (let i = 0; i < 400; i++) e = refine(e, measure(60, { sd: 10, bias: 0 }, rng, at));
    expect(e.value).toBeGreaterThan(59);
    expect(e.value).toBeLessThan(61);
  });

  it('converges confidently on truth + bias — the truth ends up outside the interval', () => {
    const biased = { sd: 8, bias: 6 };
    let e: Estimate = observe(60, biased, rng, context);
    for (let i = 0; i < 400; i++) e = refine(e, measure(60, biased, rng, at));
    expect(e.value).toBeGreaterThan(65);
    expect(e.value).toBeLessThan(67);
    expect(confidenceLabel(e.confidence)).toBe('high');
    expect(60 < e.low || 60 > e.high).toBe(true);
  });

  it('keeps its sources and takes the date of the newest observation', () => {
    const later = gameDate(2027, 6, 1);
    const e = refine(
      observe(60, { sd: 10, bias: 0 }, rng, context),
      measure(60, { sd: 10, bias: 0 }, rng, later),
    );
    expect(e.sources).toEqual(['scouting']);
    expect(e.observedAt).toBe(later);
  });

  it('treats a zero-spread side as exact', () => {
    const exact = observe(60, { sd: 0, bias: 0 }, rng, context);
    expect(refine(exact, measure(40, { sd: 5, bias: 0 }, rng, at)).value).toBe(60);
    const vague = observe(60, { sd: 10, bias: 0 }, rng, context);
    expect(refine(vague, { value: 44, sd: 0, at }).value).toBe(44);
  });
});
