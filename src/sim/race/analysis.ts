/**
 * Race metrics for calibration (plan M2, docs/calibration/M2.md). Everything is measured from the
 * race output the way an analyst would — lap times, tyre ages, events — not read from the model's
 * internals, so the numbers test the model rather than restate it.
 */
import { balance } from '@/data/balance';
import type { Compound } from '@/data/schema/race-balance';
import type { LapRecord, RaceInput, RaceResult } from './types';

export type RaceMetrics = {
  winner: string;
  winnerTeam: string;
  overtakes: number;
  safetyCars: number;
  virtualSafetyCars: number;
  retirements: number;
  pitStops: number;
  wet: boolean;
  /** Fuel-corrected median green-flag lap per team (no lap 1, no pit in/out laps), seconds. */
  teamPaceS: Record<string, number>;
  /** (slowest team − fastest team) / fastest, from the fuel-corrected medians. */
  paceSpreadPct: number;
  /** Mean over drivers of their lap-to-lap scatter: robust sd (MAD) of consecutive clean-lap differences / √2. */
  lapScatterS: number;
  /** Mean degradation slope by compound, s/lap: Theil–Sen over fuel-corrected green laps of a stint (≥ 6). */
  degradationS: Partial<Record<Compound, number>>;
  winnerGapToP2S: number | null;
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

const fuelCorrected = (lap: LapRecord, baseLapTime: number) =>
  lap.lapTimeS - lap.fuelKg * balance.race.weightSPerKgPer90s * (baseLapTime / 90);

/** Theil–Sen slope of y over x: the median of pairwise slopes, robust to the odd outlying lap. */
function slope(xs: number[], ys: number[]): number {
  const slopes: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++)
      if (xs[j] !== xs[i]) slopes.push((ys[j]! - ys[i]!) / (xs[j]! - xs[i]!));
  }
  return slopes.length ? median(slopes) : 0;
}

/** Standard deviation estimated from the median absolute deviation (robust to outliers). */
const robustSd = (xs: number[]) => {
  const m = median(xs);
  return 1.4826 * median(xs.map((x) => Math.abs(x - m)));
};

export function raceMetrics(input: RaceInput, result: RaceResult): RaceMetrics {
  const base = input.track.baseLapTime;
  const count = (kind: string) => result.events.filter((e) => e.kind === kind).length;
  const teamOf = new Map(input.entries.map((e) => [e.driverId, e.teamId]));

  // Team pace: fuel-corrected green-flag laps of both cars together. Traffic is part of racing
  // pace, so laps are not filtered for clean air; the median keeps the odd slow lap out.
  const byTeam = new Map<string, number[]>();
  for (const [driverId, laps] of Object.entries(result.laps)) {
    const green = laps.filter(
      (l, i) => l.lap > 1 && l.status === 'green' && !l.pitted && !laps[i - 1]?.pitted,
    );
    const clean = green.map((l) => fuelCorrected(l, base));
    const team = teamOf.get(driverId)!;
    byTeam.set(team, [...(byTeam.get(team) ?? []), ...clean]);
  }
  const teamPaceS = Object.fromEntries(
    [...byTeam].filter(([, xs]) => xs.length >= 5).map(([t, xs]) => [t, median(xs)]),
  );
  const paces = Object.values(teamPaceS);
  const paceSpreadPct =
    paces.length > 1 ? ((Math.max(...paces) - Math.min(...paces)) / Math.min(...paces)) * 100 : 0;

  // Lap scatter: differences of consecutive clean laps cancel slow trends (fuel, tyres).
  const scatters: number[] = [];
  for (const laps of Object.values(result.laps)) {
    const diffs: number[] = [];
    for (let i = 1; i < laps.length; i++) {
      const [a, b] = [laps[i - 1]!, laps[i]!];
      if (a.cleanAir && b.cleanAir && a.compound === b.compound && b.tyreAge === a.tyreAge + 1)
        diffs.push(b.lapTimeS - a.lapTimeS);
    }
    if (diffs.length >= 5) scatters.push(robustSd(diffs) / Math.SQRT2);
  }

  // Degradation: slope of fuel-corrected laps over tyre age within one stint. Traffic laps count
  // (a car stuck in a train still wears its tyres); incident, neutralised and out-laps do not.
  const slopes: Partial<Record<Compound, number[]>> = {};
  for (const laps of Object.values(result.laps)) {
    let stint: LapRecord[] = [];
    const flush = () => {
      const clean = stint.filter(
        (l) => l.status === 'green' && !l.incident && !l.pitted && l.tyreAge > 0 && l.lap > 1,
      );
      if (clean.length >= 6) {
        const c = clean[0]!.compound;
        (slopes[c] ??= []).push(
          slope(
            clean.map((l) => l.tyreAge),
            clean.map((l) => fuelCorrected(l, base)),
          ),
        );
      }
      stint = [];
    };
    for (const lap of laps) {
      if (lap.pitted) {
        stint.push(lap);
        flush();
      } else stint.push(lap);
    }
    flush();
  }
  const degradationS = Object.fromEntries(
    Object.entries(slopes).map(([c, xs]) => [c, xs.reduce((a, b) => a + b, 0) / xs.length]),
  ) as Partial<Record<Compound, number>>;

  const [p1, p2] = result.classification;
  return {
    winner: p1?.driverId ?? '',
    winnerTeam: p1?.teamId ?? '',
    overtakes: count('overtake'),
    safetyCars: count('safety-car'),
    virtualSafetyCars: count('vsc'),
    retirements: result.classification.filter((c) => c.status === 'retired').length,
    pitStops: count('pit'),
    wet: result.conditions.some((c) => Math.max(...c.wetness) > 0.15),
    teamPaceS,
    paceSpreadPct,
    lapScatterS: scatters.length ? scatters.reduce((a, b) => a + b, 0) / scatters.length : NaN,
    degradationS,
    winnerGapToP2S: p2?.gapS ?? null,
  };
}
