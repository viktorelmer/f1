/**
 * Free-air pace (plan 5.4 lap formula): how fast a car and driver go with nobody around. Traffic,
 * DRS and overtaking are applied on top in simulate.ts.
 */
import { balance } from '@/data/balance';
import type { PackTrack } from '@/data/schema/pack';
import type { CarPerformance } from '../types/world';
import type { RaceDriver } from './types';

/** One number for a car at a track: characteristics weighted by the track's profile. */
export function carScore(car: CarPerformance, track: PackTrack): number {
  const { weights: w, powerMix } = balance.race.car;
  const p = track.profile;
  const corners = p.lowSpeedCorners + p.highSpeedCorners;
  const lowShare = corners > 0 ? p.lowSpeedCorners / corners : 0.5;

  const parts: [number, number][] = [
    [
      w.aeroBase + w.aeroPerSensitivity * p.aeroSensitivity,
      car.downforceLow * lowShare + car.downforceHigh * (1 - lowShare),
    ],
    [
      w.powerBase + w.powerPerSensitivity * p.powerSensitivity,
      (powerMix.power * car.power + powerMix.ers * car.ersDeployment + powerMix.lowDrag * (100 - car.drag)) /
        (powerMix.power + powerMix.ers + powerMix.lowDrag),
    ],
    [w.mechanicalBase + w.mechanicalPerLowSpeedShare * lowShare, car.mechanicalGrip],
    [w.brakingBase + w.brakingPerBrakeWear * p.brakeWear, car.brakingStability],
  ];
  const totalWeight = parts.reduce((s, [weight]) => s + weight, 0);
  return parts.reduce((s, [weight, value]) => s + weight * value, 0) / totalWeight;
}

/** Share of lap time the car gains (negative) or loses against the reference car. */
export function carPaceFraction(car: CarPerformance, track: PackTrack): number {
  const { referenceScore, paceSensitivity } = balance.race.car;
  return -paceSensitivity * (carScore(car, track) - referenceScore);
}

/** Share of lap time the driver gains or loses: pace, form, morale, and wet skill on a wet track. */
export function driverPaceFraction(driver: RaceDriver, wetness: number): number {
  const d = balance.race.driver;
  return (
    -d.paceSensitivity * (driver.pace - d.referencePace) -
    d.formSensitivity * (driver.form - 70) -
    d.moraleSensitivity * (driver.morale - 70) -
    d.wetSkillSensitivity * ((driver.wetSkill - d.referencePace) / 10) * wetness
  );
}

/** Seconds per lap for mass on board (excess car weight or fuel), scaled to the lap length. */
export function massSeconds(kg: number, baseLapTime: number): number {
  return kg * balance.race.weightSPerKgPer90s * (baseLapTime / 90);
}

/** Fuel burnt per lap at this track by a car of this efficiency. */
export function fuelPerLap(track: PackTrack, fuelEfficiency: number): number {
  const f = balance.race.fuel;
  return track.profile.fuelPerLap * (1 - f.consumptionPerPoint * (fuelEfficiency - f.efficiencyRef));
}

/** Standard deviation of lap-to-lap scatter for a driver's consistency. */
export function lapNoiseSd(consistency: number): number {
  const { atConsistency100, atConsistency60 } = balance.race.lapNoiseSd;
  const t = Math.min(1, Math.max(0, (consistency - 60) / 40));
  return atConsistency60 + (atConsistency100 - atConsistency60) * t;
}

/** Fatigue gained over one lap in these conditions. */
export function fatiguePerLap(driver: RaceDriver, airTempC: number, track: PackTrack): number {
  const f = balance.race.fatigue;
  const rate =
    f.perLap +
    f.perDegAbove25 * Math.max(0, airTempC - 25) +
    f.perHighSpeedCorner * track.profile.highSpeedCorners;
  return Math.max(0, rate * (1 - f.staminaPerPoint * (driver.stamina - f.staminaRef)));
}

/** Seconds per lap lost to fatigue above the free threshold. */
export function fatigueSeconds(fatigue: number): number {
  const f = balance.race.fatigue;
  return (f.paceSPer10 * Math.max(0, fatigue - f.freeUpTo)) / 10;
}
