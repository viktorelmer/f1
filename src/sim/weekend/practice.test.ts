import { describe, expect, it } from 'vitest';
import { balance } from '@/data/balance';
import { isLocalPack, loadActivePack } from '@/data/packs/active';
import { buildRaceInput } from '../race/build-input';
import type { RaceInput } from '../race/types';
import type { TyreAllocation } from '../types/world';
import { simulateRace } from '../race/simulate';
import { createRng } from '../rng/rng';
import { fingerprint } from '../util/hash';
import { createWorld } from '../world/create-world';
import type { SessionKind } from '../types/world';
import { readingSd } from './knowledge';
import { defaultPlan, type PracticePlan, runPractice, weekendTruth } from './practice';
import { PRACTICE_SESSIONS, runPracticeSessions, weekendRaceInput } from '../season/weekend';
import { decideHiding, referencePaceS, rivalPrecision } from './scouting';

const pack = loadActivePack();
const TEAM = 'kestrel';
const world = createWorld('practice-tests', pack, {
  mode: 'takeover',
  teamId: TEAM,
  principalName: 'Test',
});
const roundOf = (trackId: string) => world.season.calendar.find((r) => r.trackId === trackId)!.round;
/** The player's two cars staying in the garage for a session: an empty queue each. */
const sitOut: PracticePlan = Object.fromEntries(world.teams[TEAM]!.drivers.race.map((id) => [id, []]));
const race = (track: string, seed: string) => buildRaceInput(world, pack, roundOf(track), seed);
const dataAnalysis = Object.fromEntries(Object.values(world.teams).map((t) => [t.id, 60]));
const known = Object.fromEntries(Object.keys(world.teams).map((id) => [id, null]));
const rivals = Object.fromEntries(Object.keys(world.teams).map((id) => [id, {}]));
const setupLossS: Record<string, number> = {};
/** A rack nobody can run out of: most of these tests are about learning, not about the entry. */
const plenty = (race: RaceInput): Record<string, TyreAllocation> =>
  Object.fromEntries(race.entries.map((e) => [e.driverId, { soft: 9, medium: 9, hard: 9 }]));

const session = (track: string, seed: string, plans?: PracticePlan, kind: SessionKind = 'fp2') => {
  const input = race(track, seed);
  return runPractice({
    race: input,
    session: kind,
    at: world.date,
    plans: plans ?? defaultPlan(input.entries, kind),
    dataAnalysis,
    known,
    rivals,
    setupLossS,
    sets: plenty(input),
  });
};

describe('a practice session', () => {
  it('fits in its hour: a queue that cannot be run is cut off, not squeezed in', () => {
    const input = race('al-rimal', 'fits');
    const greedy = Object.fromEntries(
      input.entries.map((e) => [
        e.driverId,
        Array.from({ length: 12 }, () => ({ programme: 'long-run' as const, compound: 'medium' as const })),
      ]),
    );
    const result = runPractice({
      race: input,
      session: 'fp2',
      at: world.date,
      plans: greedy,
      dataAnalysis,
      known,
      rivals,
      setupLossS,
      sets: plenty(input),
    });
    for (const minutes of Object.values(result.minutes)) {
      expect(minutes).toBeGreaterThan(balance.weekend.session.practiceMinutes * 0.8);
      // The last lap may finish just over the hour; nobody runs a whole extra programme.
      expect(minutes).toBeLessThan(balance.weekend.session.practiceMinutes * 1.1);
    }
  });

  it('gives every car that ran a best lap, and classifies by it', () => {
    const { session: result } = session('al-rimal', 'best-lap');
    expect(result.session).toBe('fp2');
    const times = result.classification.map((c) => c.bestLapS!);
    expect(times).toHaveLength(22);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    for (const car of result.classification) expect(car.laps).toBeGreaterThan(0);
  });

  it('leaves a car that sat the session out at the back, with no laps', () => {
    const input = race('al-rimal', 'sat-out');
    const [absent] = world.teams[TEAM]!.drivers.race;
    const plans = { ...defaultPlan(input.entries, 'fp2') };
    delete plans[absent];
    const result = runPractice({
      race: input,
      session: 'fp2',
      at: world.date,
      plans,
      dataAnalysis,
      known,
      rivals,
      setupLossS,
      sets: plenty(input),
    });
    const car = result.session.classification.find((c) => c.driverId === absent)!;
    expect(car.laps).toBe(0);
    expect(car.bestLapS).toBeNull();
    expect(car.status).toBe('dns');
    expect(car.position).toBe(22);
  });
});

