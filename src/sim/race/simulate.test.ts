import { describe, expect, it } from 'vitest';
import { loadDefaultPack } from '@/data/packs/default';
import { createRng } from '../rng/rng';
import { fingerprint } from '../util/hash';
import { createWorld } from '../world/create-world';
import { raceMetrics } from './analysis';
import { buildRaceInput } from './build-input';
import { simulateRace } from './simulate';
import { isDry } from './tyres';
import type { RaceInput } from './types';
import { generateWeather } from './weather';

const pack = loadDefaultPack();
const world = createWorld('race-tests', pack, { mode: 'takeover', teamId: 'kestrel', principalName: 'Test' });
const roundOf = (trackId: string) => world.season.calendar.find((r) => r.trackId === trackId)!.round;
const input = (trackId: string, seed: string) => buildRaceInput(world, pack, roundOf(trackId), seed);

describe('buildRaceInput', () => {
  const race = input('al-rimal', 'build');

  it('enters every race driver with a grid that is a permutation of them', () => {
    expect(race.entries).toHaveLength(22);
    expect([...race.grid].sort()).toEqual(race.entries.map((e) => e.driverId).sort());
  });

  it('gives each car its team’s strategist and a pit crew', () => {
    for (const e of race.entries) {
      expect(e.strategist.skill).toBeGreaterThan(0);
      expect(e.pitCrew).toBeGreaterThan(40);
    }
  });

  it('rolls the same weather and grid for the same seed', () => {
    expect(fingerprint(input('al-rimal', 'build'))).toBe(fingerprint(race));
  });
});

