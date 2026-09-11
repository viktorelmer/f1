/**
 * Free practice (plan 5.3, docs/systems/weekend.md). A session is a queue of run programmes per car,
 * and the thing it produces is not a lap time but information: how hard this track is on tyres and
 * how much fuel the car burns here, as `Estimate`s the strategist will plan on.
 *
 * The clock is what runs out, not the laps: 60 minutes, and out-laps, in-laps and time in the garage
 * eat it. A programme that does not fit is not run.
 *
 * Traffic is not modelled here — a practice lap is a lap on an empty track, and a car that catches
 * another simply backs off and tries again. Qualifying is where traffic decides, and it runs on the
 * race engine (docs/systems/weekend.md).
 */
import { balance } from '@/data/balance';
import type { ProgrammeKind } from '@/data/schema/weekend-balance';
import type { Rng } from '../rng/rng';
import { streams } from '../rng/rng';
import type { GameDate } from '../types/game-date';
import type { Estimate } from '../knowledge/estimate';
import type { DriverId, SessionKind, SessionResult, TeamId, WeekendKnowledge } from '../types/world';
import { carPaceFraction, driverPaceFraction, fuelPerLap, lapNoiseSd, massSeconds } from '../race/pace';
import { prepareTrack } from '../race/track';
import { tyreLossS, warmupLossS, wearPerLap } from '../race/tyres';
import type { Compound, RaceEntry, RaceInput } from '../race/types';
import {
  greenTrackFraction,
  initialSurface,
  powerLossFraction,
  sampleAt,
  wetSlowdownFraction,
} from '../race/weather';
import { learnFromRunning, priorKnowledge, type WeekendTruth } from './knowledge';
import { decideHiding, readRivals, referencePaceS, type RivalReading } from './scouting';

export type { ProgrammeKind };

/** One run: a programme and the tyre it goes out on. */
export type Run = { programme: ProgrammeKind; compound: Compound };

/** What a team is doing in this session, per car. Missing means the car does not run. */
export type PracticePlan = Record<DriverId, readonly Run[]>;

export type PracticeInput = {
  /** The race this practice belongs to: the same input the race is built from. */
  race: RaceInput;
  session: SessionKind;
  at: GameDate;
  /** What every team runs. A team not in the map sits the session out. */
  plans: PracticePlan;
  /** Each team's data-analysis department, 0..100. */
  dataAnalysis: Record<TeamId, number>;
  /** What each team knew before the session; a team without an entry starts from the prior. */
  known: Record<TeamId, WeekendKnowledge | null>;
  /** What each team made of its rivals before the session. */
  rivals: Record<TeamId, Record<TeamId, Estimate>>;
  /** Seconds a lap each car is off its setup, from the sessions already run. */
  setupLossS: Record<DriverId, number>;
};

export type PracticeLap = {
  driverId: DriverId;
  lap: number;
  programme: ProgrammeKind;
  compound: Compound;
  timeS: number;
  fuelKg: number;
  wear: number;
};

export type PracticeResult = {
  session: SessionResult;
  laps: PracticeLap[];
  /** Minutes of track time each car used. */
  minutes: Record<DriverId, number>;
  /** What each team knows after the session. */
  learned: Record<TeamId, WeekendKnowledge>;
  /** What each team now makes of everyone else's pace (plan 5.13). */
  rivals: Record<TeamId, Record<TeamId, Estimate>>;
  /** Who ran heavy to hide their hand this session. */
  hiding: TeamId[];
};

/** The truth a weekend's practice is about: the track's tyres, and each car's fuel use. */
export function weekendTruth(race: RaceInput, entry: RaceEntry): WeekendTruth {
  return {
    tyreDegradation: race.track.profile.tyreDegFactor,
    fuelPerLapKg: fuelPerLap(race.track, entry.car.fuelEfficiency),
  };
}

/** A sensible session for a team that is not the player's, or a player who did not plan one. */
export function defaultPlan(entries: readonly RaceEntry[], session: SessionKind): PracticePlan {
  const runs: readonly Run[] =
    session === 'fp1'
      ? [
          { programme: 'setup', compound: 'hard' },
          { programme: 'fuel-calibration', compound: 'hard' },
        ]
      : session === 'fp2'
        ? [
            { programme: 'qualifying-sim', compound: 'soft' },
            { programme: 'long-run', compound: 'medium' },
          ]
        : [
            { programme: 'setup', compound: 'medium' },
            { programme: 'qualifying-sim', compound: 'soft' },
          ];
  return Object.fromEntries(entries.map((e) => [e.driverId, runs]));
}