describe('what practice teaches', () => {
  const teamTruth = () => {
    const input = race('al-rimal', 'truth');
    return weekendTruth(
      input,
      input.entries.find((e) => e.teamId === TEAM)!,
    );
  };

  it('narrows the degradation estimate with laps, and leaves the prior alone without them', () => {
    const prior = runPracticeSessions(world, pack, roundOf('al-rimal'), 'narrow', {
      fp1: sitOut,
      fp2: sitOut,
      fp3: sitOut,
    }).knowledge[TEAM]!.weekend!;
    const ran = runPracticeSessions(world, pack, roundOf('al-rimal'), 'narrow').knowledge[TEAM]!.weekend!;
    expect(prior.laps).toBe(0);
    expect(ran.laps).toBeGreaterThan(10);
    expect(ran.tyreDegradation.basis.sd).toBeLessThan(prior.tyreDegradation.basis.sd);
    expect(ran.fuelPerLapKg.basis.sd).toBeLessThan(prior.fuelPerLapKg.basis.sd);
    expect(prior.tyreDegradation.basis.sd).toBeCloseTo(balance.weekend.learning.priorDegradationSd, 9);
  });

  it('reads the same laps more tightly with a better data-analysis department', () => {
    const l = balance.weekend.learning;
    expect(readingSd(l.degradationSdBase, 14, 90)).toBeLessThan(readingSd(l.degradationSdBase, 14, 40));
    // More laps beat a better department: data nobody collected cannot be analysed.
    expect(readingSd(l.degradationSdBase, 40, 40)).toBeLessThan(readingSd(l.degradationSdBase, 10, 100));
  });

  it('is honest: the truth falls inside the interval about as often as the estimate claims', () => {
    const truth = teamTruth();
    let inside = 0;
    const runs = 60;
    for (let i = 0; i < runs; i++) {
      const after = runPracticeSessions(world, pack, roundOf('al-rimal'), `honest-${i}`).knowledge[TEAM]!
        .weekend!;
      if (
        truth.tyreDegradation >= after.tyreDegradation.low &&
        truth.tyreDegradation <= after.tyreDegradation.high
      )
        inside++;
    }
    // An 80% interval: too narrow and the team is lied to, too wide and the estimate says nothing.
    expect(inside / runs).toBeGreaterThan(0.6);
    expect(inside / runs).toBeLessThan(0.95);
  });

  it('keeps the truth out of what the team holds', () => {
    const truth = teamTruth();
    const after = runPracticeSessions(world, pack, roundOf('al-rimal'), 'no-leak').knowledge[TEAM]!.weekend!;
    expect(after.tyreDegradation.basis.mean).not.toBe(truth.tyreDegradation);
    expect(after.fuelPerLapKg.basis.mean).not.toBe(truth.fuelPerLapKg);
    expect(after.tyreDegradation.basis.sd).toBeGreaterThan(0);
  });

  it('runs one practice session on a sprint weekend and three on a normal one', () => {
    expect(PRACTICE_SESSIONS.sprint).toHaveLength(1);
    expect(PRACTICE_SESSIONS.standard).toHaveLength(3);
  });

  it.skipIf(isLocalPack)('pins a practice session for the default pack', () => {
    expect(fingerprint(session('al-rimal', 'M5-practice').session)).toBe('102e83967865f8');
  });

  it('is deterministic by stream', () => {
    const a = session('al-rimal', 'deterministic');
    const b = session('al-rimal', 'deterministic');
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(fingerprint(createRng('x', 'y').next())).toBe(fingerprint(createRng('x', 'y').next()));
  });
});

