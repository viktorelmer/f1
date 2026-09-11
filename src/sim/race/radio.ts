/**
 * Race radio (plan 5.4, docs/systems/race-control.md): pace, ERS and aggression for each car, and
 * the race engineer's call on them through decide(). The player's engineer and a rival's are the
 * same code with different profiles; in manual mode the player sets the radio instead.
 */
import { balance } from '@/data/balance';
import type { Compound } from '@/data/schema/race-balance';
import { chooseByScore, type Decide, type Evaluation } from '../decide/decide';
import { cumulativeTyreLoss, type StintModel } from './strategy';
import type { Aggression, ErsMode, PaceMode, RadioSettings } from './types';

export const NEUTRAL_RADIO: RadioSettings = { pace: 'neutral', ers: 'balanced', aggression: 'normal' };

/** How hard a team character races: calm, normal or aggressive from its appetite for risk. */
export function aggressionFromRisk(risk: number): Aggression {
  const [calm, aggressive] = balance.race.radio.riskToAggression;
  return risk < calm ? 'calm' : risk > aggressive ? 'aggressive' : 'normal';
}

export const paceEffects = (pace: PaceMode) => balance.race.radio.pace[pace];
export const ersEffects = (ers: ErsMode) => balance.race.radio.ers[ers];
export const aggressionEffects = (aggression: Aggression) => balance.race.radio.aggression[aggression];

/** The instruction for the radio: what to save by default. */
export type RadioGoal = 'none' | 'tyres' | 'fuel';

export type RadioContext = {
  /** Laps left on these tyres before the planned stop, or to the flag. */
  stintLapsLeft: number;
  compound: Compound;
  wear: number;
  model: StintModel;
  /** Seconds to the car ahead and behind on the same lap at the line; Infinity when nobody is near. */
  gapAheadS: number;
  gapBehindS: number;
  battery: number;
  aggression: Aggression;
  /** Under a safety car or a VSC: the queue sets the pace, so there is nothing to push for. */
  neutralised: boolean;
};

/** Pace options the engineer weighs: lift-and-coast is forced by fuel, not chosen for speed. */
const PACE_OPTIONS: readonly PaceMode[] = ['push', 'neutral', 'save-tyres'];
/** Behind a safety car nobody pushes: the car holds station or looks after its tyres. */
const NEUTRALISED_PACE: readonly PaceMode[] = ['neutral', 'save-tyres'];

/**
 * The engineer's call for the next lap. Pace is chosen through decide(): the time the rest of the
 * stint takes in each mode — lap-time delta plus tyre loss at that mode's wear rate — so pushing
 * pays on a short stint and saving near the cliff of a long one; in a fight the car pushes. ERS
 * follows the situation, aggression the instruction or the team character. Under a neutralisation
 * there is no fight and no pushing: the field is bunched behind the queue, and the car harvests.
 */
export const decideRadio: Decide<RadioContext, RadioGoal, RadioSettings> = (ctx, competence, intent, rng) => {
  const r = balance.race.radio;
  const laps = Math.max(1, ctx.stintLapsLeft);
  const inBattle = !ctx.neutralised && (ctx.gapAheadS < r.battleGapS || ctx.gapBehindS < r.battleGapS);
  const paceOptions = ctx.neutralised ? NEUTRALISED_PACE : PACE_OPTIONS;
  const stintS = (pace: PaceMode) => {
    const e = paceEffects(pace);
    return laps * e.lapS + cumulativeTyreLoss(ctx.compound, ctx.wear, laps, ctx.model, false, e.wear)[laps]!;
  };
  const times = new Map(paceOptions.map((p) => [p, stintS(p)]));
  const best = Math.min(...times.values());
  const ers: ErsMode = ctx.neutralised
    ? ctx.battery < 1
      ? 'harvest'
      : 'balanced'
    : ctx.battery < r.lowBattery && !inBattle
      ? 'harvest'
      : ctx.gapAheadS < r.battleGapS && ctx.battery >= r.lowBattery
        ? 'attack'
        : 'balanced';
  const options = paceOptions.map((pace): RadioSettings => ({ pace, ers, aggression: ctx.aggression }));
  const evaluate = (o: RadioSettings): Evaluation => ({
    score:
      Math.max(0, 1 - (times.get(o.pace)! - best) / r.engineerScoreScaleS) +
      (inBattle && o.pace === 'push' ? r.battlePushBias : 0) +
      (intent.goal === 'tyres' && o.pace === 'save-tyres' ? r.savingGoalBias : 0),
    reasons: [`radio.pace.${o.pace}`, ...(inBattle ? ['radio.battle'] : [])],
  });
  return chooseByScore(options, evaluate, competence, rng);
};
