/**
 * Each team's first read of every driver's potential (docs/systems/estimate.md). Every team gets
 * its own estimates — the AI decides on what its scouts believe, never on the truth (plan 5.10).
 */
import { balance } from '@/data/balance';
import { type Estimate, estimateFromModel, observe } from '../knowledge/estimate';
import type { Rng } from '../rng/rng';
import type { GameDate } from '../types/game-date';
import type { Driver, DriverHidden, DriverId, Staff, TeamId, TeamKnowledge } from '../types/world';

/**
 * Spread of a first potential estimate. A better scout reads potential more tightly; a team reads
 * its own drivers better still; a team without a scout knows nothing beyond the public record.
 */
export function potentialSd(scoutSkill: number | null, ownDriver: boolean): number {
  const { scouting, quantities } = balance.estimate;
  if (scoutSkill === null) return quantities['driver.potential'].wideSd;
  const t = Math.min(1, Math.max(0, (scoutSkill - 1) / 99));
  const sd =
    scouting.potentialSdAtSkill1 + (scouting.potentialSdAtSkill100 - scouting.potentialSdAtSkill1) * t;
  return ownDriver ? sd * scouting.ownDriverSdFactor : sd;
}

export function initialKnowledge(
  teamId: TeamId,
  scout: Staff | undefined,
  drivers: readonly Driver[],
  hidden: Readonly<Record<DriverId, DriverHidden>>,
  at: GameDate,
  rng: (stream: string) => Rng,
): TeamKnowledge {
  const quantity = balance.estimate.quantities['driver.potential'];
  const entries = drivers.map((driver): [DriverId, { potential: Estimate }] => {
    const truth = hidden[driver.id];
    if (!truth) throw new Error(`No hidden values for driver "${driver.id}"`);
    const sd = potentialSd(scout?.attributes.skill ?? null, driver.contract?.teamId === teamId);
    const potential = observe(
      truth.potential,
      { sd, bias: 0 },
      rng(`world:knowledge:${teamId}:driver:${driver.id}`),
      {
        quantity,
        at,
        sources: ['scouting', 'working-relationship'],
      },
    );
    return [driver.id, { potential }];
  });
  // What the team makes of its own tunnel before it has checked a single part on track: nothing
  // but the belief that it is honest (docs/systems/car-development.md).
  const correlation = estimateFromModel(
    { mean: 0, sd: balance.development.correlation.priorSd },
    { quantity: balance.estimate.quantities['team.correlation'], at, sources: ['wind-tunnel'] },
  );
  return { drivers: Object.fromEntries(entries), correlation, rivals: {}, weekend: null };
}
