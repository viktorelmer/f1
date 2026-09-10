/**
 * Hidden values: the only part of the starting world the seed decides (plan section 10). Each
 * person or team draws from its own stream, so adding one to the pack moves nobody else's values.
 */
import type { PackDriver, PackTeam } from '@/data/schema/pack';
import type { Rng } from '../rng/rng';
import type { DriverHidden, TeamHidden } from '../types/world';

/** Symmetric triangular draw over [low, high]: the middle of a pack's range is likelier than its ends. */
export function triangular(rng: Rng, [low, high]: readonly [number, number]): number {
  return low + ((high - low) * (rng.next() + rng.next())) / 2;
}

const round = (x: number, digits: number) => Math.round(x * 10 ** digits) / 10 ** digits;

export function drawDriverHidden(rng: Rng, ranges: PackDriver['hiddenRanges']): DriverHidden {
  return {
    potential: Math.round(triangular(rng, ranges.potential)),
    growthRate: round(triangular(rng, ranges.growthRate), 2),
    injuryProneness: round(triangular(rng, ranges.injuryProneness), 2),
  };
}

export function drawTeamHidden(rng: Rng, ranges: PackTeam['hiddenRanges']): TeamHidden {
  return { correlationBias: round(triangular(rng, ranges.correlationBias), 3) };
}
