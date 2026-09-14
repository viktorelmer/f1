/**
 * What a team knows about the weekend it is at (docs/systems/weekend.md): how hard this track is on
 * tyres and how much fuel its own car burns here. Both are `Estimate`s — the team never sees the
 * truth, and every team has its own reading of it (plan 5.10, 5.13).
 *
 * A team arrives with a prior, worth about what the calendar and last year's notes are worth, and
 * running in practice narrows it. A team that skips practice races on the prior.
 */
import { balance } from '@/data/balance';
import { measure, observe, refine } from '../knowledge/estimate';
import type { Rng } from '../rng/rng';
import type { GameDate } from '../types/game-date';
import type { WeekendKnowledge } from '../types/world';

export type WeekendTruth = { tyreDegradation: number; fuelPerLapKg: number };

/**
 * How tightly a team reads a quantity after `laps` of running: one lap is worth `base`, and the
 * error falls with the square root of the laps. A stronger data-analysis department reads the same
 * laps better — but cannot invent data nobody collected, hence the floor.
 */
export function readingSd(base: number, laps: number, department: number): number {
  const l = balance.weekend.learning;
  const quality = Math.max(l.minSdFactor, 1 - l.sdPerDepartmentPoint * (department - l.departmentRef));
  return (base / Math.sqrt(Math.max(1, laps))) * quality;
}

/** The team's view of a weekend before it has turned a wheel: the calendar and the pack, no more. */
export function priorKnowledge(round: number, truth: WeekendTruth, at: GameDate, rng: Rng): WeekendKnowledge {
  const l = balance.weekend.learning;
  const q = balance.estimate.quantities;
  return {
    round,
    laps: 0,
    // The engineers' readings are added by the weekend when it opens: one per car, not per team.
    setup: {},
    tyreDegradation: observe(truth.tyreDegradation, { sd: l.priorDegradationSd, bias: 0 }, rng, {
      quantity: q['track.tyreDegradation'],
      at,
      sources: ['data-analysis'],
    }),
    fuelPerLapKg: observe(truth.fuelPerLapKg, { sd: l.priorFuelSd, bias: 0 }, rng, {
      quantity: q['car.fuelPerLap'],
      at,
      sources: ['data-analysis'],
    }),
  };
}

export type Learned = {
  /** Laps of the run that say something about tyre wear (a long run). */
  degradationLaps: number;
  /** Laps that say something about fuel use. */
  fuelLaps: number;
  /** Laps spent working on the setup: they narrow the engineer's reading, not this estimate. */
  setupLaps: number;
};

/**
 * Folds a session's running into what the team knew: more laps, a tighter estimate. Each quantity
 * is measured once per session from the laps that bear on it, then fused into the prior.
 */
export function learnFromRunning(
  prior: WeekendKnowledge,
  truth: WeekendTruth,
  learned: Learned,
  department: number,
  at: GameDate,
  rng: Rng,
): WeekendKnowledge {
  const l = balance.weekend.learning;
  let { tyreDegradation, fuelPerLapKg } = prior;
  if (learned.degradationLaps > 0) {
    const sd = readingSd(l.degradationSdBase, learned.degradationLaps, department);
    tyreDegradation = refine(tyreDegradation, measure(truth.tyreDegradation, { sd, bias: 0 }, rng, at));
  }
  if (learned.fuelLaps > 0) {
    const sd = readingSd(l.fuelSdBase, learned.fuelLaps, department);
    fuelPerLapKg = refine(fuelPerLapKg, measure(truth.fuelPerLapKg, { sd, bias: 0 }, rng, at));
  }
  return {
    round: prior.round,
    laps: prior.laps + learned.degradationLaps + learned.fuelLaps + learned.setupLaps,
    setup: prior.setup,
    tyreDegradation,
    fuelPerLapKg,
  };
}
