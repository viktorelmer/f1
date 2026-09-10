/**
 * Car characteristics (plan 4.2) from part ratings and the power unit. Parts are the single source
 * of truth: development changes parts, characteristics follow. Weights live in balance/car.json
 * and are calibrated in M2.
 */
import { balance } from '@/data/balance';
import type { CarBalance, ChassisPart } from '@/data/schema/balance';
import type { CarPerformance, PowerUnitSpec } from '../types/world';

type PartWeights = CarBalance['downforceLow'];

function weighted(chassis: Readonly<Record<ChassisPart, number>>, weights: PartWeights): number {
  let sum = 0;
  let total = 0;
  for (const [part, weight] of Object.entries(weights) as [ChassisPart, number][]) {
    sum += weight * chassis[part];
    total += weight;
  }
  return sum / total;
}

export function carPerformance(
  chassis: Readonly<Record<ChassisPart, number>>,
  powerUnit: PowerUnitSpec,
  tuning: CarBalance = balance.car,
): CarPerformance {
  const downforceLow = weighted(chassis, tuning.downforceLow);
  const downforceHigh = weighted(chassis, tuning.downforceHigh);
  const drag = 100 - weighted(chassis, tuning.drag);
  const downforce = (downforceLow + downforceHigh) / 2;
  const parts = Object.values(chassis);
  const meanRating = parts.reduce((a, b) => a + b, 0) / parts.length;

  return {
    downforceLow,
    downforceHigh,
    drag,
    aeroEfficiency: (100 * downforce) / (downforce + drag),
    dirtyAirTolerance: weighted(chassis, tuning.dirtyAirTolerance),
    mechanicalGrip: weighted(chassis, tuning.mechanicalGrip),
    brakingStability: weighted(chassis, tuning.brakingStability),
    rideHeightSensitivity: 100 - weighted(chassis, tuning.rideHeightSensitivity),
    weight: tuning.overweightKgAtRating0 * (1 - meanRating / 100),
    power: powerUnit.power,
    ersDeployment: powerUnit.ersDeployment,
    fuelEfficiency: powerUnit.fuelEfficiency,
    tyreManagement: weighted(chassis, tuning.tyreManagement),
    reliability:
      (tuning.powerUnitShareOfReliability * powerUnit.reliability +
        (1 - tuning.powerUnitShareOfReliability) * weighted(chassis, tuning.chassisReliability)) /
      100,
  };
}
