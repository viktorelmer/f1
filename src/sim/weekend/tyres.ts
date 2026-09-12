/**
 * The tyre entry (plan 5.3, docs/systems/weekend-play.md): how many sets of each dry compound a car
 * has for the weekend, declared before a wheel is turned and blind to the weather.
 *
 * It is one decision with a long shadow. Practice burns sets to learn, every part of qualifying
 * burns one, and whatever is left is what Sunday is run on — a compound that is gone is not a plan
 * the strategist can make. The declaration goes through `decide()`, so a rival's strategist and the
 * player's delegate weigh it the same way.
 */
import { balance } from '@/data/balance';
import { type Compound, DRY_COMPOUNDS, type DryCompound } from '@/data/schema/race-balance';
import { chooseByScore, type Decide, type Evaluation } from '../decide/decide';
import { streams } from '../rng/rng';
import { type PlanOption, planOptions, preRaceStintModel } from '../race/strategy';
import type { RaceEntry, RaceInput, StrategyGoal, StrategyPlan } from '../race/types';
import type { DriverId, PracticeRun, SessionKind, TyreAllocation } from '../types/world';
import { isPractice, isQualifying } from './format';
import { defaultPlan } from './practice';

/** Nothing of anything: the empty allocation, and the shape every other one has. */
export const noSets = (): TyreAllocation => ({ soft: 0, medium: 0, hard: 0 });

const isDryCompound = (c: Compound): c is DryCompound => c === 'soft' || c === 'medium' || c === 'hard';

/** Sets of `compound` the car still has. Wets are the supplier's and never run out. */
export function setsLeft(sets: TyreAllocation, compound: Compound): number {
  return isDryCompound(compound) ? sets[compound] : Number.POSITIVE_INFINITY;
}

/**
 * Takes one set of `compound` out of what the car has. Returns null when there is none left — the
 * caller decides what that means: a practice run that is not run, or a lap on scrubbed rubber.
 */
export function takeSet(sets: TyreAllocation, compound: Compound): TyreAllocation | null {
  if (!isDryCompound(compound)) return sets;
  if (sets[compound] <= 0) return null;
  return { ...sets, [compound]: sets[compound] - 1 };
}

/** Every way to split `limit` sets between the three dry compounds, keeping `min` of each. */
export function allocations(limit: number, min: number): TyreAllocation[] {
  const spare = limit - 3 * min;
  if (spare < 0) return [];
  const options: TyreAllocation[] = [];
  for (let soft = 0; soft <= spare; soft++)
    for (let medium = 0; medium <= spare - soft; medium++)
      options.push({
        soft: min + soft,
        medium: min + medium,
        hard: min + spare - soft - medium,
      });
  return options;
}

/** Whether a race plan can actually be bolted on: every stint needs a set of its own. */
export function planFits(plan: StrategyPlan, sets: TyreAllocation): boolean {
  const need = noSets();
  for (const stint of plan.stints) if (isDryCompound(stint.compound)) need[stint.compound] += 1;
  return DRY_COMPOUNDS.every((c) => need[c] <= sets[c]);
}

/**
 * What the weekend takes before the race: a set for every part of every qualifying, and a set for
 * every practice run that goes out on fresh rubber. Read off the format and the programmes, not
 * guessed — a sprint weekend qualifies twice and its entry has to cover both.
 */
export function tyreReserve(
  sessions: readonly SessionKind[],
  runs: (session: SessionKind) => readonly PracticeRun[],
): TyreAllocation {
  const t = balance.weekend.tyres;
  const parts = balance.weekend.qualifying.partMinutes.length;
  const reserve = noSets();
  for (const session of sessions) {
    if (isQualifying(session)) reserve.soft += parts * t.qualifyingSetsPerPart;
    else if (isPractice(session))
      for (const run of runs(session))
        if (balance.weekend.programmes[run.programme]?.fresh && isDryCompound(run.compound))
          reserve[run.compound] += 1;
  }
  return reserve;
}

