/**
 * Race strategy through decide() (docs/systems/race-strategy.md). Two decisions — the pre-race
 * plan and the in-race pit call — both rest on one quick model of expected time: cumulative tyre
 * loss per compound, plus pit-lane losses. The strategist sees only what the team honestly knows:
 * public compound data, the track, its own car's tyres and the conditions it can see.
 */
import { balance } from '@/data/balance';
import type { PackTrack } from '@/data/schema/pack';
import { type Compound, DRY_COMPOUNDS } from '@/data/schema/race-balance';
import { chooseByScore, type Decide, type Decision, type Evaluation } from '../decide/decide';
import { COMPARISON_WEAR, isDry, tyreLossS, warmupLossS, wearPerLap } from './tyres';
import { fuelPerLap } from './pace';
import type { TyreAllocation } from '../types/world';
import type { RaceEntry, RaceInput, StrategyGoal, StrategyPlan, Stint, TrackStatus } from './types';
import { initialSurface, sampleAt } from './weather';

export type StintModel = {
  track: PackTrack;
  /** A dry race must use two compounds; a sprint need not (plan 5.3). */
  twoCompoundRule: boolean;
  /** Degradation factor the strategist plans on: what the team believes, not what the track is. */
  tyreDegFactor: number;
  carTyreManagement: number;
  driverTyreManagement: number;
  trackTempC: number;
  wetness: number;
  /** Average fuel over the remaining distance: wear depends on it, the plan does not. */
  averageFuelKg: number;
  /**
   * Fresh sets the car still has of each dry compound (docs/systems/weekend-play.md). A plan can
   * only use rubber that exists: a compound that is gone is not planned on. Absent means unlimited
   * — the batch runner and the tests race without an allocation behind them.
   */
  sets?: Partial<Record<Compound, number>>;
};

const ALL_COMPOUNDS: readonly Compound[] = ['soft', 'medium', 'hard', 'inter', 'wet'];

/**
 * Cumulative tyre seconds over 0..maxLaps laps of a stint on `compound` starting at `startWear`.
 * A fresh set also pays its warm-up lap. `wearFactor` scales the wear rate (a radio pace mode).
 */
export function cumulativeTyreLoss(
  compound: Compound,
  startWear: number,
  maxLaps: number,
  model: StintModel,
  fresh: boolean,
  wearFactor = 1,
): Float64Array {
  const cum = new Float64Array(maxLaps + 1);
  const perLap =
    wearFactor *
    wearPerLap(compound, {
      trackDegFactor: model.tyreDegFactor,
      carTyreManagement: model.carTyreManagement,
      driverTyreManagement: model.driverTyreManagement,
      fuelKg: model.averageFuelKg,
      trackTempC: model.trackTempC,
      wetness: model.wetness,
    });
  let wear = startWear;
  for (let lap = 1; lap <= maxLaps; lap++) {
    const loss = tyreLossS(compound, wear + perLap / 2, model.trackTempC, model.wetness);
    cum[lap] = cum[lap - 1]! + loss + (fresh && lap === 1 ? warmupLossS(compound) : 0);
    wear += perLap;
  }
  return cum;
}

type Completion = { timeS: number; stints: Stint[] };

/**
 * The fastest way to cover `laps` laps from here: a first stint (the current tyre, or a fresh
 * `first`), then between `stops.min` and `stops.max` more stops. With `needAnother`, the
 * dry-compound rule is still open: some stint must use a compound other than that dry one.
 */