describe('simulateRace', () => {
  it('is deterministic: same seed → byte-identical result (DoD)', () => {
    const a = simulateRace(input('al-rimal', 'M2-determinism'));
    const b = simulateRace(input('al-rimal', 'M2-determinism'));
    expect(fingerprint(b)).toBe(fingerprint(a));
    expect(fingerprint(a)).toBe('1621cd1d872429');
  });

  it('differs with a different seed', () => {
    const a = simulateRace(input('al-rimal', 'seed-a'));
    const b = simulateRace(input('al-rimal', 'seed-b'));
    expect(fingerprint(a.classification)).not.toBe(fingerprint(b.classification));
  });

  const race = input('lone-star', 'consistency');
  const result = simulateRace(race);

  it('classifies every car once, finishers first, with points for the top ten', () => {
    expect(result.classification.map((c) => c.position)).toEqual(Array.from({ length: 22 }, (_, i) => i + 1));
    expect(new Set(result.classification.map((c) => c.driverId)).size).toBe(22);
    const firstRetired = result.classification.findIndex((c) => c.status === 'retired');
    if (firstRetired >= 0)
      expect(result.classification.slice(firstRetired).every((c) => c.status === 'retired')).toBe(true);
    const winner = result.classification[0]!;
    expect(winner.laps).toBe(race.track.laps);
    expect(winner.points).toBe(25);
    expect(result.classification.reduce((s, c) => s + c.points, 0)).toBeLessThanOrEqual(101);
  });

  it('keeps the lap chart consistent: unique positions per lap, lap times adding up', () => {
    for (let lap = 1; lap <= race.track.laps; lap++) {
      const positions = Object.values(result.laps).flatMap((laps) =>
        laps.filter((l) => l.lap === lap).map((l) => l.position),
      );
      expect([...positions].sort((a, b) => a - b)).toEqual(positions.map((_, i) => i + 1));
    }
    for (const c of result.classification.filter((x) => x.status === 'finished')) {
      const laps = result.laps[c.driverId]!;
      const sum = laps.reduce((s, l) => s + l.lapTimeS, 0);
      expect(Math.abs(sum - c.totalTimeS)).toBeLessThan(2);
      for (const l of laps)
        expect(Math.abs(l.sectorsS.reduce((a, b) => a + b, 0) - l.lapTimeS)).toBeLessThan(0.01);
    }
  });

  it('reports each pit stop as an event and a stop in the classification', () => {
    const pits = result.events.filter((e) => e.kind === 'pit');
    expect(pits.length).toBe(result.classification.reduce((s, c) => s + c.stops, 0));
  });

  it('has every dry-race finisher use two dry compounds', () => {
    for (let i = 0; i < 10; i++) {
      const r = simulateRace(input('valles', `rule-${i}`));
      if (r.conditions.some((c) => Math.max(...c.wetness) > 0.05)) continue;
      for (const c of r.classification.filter((x) => x.status === 'finished')) {
        expect(new Set(c.compounds.filter(isDry)).size).toBeGreaterThan(1);
      }
    }
  });

  it('bunches the field behind the safety car', () => {
    for (let i = 0; i < 40; i++) {
      const r = simulateRace(input('marina-lights', `sc-${i}`));
      const sc = r.events.find((e) => e.kind === 'safety-car');
      const restart = r.events.find((e) => e.kind === 'safety-car-in' && e.timeS > (sc?.timeS ?? Infinity));
      if (!sc || !restart || sc.lap < 5) continue;
      const spread = (lap: number) => {
        const gaps = Object.values(r.laps).flatMap((laps) =>
          laps.filter((l) => l.lap === lap && l.position <= 10).map((l) => l.gapToLeaderS),
        );
        return Math.max(...gaps);
      };
      expect(spread(restart.lap)).toBeLessThan(spread(sc.lap - 1));
      return;
    }
    throw new Error('no usable safety car in 40 races');
  });

  it('puts the field on wet-weather tyres when heavy rain arrives', () => {
    const race: RaceInput = input('northfield', 'rain');
    const soaked = { ...race.track, weather: { ...race.track.weather, rainChance: 1 } };
    for (let i = 0; i < 200; i++) {
      const w = generateWeather(soaked, createRng(`rain-${i}`, 'weather'));
      const intensity = Math.max(...w.samples.map((s) => Math.max(...s.rain)));
      const start = w.samples.find((s) => s.rain.some((r) => r > 0))?.minute ?? 0;
      if (intensity > 0.7 && start > 15 && start < 45) {
        const r = simulateRace({ ...race, weather: w });
        const toWet = r.events.filter(
          (e) => e.kind === 'pit' && (e.detail.to === 'inter' || e.detail.to === 'wet'),
        );
        expect(new Set(toWet.map((e) => e.driverId)).size).toBeGreaterThan(15);
        return;
      }
    }
    throw new Error('no heavy rain in 200 seeds');
  });

  it('runs a full race headless well inside the 200 ms budget', () => {
    const race = input('al-rimal', 'perf');
    simulateRace(race);
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) simulateRace(race);
    expect((performance.now() - t0) / 5).toBeLessThan(200);
  });
});

describe('calibration guard (docs/calibration/M2.md)', () => {
  // A cheap re-check of the plan's targets on 40 races; the full report uses 1000.
  const metrics = Array.from({ length: 40 }, (_, i) => {
    const race = input('al-rimal', `guard-${i}`);
    return raceMetrics(race, simulateRace(race));
  }).filter((m) => !m.wet);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  it('keeps the field spread, lap scatter and soft degradation in the plan’s bands', () => {
    expect(mean(metrics.map((m) => m.paceSpreadPct))).toBeGreaterThan(2);
    expect(mean(metrics.map((m) => m.paceSpreadPct))).toBeLessThan(3.2);
    const scatter = mean(metrics.map((m) => m.lapScatterS).filter(Number.isFinite));
    expect(scatter).toBeGreaterThan(0.2);
    expect(scatter).toBeLessThan(0.4);
    const soft = mean(metrics.flatMap((m) => m.degradationS.soft ?? []));
    expect(soft).toBeGreaterThan(0.08);
    expect(soft).toBeLessThan(0.15);
  });

  it('keeps overtakes and retirements plausible for the track', () => {
    const overtakes = mean(metrics.map((m) => m.overtakes));
    expect(overtakes).toBeGreaterThan(35);
    expect(overtakes).toBeLessThan(90);
    expect(mean(metrics.map((m) => m.retirements))).toBeLessThan(3.5);
  });
});
