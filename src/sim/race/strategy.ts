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
import type { StrategyPlan, Stint, TrackStatus } from './types';

export type StintModel = {
  track: PackTrack;
  carTyreManagement: number;
  driverTyreManagement: number;
  trackTempC: number;
  wetness: number;
  /** Average fuel over the remaining distance: wear depends on it, the plan does not. */
  averageFuelKg: number;
};

const ALL_COMPOUNDS: readonly Compound[] = ['soft', 'medium', 'hard', 'inter', 'wet'];

/**
 * Cumulative tyre seconds over 0..maxLaps laps of a stint on `compound` starting at `startWear`.
 * A fresh set also pays its warm-up lap.
 */
export function cumulativeTyreLoss(
  compound: Compound,
  startWear: number,
  maxLaps: number,
  model: StintModel,
  fresh: boolean,
): Float64Array {
  const cum = new Float64Array(maxLaps + 1);
  const perLap = wearPerLap(compound, {
    trackDegFactor: model.track.profile.tyreDegFactor,
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
  first: { compound: Compound; cum: Float64Array },
  fresh: (c: Compound) => Float64Array,
  pitS: number,
  stops: { min: number; max: number },
  needAnother: Compound | null,
  candidates: readonly Compound[],
): Completion | null {
  const minStint = Math.min(
    balance.race.strategy.minStintLaps,
    Math.max(1, Math.floor(laps / (stops.max + 1))),
  );
  const satisfies = (compounds: Compound[]) =>
    needAnother === null || compounds.some((c) => !isDry(c) || c !== needAnother);
  let best: Completion | null = null;
  const consider = (timeS: number, stints: Stint[]) => {
    if (!best || timeS < best.timeS) best = { timeS, stints };
  };

  if (stops.min <= 0 && satisfies([first.compound]))
    consider(first.cum[laps]!, [{ compound: first.compound, laps }]);
  if (stops.min <= 1 && stops.max >= 1) {
    for (const c1 of candidates) {
      if (!satisfies([first.compound, c1])) continue;
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
  if (model.wetness < s.dryBelowWetness) return [...DRY_COMPOUNDS];
  const loss = (c: Compound) => tyreLossS(c, COMPARISON_WEAR, model.trackTempC, model.wetness);
  const bestLoss = Math.min(...ALL_COMPOUNDS.map(loss));
  return ALL_COMPOUNDS.filter((c) => loss(c) - bestLoss < s.candidateWindowS);
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

/** Candidate plans for a race of `laps` laps: the best split for each compound sequence. */
export function planOptions(laps: number, model: StintModel): PlanOption[] {
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
  for (const start of candidates) {
    for (let stops = dry ? 1 : 0; stops <= balance.race.strategy.maxStops; stops++) {
      const range = { min: stops, max: stops };
      const best = bestCompletion(
        laps,
        { compound: start, cum: fresh(start) },
        fresh,
        pitS,
        range,
        dry ? start : null,
        candidates,
      );
      if (best) options.push({ plan: { stints: best.stints }, timeS: best.timeS, stops });
    }
  }
  return options;
}

export type StrategyGoal = 'fastest';

/**
 * The strategist picks a race plan. Scores are the share of a fixed time scale a plan is behind
 * the best one, so a weak strategist's noise means seconds of misjudgement, not percent of a race.
 * A risk-loving team character tips near-equal plans towards fewer stops.
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
      s.riskStopBias * (intent.risk - 0.5) * (mostStops - o.stops),
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
};

export type PitCallOption = { call: 'stay' | 'pit'; compound: Compound; timeS: number; stints: Stint[] };

export function pitCallOptions(ctx: PitCallContext): PitCallOption[] {
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
  const needAnother = !usedWet && drySet.size === 1 ? [...drySet][0]! : null;
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
    );
    if (stay)
      options.push({ call: 'stay', compound: ctx.current.compound, timeS: stay.timeS, stints: stay.stints });
  }
  for (const c of candidates) {
    const rest = bestCompletion(
      laps,
      { compound: c, cum: fresh(c) },
      fresh,
      pitGreen,
      { min: 0, max: maxStops - 1 },
      needAnother,
      candidates,
    );
    if (rest) options.push({ call: 'pit', compound: c, timeS: pitNow + rest.timeS, stints: rest.stints });
  }
  return options;
}

/** The strategist's call on the pit wall when something changes: stay out, or box for a compound. */
export const decidePitCall: Decide<readonly PitCallOption[], StrategyGoal, PitCallOption> = (
  options,
  competence,
  _intent,
  rng,
) => {
  const scale = balance.race.strategy.pitCallScoreScaleS;
  const best = Math.min(...options.map((o) => o.timeS));
  const evaluate = (o: PitCallOption): Evaluation => ({
    score: Math.max(0, 1 - (o.timeS - best) / scale),
    reasons: [o.call === 'stay' ? 'strategy.call.stay' : `strategy.call.pit.${o.compound}`],
  });
  return chooseByScore(options, evaluate, competence, rng);
};

export type { Decision };
