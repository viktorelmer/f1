/**
 * Qualifying (plan 5.3, docs/systems/weekend.md): Q1, Q2, Q3, five cars out of each of the first two.
 *
 * What makes a qualifying lap is not pace but where you are when you drive it. The session runs on
 * the same segments as the race: cars move segment by segment, and a car on a flying lap that comes
 * up behind another inside the traffic window loses the time a flying lap cannot afford. That is why
 * the moment a team sends its car out is a decision and not a formality — and it goes through
 * `decide()`, so a delegate and a rival strategist use the same code (plan 5.19).
 *
 * The track rubbers in as the session runs (`trackEvolution`), so the last laps are the fastest; a
 * team that waits too long risks a yellow flag or the flag itself.
 */
import { balance } from '@/data/balance';
import { chooseByScore, type Decide, type Evaluation } from '../decide/decide';
import type { Rng } from '../rng/rng';
import { streams } from '../rng/rng';
import { carPaceFraction, driverPaceFraction, lapNoiseSd, massSeconds } from '../race/pace';
import { prepareTrack, type TrackModel } from '../race/track';
import { tyreLossS, warmupLossS } from '../race/tyres';
import type { RaceEntry, RaceInput } from '../race/types';
import { initialSurface, powerLossFraction, sampleAt, wetSlowdownFraction } from '../race/weather';
import type { DriverId, SessionKind, SessionResult, TeamId } from '../types/world';

/** Which part of qualifying: Q1 knocks five out, Q2 five more, Q3 decides the pole. */
export type QualifyingPart = 0 | 1 | 2;

/** One flying lap, with everything that shaped it — the feed and the screen read this. */
export type QualifyingLap = {
  part: QualifyingPart;
  driverId: DriverId;
  teamId: TeamId;
  /** When the lap started and ended, in seconds from the green light of that part. */
  startS: number;
  endS: number;
  timeS: number;
  /** Seconds lost to cars in the way; 0 on a clear lap. */
  trafficS: number;
};

export type QualifyingResult = {
  session: SessionResult;
  laps: QualifyingLap[];
  /** The order the grid is built from: pole first. */
  order: DriverId[];
  /** Who went out when, per part — what the delegate decided. */
  runs: { part: QualifyingPart; driverId: DriverId; outAtS: number }[];
};

export type QualifyingInput = {
  race: RaceInput;
  session: SessionKind;
  /** Seconds a lap each car is off its setup, from practice (docs/systems/weekend.md). */
  setupLossS: Record<DriverId, number>;
};

export type RunContext = {
  /** Seconds of the part still to come when the decision is taken. */
  partS: number;
  /** How much the track is still expected to improve, in seconds a lap. */
  evolutionGainS: number;
  /** A lap of this track, for turning seconds into laps. */
  lapS: number;
};

/** What a team wants out of the run: a safe time on the board, or the best one it can get. */
export type RunGoal = 'safe' | 'fastest';

export type RunChoice = { outAtS: number };

/**
 * When to send the car out. Going late is faster — the track rubbers in — but leaves no time for a
 * second attempt if the lap is spoiled, and risks the flag. `decide()` does the choosing, so a
 * nervous strategist goes early and a bold one waits.
 */
export const decideRunTime: Decide<RunContext, RunGoal, RunChoice> = (ctx, competence, intent, rng) => {
  const q = balance.weekend.qualifying;
  // Out-lap, flying lap and a margin: the latest a car can leave and still start its lap in time.
  const runS = ctx.lapS * (q.outLapFactor + 1) + q.pitExitS;
  const latest = Math.max(0, ctx.partS - runS);
  const options: RunChoice[] = q.runWindows.map((share) => ({ outAtS: latest * share }));
  const evaluate = (o: RunChoice): Evaluation => {
    const share = latest > 0 ? o.outAtS / latest : 1;
    // Later is faster; earlier leaves room for another go, which is worth more when playing safe.
    const gain = ctx.evolutionGainS * share;
    const room = Math.max(0, ctx.partS - o.outAtS - runS * 2) / Math.max(1, runS);
    const value = gain + (intent.goal === 'safe' ? q.safetyValueS : q.roomValueS) * Math.min(1, room);
    return {
      score: Math.max(0, Math.min(1, value / Math.max(1e-6, ctx.evolutionGainS + q.roomValueS))),
      reasons: [`qualifying.run.${Math.round(share * 100)}`],
    };
  };
  return chooseByScore(options, evaluate, competence, rng);
};

/** A car's clean flying-lap time at a given track state, before traffic. */
function flyingLapS(
  entry: RaceEntry,
  input: QualifyingInput,
  ctx: { grip: number; fuelKg: number; rng: Rng },
): number {
  const { race } = input;
  const sample = sampleAt(race.weather, 0);
  const surface = initialSurface(race.weather);
  const wet = Math.max(...surface.wetness);
  const base = race.track.baseLapTime;
  const driver = { ...entry.driver, pace: entry.driver.qualifying };
  const weatherFraction =
    powerLossFraction(sample, race.track.profile.powerSensitivity) + wetSlowdownFraction(wet);
  const green =
    race.track.profile.trackEvolution * balance.weather.evolution.maxGreenPenaltyFraction * (1 - ctx.grip);
  return (
    base *
      (1 + carPaceFraction(entry.car, race.track)) *
      (1 + driverPaceFraction(driver, wet)) *
      (1 + weatherFraction) *
      (1 + green) +
    tyreLossS('soft', 0, sample.trackTempC, wet) +
    warmupLossS('soft') +
    massSeconds(ctx.fuelKg + entry.car.weight, base) +
    (input.setupLossS[entry.driverId] ?? 0) +
    ctx.rng.normal(0, lapNoiseSd(entry.driver.consistency))
  );
}

