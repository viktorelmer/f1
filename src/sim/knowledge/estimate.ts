/**
 * Estimates — the only way uncertainty reaches the player (plan 4.1, docs/systems/estimate.md).
 *
 * Truth lives in world state. An estimate is built from measurements of it and never holds the
 * truth or the observer's bias: `measure()` is the one place both are touched, and what leaves it
 * is an Observation — the truth plus bias plus noise, as a single number.
 */
import { balance } from '@/data/balance';
import type { Rng } from '../rng/rng';
import type { GameDate } from '../types/game-date';

/** What could narrow an estimate — listed in its tooltip, so a wide interval points at an investment. */
export type ObservationSource =
  | 'scouting'
  | 'working-relationship'
  | 'practice'
  | 'simulator'
  | 'data-analysis'
  | 'wind-tunnel'
  | 'cfd'
  | 'track-test'
  | 'weather-service';

/** The scale an estimated quantity lives on. */
export type QuantitySpec = {
  readonly min: number;
  readonly max: number;
  /** Standard deviation at which the observer effectively knows nothing (confidence 0). */
  readonly wideSd: number;
};

/** How well an observer measures: spread is visible as interval width; bias is never shown. */
export type Precision = { readonly sd: number; readonly bias: number };

/** One measurement. Its value already contains the observer's bias and noise. */
export type Observation = { readonly value: number; readonly sd: number; readonly at: GameDate };

export type Estimate<T extends number = number> = {
  /** Most likely value, within the quantity's bounds. */
  readonly value: T;
  readonly low: T;
  readonly high: T;
  /** 0..1, for the discrete label and for sorting. */
  readonly confidence: number;
  readonly sources: readonly ObservationSource[];
  readonly observedAt: GameDate;
  /** The observer's model: built from measurements only, unclamped so refine() stays unbiased. */
  readonly basis: {
    readonly mean: number;
    readonly sd: number;
    readonly min: number;
    readonly max: number;
    readonly wideSd: number;
  };
};

export type ConfidenceLabel = 'low' | 'medium' | 'high';

export type ObserveContext = {
  readonly quantity: QuantitySpec;
  readonly at: GameDate;
  readonly sources: readonly ObservationSource[];
};

/** Takes one measurement of the truth: truth + bias + N(0, sd). */
export function measure(truth: number, precision: Precision, rng: Rng, at: GameDate): Observation {
  if (!(precision.sd >= 0)) throw new RangeError(`Precision sd must be >= 0, got ${precision.sd}`);
  const noise = precision.sd > 0 ? rng.normal(0, precision.sd) : 0;
  return { value: truth + precision.bias + noise, sd: precision.sd, at };
}

/** A first estimate of a quantity from a single measurement. */
export function observe<T extends number = number>(
  truth: T,
  precision: Precision,
  rng: Rng,
  context: ObserveContext,
): Estimate<T> {
  const observation = measure(truth, precision, rng, context.at);
  return fromBasis<T>(
    { mean: observation.value, sd: observation.sd, ...context.quantity },
    context.sources,
    context.at,
  );
}

/**
 * Narrows an estimate with a new measurement: inverse-variance weighting of two Gaussian
 * measurements. The interval only ever narrows; a consistent bias is not removed, so repeated
 * biased observations converge — confidently — on truth + bias.
 */
export function refine<T extends number = number>(prior: Estimate<T>, observation: Observation): Estimate<T> {
  const { mean: m, sd: s } = prior.basis;
  const { value: o, sd: t } = observation;

  let mean: number;
  let sd: number;
  if (s === 0) {
    [mean, sd] = [m, 0];
  } else if (t === 0) {
    [mean, sd] = [o, 0];
  } else {
    const wPrior = 1 / (s * s);
    const wObs = 1 / (t * t);
    mean = (m * wPrior + o * wObs) / (wPrior + wObs);
    sd = Math.sqrt(1 / (wPrior + wObs));
  }

  return fromBasis<T>({ ...prior.basis, mean, sd }, prior.sources, observation.at);
}

/**
 * An estimate of something nobody knows yet — a forecast. It is built from the observer's own
 * model (its mean and spread), not from a measurement of a truth: there is no truth to take, so by
 * its signature this cannot leak one.
 */
export function estimateFromModel<T extends number = number>(
  model: { readonly mean: number; readonly sd: number },
  context: ObserveContext,
): Estimate<T> {
  if (!(model.sd >= 0)) throw new RangeError(`Model sd must be >= 0, got ${model.sd}`);
  return fromBasis<T>({ mean: model.mean, sd: model.sd, ...context.quantity }, context.sources, context.at);
}

export function confidenceLabel(confidence: number): ConfidenceLabel {
  const { medium, high } = balance.estimate.confidenceLabels;
  if (confidence >= high) return 'high';
  if (confidence >= medium) return 'medium';
  return 'low';
}

function fromBasis<T extends number>(
  basis: Estimate['basis'],
  sources: readonly ObservationSource[],
  at: GameDate,
): Estimate<T> {
  const halfWidth = balance.estimate.intervalZ * basis.sd;
  const clamp = (x: number) => Math.min(basis.max, Math.max(basis.min, x));
  return {
    value: clamp(basis.mean) as T,
    low: clamp(basis.mean - halfWidth) as T,
    high: clamp(basis.mean + halfWidth) as T,
    confidence: Math.min(1, Math.max(0, 1 - basis.sd / basis.wideSd)),
    sources: [...sources],
    observedAt: at,
    basis,
  };
}
