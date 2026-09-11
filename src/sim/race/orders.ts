/**
 * Team orders (plan 5.4, docs/systems/race-control.md): whether a driver does as told. A logistic
 * chance: loyalty and morale help, ego hurts, and so does being asked to give way while faster or
 * with a podium or points at stake.
 */
import { balance } from '@/data/balance';

export type Temperament = { loyalty: number; ego: number; morale: number };
export type OrderSituation = { faster: boolean; pointsAtStake: boolean };

export function obeyChance(driver: Temperament, situation: OrderSituation): number {
  const c = balance.race.teamOrders.compliance;
  const logit =
    c.base +
    c.perLoyalty * (driver.loyalty - 50) +
    c.perEgo * (driver.ego - 50) +
    c.perMorale * (driver.morale - 50) +
    (situation.faster ? c.whenFaster : 0) +
    (situation.pointsAtStake ? c.whenPointsAtStake : 0);
  return 1 / (1 + Math.exp(-logit));
}
