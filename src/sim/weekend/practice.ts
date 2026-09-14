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
import type {
  DriverId,
  PracticePlan,
  PracticeRun,
  SessionKind,
  SessionResult,
  TeamId,
  TyreAllocation,
  WeekendKnowledge,
} from '../types/world';
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
import { noSets, takeSet } from './tyres';

export type { ProgrammeKind };

/**
 * A run and a session's queue of them live in the domain (`types/world.ts`): the weekend in
 * progress carries the plans the player has chosen, so they cannot be defined here.
 */
export type Run = PracticeRun;
export type { PracticePlan };

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
  /** Fresh sets each car has left of its entry; a run with no set to go out on is not run. */
  sets: Record<DriverId, TyreAllocation>;
  /** What the player changed mid-session, in session time. */
  commands?: readonly PracticeCommand[];
};

export type PracticeLap = {
  driverId: DriverId;
  lap: number;
  programme: ProgrammeKind;
  compound: Compound;
  timeS: number;
  fuelKg: number;
  wear: number;
  /** Seconds from the green light at which this lap was completed: the session on a clock. */
  atS: number;
};

/** One run as the session saw it: out of the garage at `outAtS`, back in at `endS`. */
export type PracticeRunRecord = {
  driverId: DriverId;
  /** The run's place in the car's queue as it actually ran. */
  index: number;
  programme: ProgrammeKind;
  compound: Compound;
  outAtS: number;
  endS: number;
  laps: number;
};

/**
 * What a car's remaining queue becomes, said at `atS` (docs/systems/weekend-play.md). It takes hold
 * at the first run the car has not started yet: a car already on track finishes its run first.
 */
export type PracticeCommand = {
  atS: number;
  driverId: DriverId;
  runs: readonly PracticeRun[];
};

export type PracticeResult = {
  session: SessionResult;
  laps: PracticeLap[];
  /** Minutes of track time each car used. */
  minutes: Record<DriverId, number>;
  /** What each team knew when the session began: the prior, or what earlier sessions taught it. */
  startedWith: Record<TeamId, WeekendKnowledge>;
  /** What each team knows after the session. */
  learned: Record<TeamId, WeekendKnowledge>;
  /** Every run of the session, so it can be played back on the clock. */
  runs: PracticeRunRecord[];
  /**
   * What each team knew as the session went: one entry per run that taught it something, in the
   * order the runs came back. The screen reads the estimates narrowing; the world keeps the last.
   */
  knowledgeAt: { atS: number; teamId: TeamId; knowledge: WeekendKnowledge }[];
  /** What each team now makes of everyone else's pace (plan 5.13). */
  rivals: Record<TeamId, Record<TeamId, Estimate>>;
  /** Who ran heavy to hide their hand this session. */
  hiding: TeamId[];
  /** Laps each car spent working on its setup: what narrows the engineer's reading (plan 5.2). */
  setupLaps: Record<DriverId, number>;
  /** What each car has left after the session, and the runs it could not go out on. */
  setsLeft: Record<DriverId, TyreAllocation>;
  skipped: { driverId: DriverId; programme: ProgrammeKind; compound: Compound }[];
};

/** The truth a weekend's practice is about: the track's tyres, and each car's fuel use. */
export function weekendTruth(race: RaceInput, entry: RaceEntry): WeekendTruth {
  return {
    tyreDegradation: race.track.profile.tyreDegFactor,
    fuelPerLapKg: fuelPerLap(race.track, entry.car.fuelEfficiency),
  };
}

