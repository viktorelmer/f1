/**
 * Reading the opposition (plan 5.13, docs/systems/scouting.md). Times in practice are not
 * information: everyone runs a different fuel load, a different engine mode and a different stage of
 * a programme. The data-analysis department corrects what it sees to something comparable, and gets
 * it wrong by a margin — so the player never sees "Rossa are 0.20 quicker", only an interval and a
 * word for how sure the team is.
 *
 * A team can also hide: run heavy on Friday and let everyone measure a lap that means nothing. That
 * is a `decide()` call with the team's character as the intent, so rivals do it without any code of
 * their own (plan 5.10).
 */
import { balance } from '@/data/balance';
import { chooseByScore, type Decide, type Evaluation } from '../decide/decide';
import { type Estimate, measure, observe, refine } from '../knowledge/estimate';
import type { Rng } from '../rng/rng';
import { carPaceFraction, driverPaceFraction, massSeconds } from '../race/pace';
import { prepareTrack } from '../race/track';
import { tyreLossS } from '../race/tyres';
import type { RaceEntry, RaceInput } from '../race/types';
import {
  greenTrackFraction,
  initialSurface,
  powerLossFraction,
  sampleAt,
  wetSlowdownFraction,
} from '../race/weather';
import type { GameDate } from '../types/game-date';
import type { TeamId } from '../types/world';

/**
 * How quick a team really is here: its best car on a light fuel load and a fresh soft, with the
 * setup it has found so far. This is the truth scouting is about, and nobody ever sees it.
 */
export function referencePaceS(race: RaceInput, entry: RaceEntry, setupLossS: number): number {
  const model = prepareTrack(race.track, race.geometry);
  const sample = sampleAt(race.weather, 0);
  const surface = initialSurface(race.weather);
  const wet = Math.max(...surface.wetness);
  const base = race.track.baseLapTime;
  const driver = { ...entry.driver, pace: entry.driver.qualifying };
  const weatherFraction =
    powerLossFraction(sample, race.track.profile.powerSensitivity) + wetSlowdownFraction(wet);
  return (
    base *
      (1 + carPaceFraction(entry.car, race.track)) *
      (1 + driverPaceFraction(driver, wet)) *
      (1 + weatherFraction) *
      (1 + greenTrackFraction(model, surface.grip)) +
    tyreLossS('soft', 0, sample.trackTempC, wet) +
    massSeconds(balance.weekend.qualifying.fuelKg + entry.car.weight, base) +
    setupLossS
  );
}

/** Hiding the car's pace costs laps of your own programme; showing it tells everyone where you are. */
export type HidingGoal = 'show' | 'hide';
export type HidingChoice = { hide: boolean };

export const decideHiding: Decide<{ risk: number }, HidingGoal, HidingChoice> = (
  ctx,
  competence,
  intent,
  rng,
) => {
  const s = balance.weekend.scouting;
  const options: HidingChoice[] = [{ hide: false }, { hide: true }];
  // A team told to show its hand shows it; otherwise its character decides, and a gambler hides
  // more often. The cost is its own data, which is why hiding never scores a clean 1.
  const appetite = intent.goal === 'show' ? 0 : s.hidingAppetite * ctx.risk;
  const evaluate = (o: HidingChoice): Evaluation => ({
    score: o.hide ? appetite : 1 - appetite,
    reasons: [o.hide ? 'scouting.hide' : 'scouting.show'],
  });
  return chooseByScore(options, evaluate, competence, rng);
};

export type RivalReading = {
  /** Laps of the rival the observer had to work with. */
  laps: number;
  /** True if the rival was running heavy to hide its pace. */
  hiding: boolean;
};

/**
 * How tightly a team reads a rival: the more laps it has of them and the better its data-analysis
 * department, the narrower. A rival that is hiding is read as slower than it is — the bias is real,
 * because the observer measured a real lap that meant nothing.
 */
export function rivalPrecision(reading: RivalReading, department: number): { sd: number; bias: number } {
  const s = balance.weekend.scouting;
  const quality = Math.max(s.minSdFactor, 1 - s.sdPerDepartmentPoint * (department - s.departmentRef));
  // Laps saturate: watching the same car go round in the same trim all afternoon adds nothing.
  const laps = Math.min(Math.max(1, reading.laps), s.effectiveLapsCap);
  return {
    sd: (s.sdBaseS / Math.sqrt(laps)) * quality,
    bias: reading.hiding ? s.hidingBiasS * quality : 0,
  };
}

/**
 * Folds a session's observations into what a team believes about everyone else. Each rival is one
 * measurement per session: the observer's own error, its own stream — two teams watching the same
 * laps come away with different numbers.
 */
export function readRivals(
  prior: Record<TeamId, Estimate> | undefined,
  truth: Record<TeamId, number>,
  readings: Record<TeamId, RivalReading>,
  department: number,
  at: GameDate,
  rng: Rng,
): Record<TeamId, Estimate> {
  const quantity = balance.estimate.quantities['team.pace'];
  const rivals: Record<TeamId, Estimate> = { ...prior };
  for (const [teamId, pace] of Object.entries(truth)) {
    const reading = readings[teamId];
    if (!reading || reading.laps === 0) continue;
    const precision = rivalPrecision(reading, department);
    const known = rivals[teamId];
    rivals[teamId] = known
      ? refine(known, measure(pace, precision, rng, at))
      : observe(pace, precision, rng, { quantity, at, sources: ['data-analysis', 'practice'] });
  }
  return rivals;
}
