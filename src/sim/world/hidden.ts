/**
 * Hidden values: the only part of the starting world the seed decides (plan section 10). Each
 * person or team draws from its own stream, so adding one to the pack moves nobody else's values.
 */
import { balance } from '@/data/balance';
import { SETUP_PARAMETERS } from '@/data/schema/pack';
import type { PackDriver, PackTeam, Setup } from '@/data/schema/pack';
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

/**
 * How far a track's factory preset sits from its true optimum (plan 5.2: the preset is decent but
 * not perfect). Drawn once per track per career, so the same track is always off the same way — a
 * team that finds it here keeps knowing it, and a team that never runs here never does.
 */
export function drawSetupOffset(rng: Rng): Setup {
  const sd = balance.setup.ideal.factoryPresetSd;
  const offset = {} as Setup;
  for (const p of SETUP_PARAMETERS) offset[p] = round(rng.normal(0, sd[p]), 2);
  return offset;
}
