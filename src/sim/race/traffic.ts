/**
 * Cars around cars (plan 5.4): dirty air, the tow, DRS, and the positional overtaking model —
 * inside a second at the end of a sector, the follower tries; success is a logistic function of
 * pace, DRS, racecraft, tyres, ERS and how hard the track is to pass on.
 */
import { balance } from '@/data/balance';
import type { SectorShape, TrackModel } from './track';
import type { SectorIndex } from './types';

/** Seconds lost in a sector following another car at `gapS`, for a car of this dirty-air tolerance. */
export function dirtyAirLossS(gapS: number, tolerance: number, aeroSensitivity: number): number {
  const t = balance.race.traffic;
  if (gapS >= t.dirtyAirWindowS) return 0;
  const closeness = 1 - Math.max(0, gapS) / t.dirtyAirWindowS;
  const car = Math.max(0, 1 - t.lossPerTolerancePoint * (tolerance - t.toleranceRef));
  return t.dirtyAirLossS * (t.dirtyAirAeroBase + aeroSensitivity) * car * closeness;
}

/** Seconds gained in a sector from the tow of a car `gapS` ahead: straights on power tracks. */
export function slipstreamGainS(gapS: number, shape: SectorShape, powerSensitivity: number): number {
  const t = balance.race.traffic;
  if (gapS >= t.slipstreamWindowS) return 0;
  return (
    t.slipstreamGainS * powerSensitivity * shape.straightShare * (1 - Math.max(0, gapS) / t.slipstreamWindowS)
  );
}

/** DRS gain in a sector: the sum over zones ending in it, scaled by each zone's length. */
export function drsGainS(model: TrackModel, sector: SectorIndex): number {
  const d = balance.race.drs;
  return model.drsZones
    .filter((z) => z.sector === sector)
    .reduce((sum, z) => sum + d.gainS * (z.share / d.referenceZoneShare), 0);
}

export function hasDrsZone(model: TrackModel, sector: SectorIndex): boolean {
  return model.drsZones.some((z) => z.sector === sector);
}

export type OvertakeFactors = {
  /** How much faster the attacker is over a lap in its own pace, seconds (negative = slower). */
  paceAdvantageS: number;
  drsOpen: boolean;
  drsZone: boolean;
  attackerRacecraft: number;
  defenderRacecraft: number;
  /** Defender's tyre wear minus attacker's (positive = the attacker is on better tyres). */
  wearAdvantage: number;
  overtakingDifficulty: number;
  lap1: boolean;
  attackerPushes: boolean;
  defenderPushes: boolean;
  /** Radio aggression: the attacker's push in the fight less the defender's (a logit shift). */
  aggression: number;
};

export function overtakeProbability(f: OvertakeFactors): number {
  const o = balance.race.overtaking;
  const logit =
    o.base +
    o.perPaceS * Math.min(f.paceAdvantageS, o.paceAdvantageCapS) +
    (f.drsOpen ? o.drs : 0) +
    (f.drsZone ? 0 : o.outsideDrsZone) +
    o.perRacecraft * (f.attackerRacecraft - f.defenderRacecraft) +
    o.perWearDifference * f.wearAdvantage +
    o.perDifficulty * f.overtakingDifficulty +
    (f.lap1 ? o.lap1Bonus : 0) +
    (f.attackerPushes ? o.ersAttack : 0) -
    (f.defenderPushes ? o.ersAttack : 0) +
    f.aggression;
  return 1 / (1 + Math.exp(-logit));
}