describe('M5 DoD: skipping practice costs the team on Sunday', () => {
  /** The same weekend, with and without the player's team running in practice. */
  const weekend = (track: string, seed: string, skip: boolean) => {
    // An empty queue is a car that stays in the garage; the rest of the field runs as it would.
    const plans = skip ? Object.fromEntries(PRACTICE_SESSIONS.standard.map((s) => [s, sitOut])) : {};
    return weekendRaceInput(world, pack, roundOf(track), seed, { plans });
  };

  it('leaves the strategist a prior and the car off its setup: a measurably worse Sunday', () => {
    const tracks = ['al-rimal', 'valles', 'northfield', 'huangpu'];
    const positions = { ran: [] as number[], skipped: [] as number[] };
    let widerBelief = 0;
    for (const track of tracks) {
      for (let i = 0; i < 15; i++) {
        const seed = `dod-practice-${i}`;
        for (const skip of [false, true]) {
          const { input, world: after } = weekend(track, seed, skip);
          const belief = after.knowledge[TEAM]!.weekend!;
          if (skip && belief.tyreDegradation.basis.sd > balance.weekend.learning.priorDegradationSd - 1e-9)
            widerBelief++;
          const result = simulateRace(input);
          const arm = skip ? 'skipped' : 'ran';
          positions[arm].push(
            ...result.classification.filter((c) => c.teamId === TEAM).map((c) => c.position),
          );
        }
      }
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    // Every skipped weekend leaves the team on the prior it arrived with, and off its setup.
    expect(widerBelief).toBe(tracks.length * 15);
    // Worth about a position over 120 car-results: the strategist plans on a prior, and the car
    // itself is a few tenths a lap away from where practice would have put it.
    expect(mean(positions.skipped) - mean(positions.ran)).toBeGreaterThan(0.5);
  }, 120_000);
});

describe('reading the opposition (plan 5.13)', () => {
  const weekendOf = (seed: string) => {
    const input = race('al-rimal', seed);
    const after = runPracticeSessions(world, pack, roundOf('al-rimal'), seed);
    return { input, after };
  };

  it('gives every team its own read on everyone else, and never on itself', () => {
    const { after } = weekendOf('rivals-1');
    for (const [teamId, knowledge] of Object.entries(after.knowledge)) {
      expect(knowledge.rivals[teamId]).toBeUndefined();
      expect(Object.keys(knowledge.rivals).length).toBe(Object.keys(world.teams).length - 1);
    }
    // Two teams watching the same Friday come away with different numbers.
    const [a, b] = Object.keys(after.knowledge) as [string, string];
    const target = Object.keys(after.knowledge).find((id) => id !== a && id !== b)!;
    expect(after.knowledge[a]!.rivals[target]!.value).not.toBe(after.knowledge[b]!.rivals[target]!.value);
  });

  it('narrows with the laps of a weekend and never holds the truth', () => {
    const { input, after } = weekendOf('rivals-2');
    const observer = 'kestrel';
    const target = Object.keys(world.teams).find((id) => id !== observer)!;
    const estimate = after.knowledge[observer]!.rivals[target]!;
    const entry = input.entries.find((e) => e.teamId === target)!;
    const truth = referencePaceS(input, entry, entry.setupLossS);
    expect(estimate.basis.sd).toBeGreaterThan(0);
    expect(estimate.basis.mean).not.toBe(truth);
    // Three sessions of watching are worth more than one.
    const oneSession = runPractice({
      race: input,
      session: 'fp1',
      at: world.date,
      plans: defaultPlan(input.entries, 'fp1'),
      dataAnalysis,
      known,
      rivals,
      setupLossS,
      sets: plenty(input),
    }).rivals[observer]![target]!;
    expect(estimate.basis.sd).toBeLessThan(oneSession.basis.sd);
  });

  it('reads a team that runs heavy as slower than it is', () => {
    const clean = rivalPrecision({ laps: 20, hiding: false }, 60);
    const hidden = rivalPrecision({ laps: 20, hiding: true }, 60);
    expect(clean.bias).toBe(0);
    expect(hidden.bias).toBeGreaterThan(0);
    // A better department reads the same laps tighter, and is less fooled.
    expect(rivalPrecision({ laps: 20, hiding: true }, 90).sd).toBeLessThan(hidden.sd);
    expect(rivalPrecision({ laps: 20, hiding: true }, 90).bias).toBeLessThan(hidden.bias);
  });

  it('hides more often for a team that likes a gamble, and never when told to show', () => {
    const profile = { skill: 0.7, consistency: 0.8, rapport: 0.5 };
    const hides = (risk: number, goal: 'hide' | 'show') => {
      let n = 0;
      for (let i = 0; i < 40; i++) {
        const choice = decideHiding(
          { risk },
          profile,
          { goal, risk, issuedBy: 'team-character' },
          createRng('hide', `${goal}-${risk}-${i}`),
        );
        if (choice.choice.hide) n++;
      }
      return n;
    };
    expect(hides(0.9, 'hide')).toBeGreaterThan(hides(0.1, 'hide'));
    expect(hides(0.9, 'show')).toBeLessThan(hides(0.9, 'hide'));
  });
});
