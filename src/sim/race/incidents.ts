/**
 * What goes wrong (plan 5.4 events): pit-stop times, driver mistakes, mechanical failures,
 * punctures, and race control's answer to an incident — safety car, virtual safety car or nothing.
 */
import { balance } from '@/data/balance';
import type { Rng } from '../rng/rng';
import type { TrackStatus } from './types';

// ── Pit stops ────────────────────────────────────────────────────────────────────────────────

/** Seconds stationary in the box: crew quality, scatter, and the odd sticky wheel nut. */
export function stationaryTimeS(pitCrew: number, rng: Rng): { seconds: number; slow: boolean } {
  const p = balance.race.pit;
  const base = p.stationaryBaseS - p.crewSPerPoint * (pitCrew - p.crewRef) + rng.normal(0, p.stationarySd);
  const slow = rng.chance(p.slowStopChance);
  const extra = rng.range(p.slowStopLossS[0], p.slowStopLossS[1]);
  return { seconds: Math.max(p.minStationaryS, base) + (slow ? extra : 0), slow };
}

/** The pit-lane loss relative to a green-flag lap: cheaper while the field crawls behind SC/VSC. */
export function pitLaneFactor(status: TrackStatus): number {
  const p = balance.race.pit;
  return status === 'sc' ? p.safetyCarLossFactor : status === 'vsc' ? p.virtualSafetyCarLossFactor : 1;
}

// ── Driver mistakes ──────────────────────────────────────────────────────────────────────────

export type MistakeContext = {
  consistency: number;
  wetness: number;
  /** Seconds the current tyre is off the ideal compound for the conditions (slicks in the wet…). */
  gripDeficitS: number;
  fatigue: number;
};

/** Chance of a mistake over one lap. */
export function mistakeChancePerLap(ctx: MistakeContext): number {
  const m = balance.race.mistakes;
  const f = balance.race.fatigue;
  const base = Math.max(
    m.minChancePerLap,
    m.chancePerLapAt85 - m.perConsistencyPoint * (ctx.consistency - 85),
  );
  const wet = 1 + m.wetMultiplier * ctx.wetness;
  const grip = 1 + m.gripDeficitMultiplierPerS * Math.max(0, ctx.gripDeficitS);
  const tired = 1 + (f.mistakeFactorPer10 * Math.max(0, ctx.fatigue - f.freeUpTo)) / 10;
  return Math.min(0.5, base * wet * grip * tired);
}

export type Mistake = { kind: 'minor' | 'spin' | 'crash'; lossS: number };

/**
 * How bad a mistake is: mostly a moment, sometimes a spin, rarely the barrier — likelier where the
 * walls are close (a high safety-car profile) than where run-off forgives the error.
 */
export function mistakeOutcome(rng: Rng, scProfile: number): Mistake {
  const m = balance.race.mistakes;
  const severity = rng.next();
  const lossMinor = rng.range(m.minorLossS[0], m.minorLossS[1]);
  const lossSpin = rng.range(m.spinLossS[0], m.spinLossS[1]);
  const crashShare = Math.min(
    1,
    m.crashShareOfSpins * (m.crashShareProfileBase + m.crashShareProfilePer * scProfile),
  );
  if (severity >= m.spinShare) return { kind: 'minor', lossS: lossMinor };
  return severity < m.spinShare * crashShare
    ? { kind: 'crash', lossS: 0 }
    : { kind: 'spin', lossS: lossSpin };
}

// ── Mechanical ───────────────────────────────────────────────────────────────────────────────

/** Chance of a mechanical failure over one lap of a race of `laps` laps. */
export function failureChancePerLap(reliability: number, laps: number): number {
  const perRace = Math.min(0.95, balance.race.reliability.failureScale * (1 - reliability));
  return 1 - (1 - perRace) ** (1 / laps);
}

export function punctureChancePerLap(wear: number, cliffWear: number): number {
  const p = balance.tyres.puncture;
  return p.chancePerLap * (wear > cliffWear ? p.beyondCliffMultiplier : 1);
}

// ── Race control ─────────────────────────────────────────────────────────────────────────────

export type IncidentKind = 'crash' | 'stopped-car' | 'debris';

/**
 * Race control's response to an incident, given the track's safety-car profile: street circuits
 * with walls close by bring the safety car out far more often than open circuits.
 */
export function raceControlResponse(kind: IncidentKind, scProfile: number, rng: Rng): 'sc' | 'vsc' | null {
  const rc = balance.race.raceControl;
  const roll = rng.next();
  switch (kind) {
    case 'crash': {
      const sc = Math.min(1, rc.crashSafetyCarBase + rc.crashSafetyCarPerProfile * scProfile);
      return roll < sc ? 'sc' : 'vsc';
    }
    case 'stopped-car': {
      const sc = rc.stoppedCarSafetyCarPerProfile * scProfile;
      const vsc = rc.stoppedCarVscBase + rc.stoppedCarVscPerProfile * scProfile;
      return roll < sc ? 'sc' : roll < sc + vsc ? 'vsc' : null;
    }
    case 'debris': {
      const sc = rc.contactSafetyCarPerProfile * scProfile;
      return roll < sc ? 'sc' : null;
    }
  }
}

/** Chance per leader lap of a background incident (debris, a stray object, barrier repair). */
export function backgroundIncidentChancePerLap(scProfile: number, laps: number): number {
  return (balance.race.raceControl.backgroundIncidentsPerRace * scProfile) / laps;
}