function bestCompletion(
  laps: number,
  first: { compound: Compound; cum: Float64Array; fresh?: boolean },
  fresh: (c: Compound) => Float64Array,
  pitS: number,
  stops: { min: number; max: number },
  needAnother: Compound | null,
  candidates: readonly Compound[],
  sets?: Partial<Record<Compound, number>>,
): Completion | null {
  const minStint = Math.min(
    balance.race.strategy.minStintLaps,
    Math.max(1, Math.floor(laps / (stops.max + 1))),
  );
  const satisfies = (compounds: Compound[]) =>
    needAnother === null || compounds.some((c) => !isDry(c) || c !== needAnother);
  /**
   * Whether the car has the rubber for a sequence: every stint but a tyre already on the car needs
   * a set of its own, so three stints on the soft need three sets of softs.
   */
  const affordable = (used: readonly Compound[]) => {
    if (!sets || used.length === 0) return true;
    const need = new Map<Compound, number>();
    for (const c of used) need.set(c, (need.get(c) ?? 0) + 1);
    for (const [c, n] of need) if ((sets[c] ?? 0) < n) return false;
    return true;
  };
  /** The tyre the car starts on: a fresh one is a set out of the allocation, a used one is not. */
  const opening: readonly Compound[] = first.fresh ? [first.compound] : [];
  let best: Completion | null = null;
  const consider = (timeS: number, stints: Stint[]) => {
    if (!best || timeS < best.timeS) best = { timeS, stints };
  };

  if (stops.min <= 0 && satisfies([first.compound]) && affordable(opening))
    consider(first.cum[laps]!, [{ compound: first.compound, laps }]);
  if (stops.min <= 1 && stops.max >= 1) {
    for (const c1 of candidates) {
      if (!satisfies([first.compound, c1])) continue;
      if (sets && !affordable([...opening, c1])) continue;
      const cum1 = fresh(c1);
      for (let k = minStint; k <= laps - minStint; k++) {
        consider(first.cum[k]! + pitS + cum1[laps - k]!, [
          { compound: first.compound, laps: k },
          { compound: c1, laps: laps - k },
        ]);
      }
    }
  }
  if (stops.max >= 2) {
    for (const c1 of candidates) {
      const cum1 = fresh(c1);
      for (const c2 of candidates) {
        if (!satisfies([first.compound, c1, c2])) continue;
        if (sets && !affordable([...opening, c1, c2])) continue;
        const cum2 = fresh(c2);
        for (let k1 = minStint; k1 <= laps - 2 * minStint; k1++) {
          for (let k2 = minStint; k1 + k2 <= laps - minStint; k2++) {
            consider(first.cum[k1]! + 2 * pitS + cum1[k2]! + cum2[laps - k1 - k2]!, [
              { compound: first.compound, laps: k1 },
              { compound: c1, laps: k2 },
              { compound: c2, laps: laps - k1 - k2 },
            ]);
          }
        }
      }
    }
  }
  return best;
}

/** Compounds worth considering in these conditions: slicks when dry, anything close to the best when wet. */
function candidateCompounds(model: StintModel): Compound[] {
  const s = balance.race.strategy;
  const loss = (c: Compound) => tyreLossS(c, COMPARISON_WEAR, model.trackTempC, model.wetness);
  const worth =
    model.wetness < s.dryBelowWetness
      ? [...DRY_COMPOUNDS]
      : ALL_COMPOUNDS.filter((c) => loss(c) - Math.min(...ALL_COMPOUNDS.map(loss)) < s.candidateWindowS);
  if (!model.sets) return worth;
  // A compound with no set left is not a plan, it is a wish. Wets are the supplier's, never declared.
  const have = worth.filter((c) => !isDry(c) || (model.sets![c] ?? 0) > 0);
  return have.length > 0 ? have : worth;
}

/**
 * What a stop costs a strategist: the pit lane, a typical stationary time, and the track position
 * that has to be won back on the road — dear where passing is hard.
 */
export function plannedPitLossS(track: PackTrack): number {
  const s = balance.race.strategy;
  return (
    track.pitLoss +
    balance.race.pit.stationaryBaseS +
    s.trackPositionCostPerStopS * track.profile.overtakingDifficulty
  );
}

// ── Pre-race plan ────────────────────────────────────────────────────────────────────────────

export type PlanOption = { plan: StrategyPlan; timeS: number; stops: number };

/**
 * The model a team plans a race on before the start: its own beliefs about the track, the weather
 * it can see at the green light, and the rubber it has left. One place, so the pre-race screen, the
 * tyre entry and the race itself all weigh the same race.
 */
export function preRaceStintModel(input: RaceInput, cars: readonly RaceEntry[]): StintModel {
  const lead = cars[0]!;
  const track = input.track;
  const start = sampleAt(input.weather, 0);
  const surface = initialSurface(input.weather);
  return {
    track,
    twoCompoundRule: input.format !== 'sprint',
    tyreDegFactor: lead.beliefs.tyreDegradation,
    carTyreManagement: lead.car.tyreManagement,
    driverTyreManagement: cars.reduce((sum, c) => sum + c.driver.tyreManagement, 0) / cars.length,
    trackTempC: start.trackTempC,
    wetness: Math.max(...surface.wetness),
    averageFuelKg: (fuelPerLap(track, lead.car.fuelEfficiency) * track.laps) / 2,
    sets: sharedSets(cars),
  };
}

/**
 * The rubber a team can count on for both its cars. One strategist decides one plan for the team,
 * and the two racks differ — qualifying takes a set per part, and one car may have gone out in Q1
 * while the other ran in Q3 — so the plan is held to what the thinner of the two can run.
 */