/** A sensible session for a team that is not the player's, or a player who did not plan one. */
export function defaultPlan(entries: readonly { driverId: DriverId }[], session: SessionKind): PracticePlan {
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
  const setupLaps: Record<DriverId, number> = {};
  const setsLeft: Record<DriverId, TyreAllocation> = { ...input.sets };
  const skipped: PracticeResult['skipped'] = [];
  const runs: PracticeRunRecord[] = [];
  const knowledgeAt: PracticeResult['knowledgeAt'] = [];
  const best: { driverId: DriverId; teamId: TeamId; laps: number; bestLapS: number | null }[] = [];
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

  // What each team believes right now: the prior it arrived with, refined run by run as the
  // session goes. The screen watches these narrow; the world keeps what they are at the flag.
  const knowledge: Record<TeamId, WeekendKnowledge> = {};
  const truthOf: Record<TeamId, ReturnType<typeof weekendTruth>> = {};
  for (const teamId of [...new Set(race.entries.map((e) => e.teamId))]) {
    const entry = race.entries.find((e) => e.teamId === teamId)!;
    truthOf[teamId] = weekendTruth(race, entry);
    knowledge[teamId] =
      input.known[teamId] ??
      priorKnowledge(
        race.round,
        truthOf[teamId],
        input.at,
        stream(`race:${race.season}:r${race.round}:prior:${teamId}`),
      );
  }

  const startedWith = { ...knowledge };

  for (const entry of race.entries) {
    const rng = stream(`race:${race.season}:r${race.round}:${session}:${entry.driverId}`);
    const learnRng = stream(`race:${race.season}:r${race.round}:${session}:learn:${entry.teamId}`);
    /** The queue as it stands; a command from the pit wall replaces what is left of it. */
    let queue: readonly PracticeRun[] = input.plans[entry.driverId] ?? [];
    let next = 0;
    let applied = -1;
    let used = 0;
    let lapCount = 0;
    let bestLapS: number | null = null;
    let wear = 0;
    let compound: Compound = 'hard';

    // A programme that cannot be started is not started: the clock is the limit, not the laps.
    while (used < w.session.practiceMinutes) {
      // What the pit wall has said by now takes hold here — between runs, never mid-run.
      const said = (input.commands ?? []).findLastIndex(
        (c) => c.driverId === entry.driverId && c.atS <= used * 60,
      );
      if (said > applied) {
        applied = said;
        queue = input.commands![said]!.runs;
        next = 0;
        continue;
      }
      if (next >= queue.length) {
        // The queue is done and the car is parked. It goes out again only if the pit wall says so
        // while the hour still has time in it — then the garage waits until the word comes.
        const later = (input.commands ?? []).findIndex(
          (c, i) => i > applied && c.driverId === entry.driverId,
        );
        if (later < 0 || input.commands![later]!.atS >= w.session.practiceMinutes * 60) break;
        used = Math.max(used, input.commands![later]!.atS / 60);
        continue;
      }
      const run = queue[next]!;
      next++;
      const spec = w.programmes[run.programme]!;
      // Nor is one the car has no rubber for: the entry was declared before the weekend, and a
      // compound that is gone is gone (docs/systems/weekend-play.md).
      if (spec.fresh) {
        const left = takeSet(setsLeft[entry.driverId] ?? noSets(), run.compound);
        if (!left) {
          skipped.push({ driverId: entry.driverId, programme: run.programme, compound: run.compound });
          continue;
        }
        setsLeft[entry.driverId] = left;
      }
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
      const outAtS = round3(used * 60);
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
          atS: round3(used * 60),
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
      const endS = round3(used * 60);
      runs.push({
        driverId: entry.driverId,
        index: runs.filter((r) => r.driverId === entry.driverId).length,
        programme: run.programme,
        compound,
        outAtS,
        endS,
        laps: ran,
      });

      // The run comes back and the engineers read it. A long run is the only programme that shows
      // how the tyre goes off; fuel is read off any run. Running heavy to hide costs the team half
      // of what those laps would have taught it.
      const worth = hiding.has(entry.teamId) ? w.scouting.hidingLearningShare : 1;
      const learned = {
        degradationLaps: run.programme === 'long-run' ? ran * worth : 0,
        fuelLaps: run.programme === 'fuel-calibration' || run.programme === 'long-run' ? ran * worth : 0,
        // Setup work dials the car in; a qualifying simulation checks it and counts for half.
        setupLaps: run.programme === 'setup' ? ran : run.programme === 'qualifying-sim' ? ran / 2 : 0,
      };
      // Setup laps belong to the car, not to the team: the two engineers dial in separately.
      setupLaps[entry.driverId] = (setupLaps[entry.driverId] ?? 0) + learned.setupLaps;
      if (learned.degradationLaps + learned.fuelLaps + learned.setupLaps > 0) {
        knowledge[entry.teamId] = learnFromRunning(
          knowledge[entry.teamId]!,
          truthOf[entry.teamId]!,
          learned,
          input.dataAnalysis[entry.teamId] ?? balance.weekend.learning.departmentRef,
          input.at,
          learnRng,
        );
        knowledgeAt.push({ atS: endS, teamId: entry.teamId, knowledge: knowledge[entry.teamId]! });
      }
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
  // What the session leaves each team with: the last fold of the runs it brought back.
  const learned: Record<TeamId, WeekendKnowledge> = { ...knowledge };

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

  return {
    session: { session, classification },
    laps,
    minutes,
    startedWith,
    learned,
    rivals,
    hiding: [...hiding],
    setupLaps,
    setsLeft,
    skipped,
    runs,
    knowledgeAt,
  };
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
