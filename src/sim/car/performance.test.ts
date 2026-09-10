import { describe, expect, it } from 'vitest';
import { balance } from '@/data/balance';
import { CHASSIS_PARTS, type ChassisPart } from '@/data/schema/balance';
import { carPerformance } from './performance';

const parts = (rating: number) =>
  Object.fromEntries(CHASSIS_PARTS.map((p) => [p, rating])) as Record<ChassisPart, number>;
const pu = { power: 85, ersDeployment: 84, fuelEfficiency: 83, reliability: 80 };

describe('carPerformance', () => {
  it('rates a car whose parts all rate X at X on every weighted characteristic', () => {
    const car = carPerformance(parts(70), pu);
    for (const key of [
      'downforceLow',
      'downforceHigh',
      'dirtyAirTolerance',
      'mechanicalGrip',
      'brakingStability',
      'tyreManagement',
    ] as const) {
      expect(car[key]).toBeCloseTo(70, 10);
    }
    expect(car.drag).toBeCloseTo(30, 10);
    expect(car.rideHeightSensitivity).toBeCloseTo(30, 10);
  });

  it('gives better parts more downforce, less drag, less weight', () => {
    const [worse, better] = [carPerformance(parts(70), pu), carPerformance(parts(90), pu)];
    expect(better.downforceHigh).toBeGreaterThan(worse.downforceHigh);
    expect(better.drag).toBeLessThan(worse.drag);
    expect(better.aeroEfficiency).toBeGreaterThan(worse.aeroEfficiency);
    expect(better.weight).toBeLessThan(worse.weight);
  });

  it('moves only the characteristics a part feeds', () => {
    const base = carPerformance(parts(80), pu);
    const brakes = carPerformance({ ...parts(80), brakes: 95 }, pu);
    expect(brakes.brakingStability).toBeGreaterThan(base.brakingStability);
    expect(brakes.downforceHigh).toBe(base.downforceHigh);
  });

  it('passes the power unit through and blends reliability', () => {
    const car = carPerformance(parts(100), pu);
    expect([car.power, car.ersDeployment, car.fuelEfficiency]).toEqual([85, 84, 83]);
    const share = balance.car.powerUnitShareOfReliability;
    expect(car.reliability).toBeCloseTo((share * 80 + (1 - share) * 100) / 100, 10);
    expect(car.weight).toBe(0);
  });
});