function sharedSets(cars: readonly RaceEntry[]): TyreAllocation | undefined {
  const racks = cars.map((c) => c.tyreSets);
  if (racks.some((r) => r === undefined)) return undefined;
  return racks.reduce((a, b) => ({
    soft: Math.min(a!.soft, b!.soft),
    medium: Math.min(a!.medium, b!.medium),
    hard: Math.min(a!.hard, b!.hard),
  }))!;
}

/** Candidate plans for a race of `laps` laps: the best split for each compound sequence. */
export function planOptions(laps: number, model: StintModel): PlanOption[] {
  const withinAllocation = affordablePlans(laps, model);
  // Nothing the car can afford covers the distance under the rules: it plans as if it had the
  // rubber, and finds out on Sunday. Better a plan the team cannot quite run than no plan at all.
  return withinAllocation.length > 0
    ? withinAllocation
    : affordablePlans(laps, { ...model, sets: undefined });
}

function affordablePlans(laps: number, model: StintModel): PlanOption[] {
  const pitS = plannedPitLossS(model.track);
  const candidates = candidateCompounds(model);
  const dry = candidates.every(isDry);
  const cache = new Map<Compound, Float64Array>();
  const fresh = (c: Compound) => {
    let cum = cache.get(c);
    if (!cum) cache.set(c, (cum = cumulativeTyreLoss(c, 0, laps, model, true)));
    return cum;
  };

  const options: PlanOption[] = [];
  const rule = dry && model.twoCompoundRule;
  for (const start of candidates) {
    for (let stops = rule ? 1 : 0; stops <= balance.race.strategy.maxStops; stops++) {
      const range = { min: stops, max: stops };
      const best = bestCompletion(
        laps,
        { compound: start, cum: fresh(start), fresh: true },
        fresh,
        pitS,
        range,
        rule ? start : null,
        candidates,
        model.sets,
      );
      if (best) options.push({ plan: { stints: best.stints }, timeS: best.timeS, stops });
    }
  }
  return options;
}

export type { StrategyGoal };

/** −1 for fewer stops (keep track position), +1 for more (fresh tyres to attack), 0 for the fastest race. */
const goalLean = (goal: StrategyGoal) => (goal === 'gain-places' ? 1 : goal === 'hold-position' ? -1 : 0);

/**
 * The strategist picks a race plan. Scores are the share of a fixed time scale a plan is behind
 * the best one, so a weak strategist's noise means seconds of misjudgement, not percent of a race.
 * A risk-loving team character tips near-equal plans towards fewer stops; the goal tips them
 * towards fewer stops to keep a place, or more to go after places.
 */
export const decideRaceStrategy: Decide<readonly PlanOption[], StrategyGoal, PlanOption> = (
  options,
  competence,
  intent,
  rng,
) => {
  const s = balance.race.strategy;
  const best = Math.min(...options.map((o) => o.timeS));
  const mostStops = Math.max(...options.map((o) => o.stops));
  const evaluate = (o: PlanOption): Evaluation => ({
    score:
      Math.max(0, 1 - (o.timeS - best) / s.planScoreScaleS) +
      s.riskStopBias * (intent.risk - 0.5) * (mostStops - o.stops) +
      s.goalStopBias * goalLean(intent.goal) * o.stops,
    reasons: [
      `strategy.plan.stops.${o.stops}`,
      ...o.plan.stints.map((st) => `strategy.compound.${st.compound}`),
    ],
  });
  return chooseByScore(options, evaluate, competence, rng);
};

// ── In-race pit call ─────────────────────────────────────────────────────────────────────────

export type PitCallTrigger = 'safety-car' | 'weather' | 'damage' | 'puncture';

export type PitCallContext = {
  trigger: PitCallTrigger;
  /** Laps still to run after the current one. */
  remainingLaps: number;
  current: { compound: Compound; wear: number };
  compoundsUsed: readonly Compound[];
  status: TrackStatus;
  model: StintModel;
  /** Seconds a lap the car is losing to damage, which a stop repairs (0 for an undamaged car). */
  damageS: number;
};

export type PitCallOption = { call: 'stay' | 'pit'; compound: Compound; timeS: number; stints: Stint[] };

export function pitCallOptions(ctx: PitCallContext): PitCallOption[] {
  const withinAllocation = affordableCalls(ctx);
  // Nothing left to bolt on: the strategist calls as if it were there (see `planOptions`).
  return withinAllocation.length > 0
    ? withinAllocation
    : affordableCalls({ ...ctx, model: { ...ctx.model, sets: undefined } });
}