export function runPractice(input: PracticeInput): PracticeResult {
  const { race, session } = input;
  const w = balance.weekend;
  const model = prepareTrack(race.track, race.geometry);
  const surface = initialSurface(race.weather);
  const stream = streams(race.seed);
  const laps: PracticeLap[] = [];
  const minutes: Record<DriverId, number> = {};
  const best: { driverId: DriverId; teamId: TeamId; laps: number; bestLapS: number | null }[] = [];
  /** Laps that bear on each quantity, per team. */
  const learnedLaps: Record<TeamId, { degradationLaps: number; fuelLaps: number; setupLaps: number }> = {};

  // Friday is also reconnaissance: a team may run heavy to keep its hand hidden (plan 5.13).
  const hiding = new Set<TeamId>();
  for (const teamId of [...new Set(race.entries.map((e) => e.teamId))]) {
    const entry = race.entries.find((e) => e.teamId === teamId)!;
    const decision = decideHiding(
      { risk: entry.riskAppetite },
      entry.strategist,
      { goal: 'hide', risk: entry.riskAppetite, issuedBy: 'team-character' },
      stream(`race:${race.season}:r${race.round}:${session}:hiding:${teamId}`),
    );
    if (decision.choice.hide) hiding.add(teamId);
  }

  for (const entry of race.entries) {
    const plan = input.plans[entry.driverId] ?? [];
    const rng = stream(`race:${race.season}:r${race.round}:${session}:${entry.driverId}`);
    let used = 0;
    let lapCount = 0;
    let bestLapS: number | null = null;
    let wear = 0;
    let compound: Compound = 'hard';
    const learn = (learnedLaps[entry.teamId] ??= { degradationLaps: 0, fuelLaps: 0, setupLaps: 0 });

    for (const run of plan) {
      // A programme that cannot be started is not started: the clock is the limit, not the laps.
      if (used >= w.session.practiceMinutes) break;
      const spec = w.programmes[run.programme]!;
      const fuelKg =
        (run.programme === 'long-run'
          ? w.fuel.longRunKg
          : run.programme === 'qualifying-sim'
            ? w.fuel.qualifyingKg
            : w.fuel.defaultKg) + (hiding.has(entry.teamId) ? w.scouting.hidingFuelKg : 0);
      used += w.session.boxMinutes;
      if (spec.fresh) {
        wear = 0;
        compound = run.compound;
      }
      // Out-lap and in-lap cost time and no information.
      used += ((w.session.outLapShare + w.session.inLapShare) * race.track.baseLapTime) / 60;
      let ran = 0;
      for (let i = 0; i < spec.laps; i++) {
        if (used >= w.session.practiceMinutes) break;
        const burned = fuelKg - i * fuelPerLap(race.track, entry.car.fuelEfficiency);
        const timeS = practiceLapS(input, entry, model, {
          compound,
          wear,
          fuelKg: Math.max(0, burned),
          fresh: spec.fresh && i === 0,
          rng,
        });
        used += timeS / 60;
        lapCount++;
        ran++;
        laps.push({
          driverId: entry.driverId,
          lap: lapCount,
          programme: run.programme,
          compound,
          timeS,
          fuelKg: Math.max(0, burned),
          wear,
        });
        if (bestLapS === null || timeS < bestLapS) bestLapS = timeS;
        wear = Math.min(
          1,
          wear +
            wearPerLap(compound, {
              trackDegFactor: race.track.profile.tyreDegFactor,
              carTyreManagement: entry.car.tyreManagement,
              driverTyreManagement: entry.driver.tyreManagement,
              fuelKg: Math.max(0, burned),
              trackTempC: sampleAt(race.weather, 0).trackTempC,
              wetness: Math.max(...surface.wetness),
            }),
        );
      }
      // A long run is the only programme that shows how the tyre goes off; fuel is read off any run.
      // Running heavy to hide costs the team half of what those laps would have taught it.
      const worth = hiding.has(entry.teamId) ? w.scouting.hidingLearningShare : 1;
      if (run.programme === 'long-run') learn.degradationLaps += ran * worth;
      if (run.programme === 'fuel-calibration' || run.programme === 'long-run') learn.fuelLaps += ran * worth;
      // Setup work dials the car in; a qualifying simulation checks it and counts for half.
      if (run.programme === 'setup') learn.setupLaps += ran;
      if (run.programme === 'qualifying-sim') learn.setupLaps += ran / 2;
    }

    minutes[entry.driverId] = round3(used);
    best.push({ driverId: entry.driverId, teamId: entry.teamId, laps: lapCount, bestLapS });
  }

  const classification: SessionResult['classification'] = [...best]
    .sort((a, b) => (a.bestLapS ?? Infinity) - (b.bestLapS ?? Infinity))
    .map((c, i) => ({
      driverId: c.driverId,
      teamId: c.teamId,
      position: i + 1,
      laps: c.laps,
      bestLapS: c.bestLapS === null ? null : round3(c.bestLapS),
      status: c.laps > 0 ? 'finished' : 'dns',
      points: 0,
    }));

  const teams = [...new Set(race.entries.map((e) => e.teamId))];
  const learned: Record<TeamId, WeekendKnowledge> = {};
  for (const teamId of teams) {
    const entry = race.entries.find((e) => e.teamId === teamId)!;
    const truth = weekendTruth(race, entry);
    const rng = stream(`race:${race.season}:r${race.round}:${session}:learn:${teamId}`);
    const prior =
      input.known[teamId] ??
      priorKnowledge(
        race.round,
        truth,
        input.at,
        stream(`race:${race.season}:r${race.round}:prior:${teamId}`),
      );
    learned[teamId] = learnFromRunning(
      prior,
      truth,
      {
        ...(learnedLaps[teamId] ?? { degradationLaps: 0, fuelLaps: 0, setupLaps: 0 }),
        engineerSkill: 1 + entry.raceEngineer.skill * 99,
      },
      input.dataAnalysis[teamId] ?? balance.weekend.learning.departmentRef,
      input.at,
      rng,
    );
  }

  // What everyone made of everyone else. The truth is each team's reference pace here; a team
  // hiding is read slower than it is, and every observer has its own error and its own stream.
  const truth: Record<TeamId, number> = {};
  const readings: Record<TeamId, RivalReading> = {};
  for (const teamId of teams) {
    const entry = race.entries.find((e) => e.teamId === teamId)!;
    truth[teamId] = referencePaceS(race, entry, input.setupLossS[entry.driverId] ?? 0);
    readings[teamId] = {
      laps: laps.filter((l) => race.entries.find((e) => e.driverId === l.driverId)?.teamId === teamId).length,
      hiding: hiding.has(teamId),
    };
  }
  const rivals: Record<TeamId, Record<TeamId, Estimate>> = {};
  for (const teamId of teams) {
    const seen = Object.fromEntries(Object.entries(readings).filter(([id]) => id !== teamId));
    rivals[teamId] = readRivals(
      input.rivals[teamId],
      Object.fromEntries(Object.entries(truth).filter(([id]) => id !== teamId)),
      seen,
      input.dataAnalysis[teamId] ?? balance.weekend.scouting.departmentRef,
      input.at,
      stream(`race:${race.season}:r${race.round}:${session}:scouting:${teamId}`),
    );
  }

  return { session: { session, classification }, laps, minutes, learned, rivals, hiding: [...hiding] };
}