/** Runs Q1, Q2 and Q3 and returns the order the grid is built from. */
export function runQualifying(input: QualifyingInput): QualifyingResult {
  const { race } = input;
  const q = balance.weekend.qualifying;
  const model = prepareTrack(race.track, race.geometry);
  const stream = streams(race.seed);
  const laps: QualifyingLap[] = [];
  const runs: QualifyingResult['runs'] = [];
  const lapS = race.track.baseLapTime;

  /** Everyone still in, best first at the end of each part. */
  let inPlay = race.entries.map((e) => e.driverId);
  /** Where each car ends up: knocked out in Q1 go to the back, then Q2, then the Q3 order. */
  const order: DriverId[] = [];
  /** The lap that settled each car's place: the one it set in the last part it took. */
  const best: Record<DriverId, number> = {};

  for (const part of [0, 1, 2] as QualifyingPart[]) {
    const partS = q.partMinutes[part] * 60;
    const entries = race.entries.filter((e) => inPlay.includes(e.driverId));
    const partLaps: QualifyingLap[] = [];

    for (const entry of entries) {
      const rng = stream(`race:${race.season}:r${race.round}:quali:${part}:${entry.driverId}`);
      const decision = decideRunTime(
        {
          partS,
          evolutionGainS: lapS * race.track.profile.trackEvolution * q.evolutionGainFraction,
          lapS,
        },
        entry.strategist,
        { goal: part === 2 ? 'fastest' : 'safe', risk: entry.riskAppetite, issuedBy: 'team-character' },
        rng,
      );
      // Inside the chosen window every car picks its own second: nobody queues at the pit exit.
      const outAtS = Math.max(
        0,
        Math.min(partS, decision.choice.outAtS + rng.range(-q.windowSpreadS / 2, q.windowSpreadS / 2)),
      );
      runs.push({ part, driverId: entry.driverId, outAtS });
      const startS = outAtS + q.pitExitS + lapS * q.outLapFactor;
      // The track is at its best at the end of the part: grip grows with the share of it gone.
      const grip = q.gripAtStart + (1 - q.gripAtStart) * Math.min(1, startS / Math.max(1, partS));
      const clean = flyingLapS(entry, input, { grip, fuelKg: q.fuelKg, rng });
      partLaps.push({
        part,
        driverId: entry.driverId,
        teamId: entry.teamId,
        startS,
        endS: startS + clean,
        timeS: clean,
        trafficS: 0,
      });
    }

    applyTraffic(partLaps, model, lapS);
    for (const lap of partLaps) {
      laps.push(lap);
      // The time that decides a place is the one set in the last part a car took: that is what a
      // timing screen shows, and what the grid is ordered by.
      best[lap.driverId] = lap.timeS;
    }

    const ranked = [...partLaps].sort((a, b) => a.timeS - b.timeS).map((l) => l.driverId);
    if (part === 2) {
      order.unshift(...ranked);
    } else {
      const through = ranked.slice(0, Math.max(0, ranked.length - q.knockedOut));
      order.unshift(...ranked.slice(through.length));
      inPlay = through;
    }
  }

  const byDriver = new Map(race.entries.map((e) => [e.driverId, e]));
  const classification: SessionResult['classification'] = order.map((driverId, i) => ({
    driverId,
    teamId: byDriver.get(driverId)!.teamId,
    position: i + 1,
    laps: laps.filter((l) => l.driverId === driverId).length,
    bestLapS: best[driverId] === undefined ? null : round3(best[driverId]),
    status: 'finished' as const,
    points: 0,
  }));

  return { session: { session: input.session, classification }, laps, order, runs };
}

/**
 * Traffic on a flying lap: a car that arrives at a segment right behind another loses time there.
 * Laps are laid out on the session clock, so two cars meet only if they are at the same place at the
 * same moment — which is exactly what a team is trying to avoid when it picks its moment.
 */
function applyTraffic(partLaps: QualifyingLap[], model: TrackModel, lapS: number): void {
  const q = balance.weekend.qualifying;
  const atSegment = (lap: QualifyingLap, bound: number) => lap.startS + lap.timeS * bound;
  const ordered = [...partLaps].sort((a, b) => a.startS - b.startS);
  for (const lap of ordered) {
    let lost = 0;
    for (const other of ordered) {
      if (other === lap) continue;
      for (const [k, shape] of model.segments.entries()) {
        const bound = model.bounds[k]!;
        const gap = atSegment(lap, bound) - atSegment(other, bound);
        // Only a car ahead, and only one close enough to be in the way.
        if (gap <= 0 || gap > q.trafficWindowS) continue;
        lost += q.trafficLossS * shape.share * (1 - gap / q.trafficWindowS);
      }
    }
    lap.trafficS = round3(Math.min(lost, lapS * q.maxTrafficShare));
    lap.timeS = round3(lap.timeS + lap.trafficS);
    lap.endS = round3(lap.startS + lap.timeS);
  }
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;