function affordableCalls(ctx: PitCallContext): PitCallOption[] {
  const { remainingLaps: laps, model } = ctx;
  if (laps <= 0) return [{ call: 'stay', compound: ctx.current.compound, timeS: 0, stints: [] }];
  const pitGreen = plannedPitLossS(model.track);
  const pitNow =
    model.track.pitLoss *
      (ctx.status === 'sc'
        ? balance.race.pit.safetyCarLossFactor
        : ctx.status === 'vsc'
          ? balance.race.pit.virtualSafetyCarLossFactor
          : 1) +
    balance.race.pit.stationaryBaseS;
  const candidates = candidateCompounds(model);
  const cache = new Map<Compound, Float64Array>();
  const fresh = (c: Compound) => {
    let cum = cache.get(c);
    if (!cum) cache.set(c, (cum = cumulativeTyreLoss(c, 0, laps, model, true)));
    return cum;
  };
  // The two-dry-compound rule is open while every compound used is the same dry one.
  const usedWet = ctx.compoundsUsed.some((c) => !isDry(c));
  const drySet = new Set(ctx.compoundsUsed.filter(isDry));
  const needAnother = ctx.model.twoCompoundRule && !usedWet && drySet.size === 1 ? [...drySet][0]! : null;
  const maxStops = balance.race.strategy.maxStops;

  const options: PitCallOption[] = [];
  if (ctx.trigger !== 'puncture') {
    const current = {
      compound: ctx.current.compound,
      cum: cumulativeTyreLoss(ctx.current.compound, ctx.current.wear, laps, model, false),
    };
    const stay = bestCompletion(
      laps,
      current,
      fresh,
      pitGreen,
      { min: 0, max: maxStops },
      needAnother,
      candidates,
      model.sets,
    );
    if (stay)
      options.push({
        call: 'stay',
        compound: ctx.current.compound,
        // Damage rides along until the first stop of this plan — to the flag when there is none.
        timeS: stay.timeS + ctx.damageS * (stay.stints[0]?.laps ?? laps),
        stints: stay.stints,
      });
  }
  for (const c of candidates) {
    const rest = bestCompletion(
      laps,
      { compound: c, cum: fresh(c), fresh: true },
      fresh,
      pitGreen,
      { min: 0, max: maxStops - 1 },
      needAnother,
      candidates,
      model.sets,
    );
    if (rest) options.push({ call: 'pit', compound: c, timeS: pitNow + rest.timeS, stints: rest.stints });
  }
  return options;
}

/**
 * A new plan for the rest of the race with exactly `stops` more stops, starting on the tyres the car
 * is on: the strategist's fastest way to do it, or null when it cannot be done (too few laps left,
 * or no way to satisfy the compound rule).
 */
export function replan(
  ctx: Omit<PitCallContext, 'trigger' | 'status' | 'damageS'>,
  stops: number,
): Stint[] | null {
  const { remainingLaps: laps, model } = ctx;
  if (laps <= 0) return null;
  const candidates = candidateCompounds(model);
  const cache = new Map<Compound, Float64Array>();
  const fresh = (c: Compound) => {
    let cum = cache.get(c);
    if (!cum) cache.set(c, (cum = cumulativeTyreLoss(c, 0, laps, model, true)));
    return cum;
  };
  const usedWet = ctx.compoundsUsed.some((c) => !isDry(c));
  const drySet = new Set(ctx.compoundsUsed.filter(isDry));
  const needAnother = ctx.model.twoCompoundRule && !usedWet && drySet.size === 1 ? [...drySet][0]! : null;
  const current = {
    compound: ctx.current.compound,
    cum: cumulativeTyreLoss(ctx.current.compound, ctx.current.wear, laps, model, false),
  };
  return (
    bestCompletion(
      laps,
      current,
      fresh,
      plannedPitLossS(model.track),
      { min: stops, max: stops },
      needAnother,
      candidates,
      model.sets,
    )?.stints ?? null
  );
}

/** The strategist's call on the pit wall when something changes: stay out, or box for a compound. */
export const decidePitCall: Decide<readonly PitCallOption[], StrategyGoal, PitCallOption> = (
  options,
  competence,
  intent,
  rng,
) => {
  const s = balance.race.strategy;
  const best = Math.min(...options.map((o) => o.timeS));
  const evaluate = (o: PitCallOption): Evaluation => ({
    score:
      Math.max(0, 1 - (o.timeS - best) / s.pitCallScoreScaleS) +
      s.goalStopBias * goalLean(intent.goal) * (o.call === 'pit' ? 1 : 0),
    reasons: [o.call === 'stay' ? 'strategy.call.stay' : `strategy.call.pit.${o.compound}`],
  });
  return chooseByScore(options, evaluate, competence, rng);
};

export type { Decision };
