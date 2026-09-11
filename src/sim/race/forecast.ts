/**
 * The strategist's view ahead (docs/systems/race-strategy.md, M4): where a car will finish, and
 * when its next stop should come. Built from what the team honestly sees — gaps, recent laps, the
 * tyres and compounds on each car — never from the future. The position comes out as an Estimate
 * made from the strategist's own model (estimateFromModel): there is no truth to observe yet.
 */
import { balance } from '@/data/balance';
import type { Compound } from '@/data/schema/race-balance';
import { type Estimate, estimateFromModel } from '../knowledge/estimate';
import type { GameDate } from '../types/game-date';
import { cumulativeTyreLoss, type StintModel } from './strategy';
import { isDry } from './tyres';
import type { Stint } from './types';

export type ForecastCar = {
  driverId: string;
  lapsDone: number;
  /** Race time at the car's last line crossing. */
  lineTimeS: number;
  /** A typical recent lap, pit laps left out. */
  recentLapS: number;
  compound: Compound;
  tyreAge: number;
  compoundsUsed: readonly Compound[];
  /** Stops made so far — visible to everyone. */
  stops: number;
};

/**
 * Stops a rival still has to make, as the strategist reckons it: the race's best plan has
 * `expectedStops`, less those made; and one more at least while the two-compound rule is open.
 */
export function stopsStillNeeded(car: ForecastCar, totalLaps: number, expectedStops: number): number {
  if (totalLaps - car.lapsDone <= 0) return 0;
  const dry = car.compoundsUsed.filter(isDry);
  const ruleOpen = car.compoundsUsed.every(isDry) && new Set(dry).size === 1 ? 1 : 0;
  return Math.max(ruleOpen, expectedStops - car.stops);
}

export type ForecastContext = {
  totalLaps: number;
  pitLossS: number;
  /** Stops in the best plan for this race: what the strategist expects of a typical rival. */
  expectedStops: number;
  /** The strategist's skill, 0..1. */
  skill: number;
  field: number;
  at: GameDate;
};

/**
 * Expected finishing position for `me`, who knows its own remaining stops, against the rivals as
 * the pit wall sees them. Each rival counts as ahead with a logistic chance of the projected gap,
 * so the forecast moves smoothly; the spread narrows as the race runs down and with a better strategist.
 */
export function finishForecast(
  me: ForecastCar & { stopsLeft: number },
  rivals: readonly ForecastCar[],
  ctx: ForecastContext,
): Estimate {
  const f = balance.race.strategy.forecast;
  const projected = (c: ForecastCar, stops: number) =>
    c.lineTimeS + (ctx.totalLaps - c.lapsDone) * c.recentLapS + stops * ctx.pitLossS;
  const mine = projected(me, me.stopsLeft);
  const lapsLeft = ctx.totalLaps - me.lapsDone;
  const scale = f.pairScaleS + f.pairScalePerLapS * lapsLeft;
  let mean = 1;
  for (const r of rivals) {
    const theirs = projected(r, stopsStillNeeded(r, ctx.totalLaps, ctx.expectedStops));
    mean += 1 / (1 + Math.exp(-(mine - theirs) / scale));
  }
  const skillFactor = f.sdFactorAtSkill0 + (f.sdFactorAtSkill1 - f.sdFactorAtSkill0) * ctx.skill;
  const sd = (f.sdBase + f.sdPerRemainingShare * (lapsLeft / ctx.totalLaps)) * skillFactor;
  return estimateFromModel(
    { mean, sd },
    {
      quantity: { min: 1, max: ctx.field, wideSd: ctx.field / 2 },
      at: ctx.at,
      sources: ['data-analysis'],
    },
  );
}

/**
 * The laps where the next planned stop costs at most `pitWindowS` more than the best lap for it:
 * the current tyres run to that lap, the next stint absorbs the difference, later stints stay as
 * planned. Null when no stop is left.
 */
export function pitWindow(
  plan: readonly Stint[],
  stintLaps: number,
  wear: number,
  lapsDone: number,
  totalLaps: number,
  model: StintModel,
): [number, number] | null {
  if (plan.length < 2) return null;
  const s = balance.race.strategy;
  const nominal = lapsDone + Math.max(1, plan[0]!.laps - stintLaps);
  const next = plan[1]!;
  const nextEnd = nominal + next.laps;
  const first = lapsDone + 1;
  const last = Math.min(nextEnd - s.minStintLaps, totalLaps - 1);
  if (last < first) return [nominal, nominal];
  const current = cumulativeTyreLoss(plan[0]!.compound, wear, last - lapsDone, model, false);
  const fresh = cumulativeTyreLoss(next.compound, 0, nextEnd - first, model, true);
  const times: [number, number][] = [];
  for (let lap = first; lap <= last; lap++)
    times.push([lap, current[lap - lapsDone]! + fresh[nextEnd - lap]!]);
  const best = Math.min(...times.map(([, t]) => t));
  const inside = times.filter(([, t]) => t <= best + s.pitWindowS).map(([lap]) => lap);
  return [Math.min(...inside), Math.max(...inside)];
}
