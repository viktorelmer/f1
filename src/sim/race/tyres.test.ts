import { describe, expect, it } from 'vitest';
import { balance } from '@/data/balance';
import { bestCompoundFor, tyreLossS, wearPerLap, wetnessLossS } from './tyres';

const ctx = {
  trackDegFactor: 1,
  carTyreManagement: balance.tyres.carTyreManagementRef,
  driverTyreManagement: balance.tyres.driverTyreManagementRef,
  fuelKg: 0,
  trackTempC: 30,
  wetness: 0,
};

describe('tyre time loss', () => {
  it('orders the dry compounds soft < medium < hard when new', () => {
    expect(tyreLossS('soft', 0, 30, 0)).toBeLessThan(tyreLossS('medium', 0, 30, 0));
    expect(tyreLossS('medium', 0, 30, 0)).toBeLessThan(tyreLossS('hard', 0, 30, 0));
  });

  it('degrades the soft at 0.08–0.15 s per lap on an average track (plan target)', () => {
    const perLap = wearPerLap('soft', ctx);
    const degPerLap = tyreLossS('soft', 5 * perLap, 30, 0) - tyreLossS('soft', 4 * perLap, 30, 0);
    expect(degPerLap).toBeGreaterThanOrEqual(0.08);
    expect(degPerLap).toBeLessThanOrEqual(0.15);
  });

  it('falls off a cliff past the wear threshold', () => {
    const cliff = balance.tyres.compounds.soft.cliffWear;
    const before = tyreLossS('soft', cliff - 0.01, 30, 0) - tyreLossS('soft', cliff - 0.02, 30, 0);
    const after = tyreLossS('soft', cliff + 0.02, 30, 0) - tyreLossS('soft', cliff + 0.01, 30, 0);
    expect(after).toBeGreaterThan(3 * before);
  });

  it('costs time outside the working temperature window', () => {
    const [lo] = balance.tyres.compounds.hard.windowC;
    expect(tyreLossS('hard', 0.1, lo - 15, 0)).toBeGreaterThan(tyreLossS('hard', 0.1, lo + 5, 0));
  });
});

describe('tyres in the wet', () => {
  it('switches the best compound slicks → inters → wets as the track gets wetter', () => {
    const order = [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1].map((w) => bestCompoundFor(w, 20));
    const rank = (c: string) => (c === 'inter' ? 1 : c === 'wet' ? 2 : 0);
    for (let i = 1; i < order.length; i++)
      expect(rank(order[i]!)).toBeGreaterThanOrEqual(rank(order[i - 1]!));
    expect(rank(order[0]!)).toBe(0);
    expect(order).toContain('inter');
    expect(order[order.length - 1]).toBe('wet');
  });

  it('makes slicks lose more and more as water rises', () => {
    expect(wetnessLossS('soft', 0.2)).toBeGreaterThan(wetnessLossS('soft', 0.1));
    expect(wetnessLossS('soft', 0)).toBe(0);
  });
});

describe('wear', () => {
  it('is faster on an abrasive track, with more fuel, and outside the window', () => {
    const base = wearPerLap('medium', ctx);
    expect(wearPerLap('medium', { ...ctx, trackDegFactor: 1.4 })).toBeCloseTo(base * 1.4, 10);
    expect(wearPerLap('medium', { ...ctx, fuelKg: 100 })).toBeGreaterThan(base);
    expect(wearPerLap('medium', { ...ctx, trackTempC: 60 })).toBeGreaterThan(base);
  });

  it('is slower for a car and a driver kind to their tyres', () => {
    const base = wearPerLap('medium', ctx);
    expect(wearPerLap('medium', { ...ctx, carTyreManagement: ctx.carTyreManagement + 10 })).toBeLessThan(
      base,
    );
    expect(
      wearPerLap('medium', { ...ctx, driverTyreManagement: ctx.driverTyreManagement + 10 }),
    ).toBeLessThan(base);
  });

  it('destroys inters on a dry track', () => {
    expect(wearPerLap('inter', { ...ctx, wetness: 0 })).toBeGreaterThan(
      2 * wearPerLap('inter', { ...ctx, wetness: 0.4 }),
    );
  });
});