export type TyreEntryContext = {
  /**
   * The plans the strategist would weigh on Sunday, from a model with no allocation behind it.
   * Weighed fastest first: what an allocation is worth is the best race it still allows, not the
   * first one that happens to fit.
   */
  plans: readonly PlanOption[];
  /** What the weekend will spend before the race (`tyreReserve`). */
  reserve: TyreAllocation;
  /** Sets the regulation allows for this weekend. */
  limit: number;
};

/**
 * The declaration. An allocation is worth what it lets the team do: the best race plan it can still
 * run once the weekend has taken its share, plus what it costs to turn up a set short on Saturday.
 * Nobody is choosing tyres here — they are choosing which Sunday they can have.
 */
export const decideTyreEntry: Decide<TyreEntryContext, StrategyGoal, TyreAllocation> = (
  context,
  competence,
  intent,
  rng,
) => {
  const t = balance.weekend.tyres;
  const options = allocations(context.limit, t.minPerCompound);
  const byTime = [...context.plans].sort((a, b) => a.timeS - b.timeS);
  const slowest = byTime[byTime.length - 1]?.timeS ?? 0;
  // What a set he will not have is worth to him. A bold strategist discounts it: he is betting on
  // not needing it, and that is exactly the bet a tyre entry is.
  const missingS = t.missingSetCostS * (1 - t.riskDiscount * (intent.risk - 0.5));
  const cost = (allocation: TyreAllocation) => {
    const forRace = noSets();
    let short = 0;
    for (const c of DRY_COMPOUNDS) {
      short += Math.max(0, context.reserve[c] - allocation[c]);
      forRace[c] = Math.max(0, allocation[c] - context.reserve[c]);
    }
    const plan = byTime.find((p) => planFits(p.plan, forRace));
    // No plan at all is worse than the worst plan there is: the race is run on scrubbed rubber.
    return (plan ? plan.timeS : slowest + missingS) + short * missingS;
  };
  const costs = new Map(options.map((o) => [o, cost(o)] as const));
  const best = Math.min(...costs.values());
  const evaluate = (option: TyreAllocation): Evaluation => ({
    score: Math.max(0, 1 - (costs.get(option)! - best) / t.entryScoreScaleS),
    reasons: [`tyres.entry.${option.soft}-${option.medium}-${option.hard}`],
  });
  return chooseByScore(options, evaluate, competence, rng);
};

/**
 * What every car declares for this weekend. Rivals' strategists and the player's delegate run the
 * same decision; the player overrides their own cars afterwards, on the strategy screen.
 */
export function declareTyres(
  input: RaceInput,
  sessions: readonly SessionKind[],
  limit: number,
): Record<DriverId, TyreAllocation> {
  const stream = streams(input.seed);
  const declared: Record<DriverId, TyreAllocation> = {};
  for (const entry of input.entries) {
    const model = preRaceStintModel(input, [entry]);
    const context: TyreEntryContext = {
      plans: planOptions(input.track.laps, model),
      reserve: tyreReserve(sessions, (session) => defaultPlan([entry], session)[entry.driverId] ?? []),
      limit,
    };
    declared[entry.driverId] = decideTyreEntry(
      context,
      entry.strategist,
      entryIntent(input, entry),
      stream(`race:${input.season}:r${input.round}:tyres:${entry.driverId}`),
    ).choice;
  }
  return declared;
}

/** The player's instruction when the car is theirs and they are directing, the team character otherwise. */
function entryIntent(input: RaceInput, entry: RaceEntry) {
  const control = input.control;
  return control && control.teamId === entry.teamId && control.strategy.mode === 'directed'
    ? { goal: control.strategy.goal, risk: control.strategy.risk, issuedBy: 'player' as const }
    : { goal: 'fastest' as StrategyGoal, risk: entry.riskAppetite, issuedBy: 'team-character' as const };
}
