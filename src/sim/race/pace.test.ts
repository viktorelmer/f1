import { describe, expect, it } from 'vitest';
import { balance } from '@/data/balance';
import { loadActivePack } from '@/data/packs/active';
import type { CarPerformance } from '../types/world';
import {
  carPaceFraction,
  carScore,
  driverPaceFraction,
  fatiguePerLap,
  fatigueSeconds,
  fuelPerLap,
  lapNoiseSd,
  massSeconds,
} from './pace';
import type { RaceDriver } from './types';

const pack = loadActivePack();
const track = (id: string) => pack.tracks.find((t) => t.id === id)!;

const car = (over: Partial<CarPerformance> = {}): CarPerformance => ({
  downforceLow: 80,
  downforceHigh: 80,
  drag: 20,
  aeroEfficiency: 80,
  dirtyAirTolerance: 80,
  mechanicalGrip: 80,
  brakingStability: 80,
  rideHeightSensitivity: 20,
  weight: 5,
  power: 80,
  ersDeployment: 80,
  fuelEfficiency: 80,
  tyreManagement: 80,
  reliability: 0.85,
  ...over,
});
const driver = (over: Partial<RaceDriver> = {}): RaceDriver => ({
  pace: 88,
  consistency: 88,
  racecraft: 85,
  tyreManagement: 85,
  wetSkill: 88,
  starts: 85,
  qualifying: 88,
  stamina: 88,
  form: 70,
  morale: 70,
  fatigue: 10,
  ...over,
});

describe('car pace', () => {
  it('rewards downforce on an aero track and power on a power track', () => {
    const aeroCar = car({ downforceLow: 90, downforceHigh: 90 });
    const powerCar = car({ power: 90, drag: 10 });
    const aero = track('isewan');
    const power = track('parco-reale');
    expect(carScore(aeroCar, aero) - carScore(powerCar, aero)).toBeGreaterThan(0);
    expect(carScore(powerCar, power) - carScore(aeroCar, power)).toBeGreaterThan(0);
  });

  it('is zero for the reference car and a gain for a better one', () => {
    const reference = car({
      downforceLow: 80,
      downforceHigh: 80,
      drag: 20,
      power: 80,
      ersDeployment: 80,
      mechanicalGrip: 80,
      brakingStability: 80,
    });
    expect(carPaceFraction(reference, track('al-rimal'))).toBeCloseTo(0, 10);
    expect(carPaceFraction(car({ downforceHigh: 95 }), track('al-rimal'))).toBeLessThan(0);
  });

  it('spreads the default grid by the plan’s 2–3% between the best and the worst car', () => {
    // The pack's cars through the same formula the race uses, at an average track.
    const t = track('al-rimal');
    const fractions = pack.teams.map((team) => {
      const supplier = pack.engineSuppliers.find((e) => e.id === team.engine.supplierId)!;
      const parts = team.chassis;
      const w = balance.car;
      const weighted = (weights: Partial<Record<keyof typeof parts, number>>) => {
        const entries = Object.entries(weights) as [keyof typeof parts, number][];
        return entries.reduce((s, [p, x]) => s + x * parts[p], 0) / entries.reduce((s, [, x]) => s + x, 0);
      };
      const c = car({
        downforceLow: weighted(w.downforceLow),
        downforceHigh: weighted(w.downforceHigh),
        drag: 100 - weighted(w.drag),
        mechanicalGrip: weighted(w.mechanicalGrip),
        brakingStability: weighted(w.brakingStability),
        power: supplier.spec.power,
        ersDeployment: supplier.spec.ersDeployment,
      });
      return carPaceFraction(c, t);
    });
    const spread = (Math.max(...fractions) - Math.min(...fractions)) * 100;
    expect(spread).toBeGreaterThan(1.8);
    expect(spread).toBeLessThan(3.5);
  });
});

describe('driver pace', () => {
  it('turns pace, form and morale into lap time', () => {
    expect(driverPaceFraction(driver({ pace: 98 }), 0)).toBeLessThan(driverPaceFraction(driver(), 0));
    expect(driverPaceFraction(driver({ form: 90 }), 0)).toBeLessThan(driverPaceFraction(driver(), 0));
  });

  it('counts wet skill only on a wet track', () => {
    const rain = driver({ wetSkill: 98 });
    expect(driverPaceFraction(rain, 0)).toBe(driverPaceFraction(driver(), 0));
    expect(driverPaceFraction(rain, 1)).toBeLessThan(driverPaceFraction(driver(), 1));
  });

  it('scatters less for a more consistent driver', () => {
    expect(lapNoiseSd(95)).toBeLessThan(lapNoiseSd(75));
    expect(lapNoiseSd(88)).toBeGreaterThan(0.15);
    expect(lapNoiseSd(88)).toBeLessThan(0.4);
  });

  it('tires faster in the heat and with less stamina, and slows when tired', () => {
    const t = track('marina-lights');
    expect(fatiguePerLap(driver(), 32, t)).toBeGreaterThan(fatiguePerLap(driver(), 20, t));
    expect(fatiguePerLap(driver({ stamina: 70 }), 25, t)).toBeGreaterThan(
      fatiguePerLap(driver({ stamina: 95 }), 25, t),
    );
    expect(fatigueSeconds(20)).toBe(0);
    expect(fatigueSeconds(60)).toBeGreaterThan(0);
  });
});

describe('mass and fuel', () => {
  it('charges about 0.03 s per kg on a 90 s lap (plan 5.4)', () => {
    expect(massSeconds(10, 90)).toBeCloseTo(0.3, 10);
    expect(massSeconds(10, 70)).toBeLessThan(massSeconds(10, 90));
  });

  it('burns less fuel with a more efficient power unit', () => {
    const t = track('al-rimal');
    expect(fuelPerLap(t, 90)).toBeLessThan(fuelPerLap(t, 75));
    expect(fuelPerLap(t, balance.race.fuel.efficiencyRef)).toBeCloseTo(t.profile.fuelPerLap, 10);
  });
});