/** One practice lap on an empty track: the race's own lap-time terms, without traffic or segments. */
function practiceLapS(
  input: PracticeInput,
  entry: RaceEntry,
  model: ReturnType<typeof prepareTrack>,
  ctx: { compound: Compound; wear: number; fuelKg: number; fresh: boolean; rng: Rng },
): number {
  const { race } = input;
  const sample = sampleAt(race.weather, 0);
  const surface = initialSurface(race.weather);
  const wet = Math.max(...surface.wetness);
  const base = race.track.baseLapTime;
  const weatherFraction =
    powerLossFraction(sample, race.track.profile.powerSensitivity) + wetSlowdownFraction(wet);
  const lapTime =
    base *
    (1 + carPaceFraction(entry.car, race.track)) *
    (1 + driverPaceFraction(entry.driver, wet)) *
    (1 + weatherFraction) *
    (1 + greenTrackFraction(model, surface.grip));
  return (
    lapTime +
    tyreLossS(ctx.compound, ctx.wear, sample.trackTempC, wet) +
    massSeconds(ctx.fuelKg + entry.car.weight, base) +
    (ctx.fresh ? warmupLossS(ctx.compound) : 0) +
    ctx.rng.normal(0, lapNoiseSd(entry.driver.consistency))
  );
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;
