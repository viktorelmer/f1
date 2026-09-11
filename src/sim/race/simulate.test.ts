import { describe, expect, it } from 'vitest';
import { balance } from '@/data/balance';
import { isLocalPack, loadActivePack } from '@/data/packs/active';
import { createRng } from '../rng/rng';
import { fingerprint } from '../util/hash';
import { createWorld } from '../world/create-world';
import { raceMetrics } from './analysis';
import { buildRaceInput } from './build-input';
import { buildReplay } from './replay';
import { simulateRace } from './simulate';
import { isDry } from './tyres';
import type { RaceInput } from './types';
import { generateWeather } from './weather';

const pack = loadActivePack();
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
    // Pinned for the default pack only: a local pack has other content and so other hashes.
    if (!isLocalPack) expect(fingerprint(a)).toBe('062de43e2f1d8a');
  });

  it('pins a race with a safety car too', () => {
    const race = simulateRace(input('marina-lights', 'M3-flag'));
    expect(race.events.some((e) => e.kind === 'safety-car')).toBe(true);
    if (!isLocalPack) expect(fingerprint(race)).toBe('0d61a7939d82b1');
  });

  it('shows a flag to a car only once it is out: no call "under the safety car" before it', () => {
    let calls = 0;
    for (const track of ['marina-lights', 'porto-rocca', 'al-rimal']) {
      for (let i = 0; i < 10; i++) {
        let neutralised = false;
        for (const e of [...simulateRace(input(track, `flag-${i}`)).events].sort(
          (a, b) => a.timeS - b.timeS,
        )) {
          if (e.kind === 'safety-car' || e.kind === 'vsc') neutralised = true;
          if (e.kind === 'safety-car-in' || e.kind === 'vsc-end') neutralised = false;
          if (e.kind === 'strategy-call' && e.detail.trigger === 'safety-car') {
            calls++;
            if (!neutralised)
              expect.fail(`${track} flag-${i}: ${e.driverId} called in at ${e.timeS} s before the flag`);
          }
        }
      }
    }
    expect(calls).toBeGreaterThan(20);
  });

  it('records the plan as it changes: from the start, after every stop, to the flag', () => {
    const raceInput = input('marina-lights', 'M3-flag');
    const race = simulateRace(raceInput);
    for (const [driverId, history] of Object.entries(race.planHistory)) {
      expect(history[0]!.timeS).toBe(0);
      expect(history[0]!.stints).toEqual(
        race.plans[driverId]!.stints.reduce<{ compound: string; fromLap: number; toLap: number }[]>(
          (acc, st) => {
            const fromLap = (acc.at(-1)?.toLap ?? 0) + 1;
            return [...acc, { compound: st.compound, fromLap, toLap: fromLap + st.laps - 1 }];
          },
          [],
        ),
      );
      for (const revision of history) {
        revision.stints.forEach((st, i) => {
          if (i > 0) expect(st.fromLap).toBe(revision.stints[i - 1]!.toLap + 1);
        });
        expect(revision.stints.at(-1)!.toLap).toBe(raceInput.track.laps);
      }
      const stops = race.events.filter((e) => e.kind === 'pit' && e.driverId === driverId).length;
      expect(history.length).toBeGreaterThanOrEqual(1 + stops);
    }
  });

  it('takes the car ahead from the road, not from the car behind: a leader alone laps in clean air', () => {
    // Regression: the car ahead at a sector's entry was once taken from list order, which also holds
    // cars behind — nearly every car then had dirty air and DRS in every sector, the leader included.
    let leaderLaps = 0;
    let cleanLeaderLaps = 0;
    for (let i = 0; i < 5; i++) {
      const race = simulateRace(input('al-rimal', `clean-${i}`));
      const winner = race.classification[0]!.driverId;
      for (const l of race.laps[winner]!) {
        const second = Object.values(race.laps).find((laps) => laps[l.lap - 1]?.position === 2)?.[l.lap - 1];
        if (
          l.position !== 1 ||
          !second ||
          second.gapToLeaderS < 3 ||
          l.pitted ||
          l.lap < 3 ||
          l.status !== 'green'
        )
          continue;
        leaderLaps++;
        if (l.cleanAir) cleanLeaderLaps++;
      }
    }
    expect(leaderLaps).toBeGreaterThan(50);
    // Backmarkers still cost a leader clean laps; with the bug the share was 0.
    expect(cleanLeaderLaps / leaderLaps).toBeGreaterThan(0.5);
  });

  it('decides on a damage once, not again every lap it is carried', () => {
    let calls = 0;
    for (let i = 0; i < 20; i++) {
      const race = simulateRace(input('valles', `damage-${i}`));
      for (const driverId of Object.keys(race.laps)) {
        const damageCalls = race.events.filter(
          (e) => e.kind === 'strategy-call' && e.driverId === driverId && e.detail.trigger === 'damage',
        ).length;
        const contacts = race.events.filter(
          (e) => e.kind === 'contact' && (e.driverId === driverId || e.otherId === driverId),
        ).length;
        calls += damageCalls;
        expect(damageCalls).toBeLessThanOrEqual(contacts);
      }
    }
    expect(calls).toBeGreaterThan(0);
  });

  it('reports a repelled attack in the feed once per duel', () => {
    let defences = 0;
    for (let i = 0; i < 10; i++) {
      const lastLap = new Map<string, number>();
      for (const e of simulateRace(input('valles', `duel-${i}`)).events) {
        if (e.kind !== 'defence') continue;
        defences++;
        const duel = `${e.otherId}>${e.driverId}`;
        const last = lastLap.get(duel);
        if (last !== undefined)
          expect(e.lap - last).toBeGreaterThanOrEqual(balance.race.overtaking.defenceReportLaps);
        lastLap.set(duel, e.lap);
      }
    }
    expect(defences).toBeGreaterThan(0);
  });

  it('lets a car crawling to the pits with a puncture be driven around, not queued behind', () => {
    // Regression: a contact puncture added its 20 s after the pass attempt, and the cars behind
    // queued at the minimum gap for the whole sector (valles, seed d9e73675, lap 3).
    let punctures = 0;
    for (let i = 0; i < 40; i++) {
      const race = simulateRace(input('valles', `crawl-${i}`));
      const neutralLaps = new Set(
        race.events
          .filter((e) => ['safety-car', 'safety-car-in', 'vsc', 'vsc-end'].includes(e.kind))
          .flatMap((e) => [e.lap - 1, e.lap, e.lap + 1]),
      );
      punctures += race.events.filter(
        (e) => e.kind === 'strategy-call' && e.detail.trigger === 'puncture',
      ).length;
      for (const [driverId, laps] of Object.entries(race.laps)) {
        const median = [0, 1, 2].map((k) => {
          const xs = laps.map((l) => l.sectorsS[k]!).sort((a, b) => a - b);
          return xs[Math.floor(xs.length / 2)]!;
        });
        for (const l of laps) {
          if (l.lap < 2 || l.incident || l.pitted || l.status !== 'green' || neutralLaps.has(l.lap)) continue;
          l.sectorsS.forEach((sector, k) => {
            if (sector > median[k]! * 1.4) expect.fail(`${driverId} lap ${l.lap} S${k + 1}: ${sector} s`);
          });
        }
      }
    }
    expect(punctures).toBeGreaterThan(0);
  });

  it('explains every change of places between timing lines with an event', () => {
    // Regression: a defender pushed back behind its attacker was passed silently by the next car,
    // and a car much faster than two in front jumped both with one pass (monza, seed 2a0432ec).
    const explains = new Set(['pit', 'spin', 'puncture', 'retirement', 'crash', 'contact', 'failure']);
    let silent = 0;
    let races = 0;
    for (const track of ['parco-reale', 'al-rimal']) {
      for (let i = 0; i < 10; i++) {
        const raceInput = input(track, `swaps-${i}`);
        const result = simulateRace(raceInput);
        const { cars } = buildReplay(raceInput, result);
        races++;
        const segments = Math.max(...cars.map((c) => c.ends.length));
        for (let k = 1; k < segments; k++) {
          const among = cars.filter((c) => c.ends.length > k && c.pitS[k] === 0 && c.pitS[k - 1] === 0);
          const order = (seg: number) =>
            [...among].sort((a, b) => a.ends[seg]! - b.ends[seg]!).map((c) => c.driverId);
          const [before, after] = [order(k - 1), order(k)];
          const [lap, sector] = [Math.floor(k / 3) + 1, k % 3];
          const at = result.events.filter((e) => e.lap === lap && e.sector === sector);
          for (let a = 0; a < before.length; a++) {
            for (let c = a + 1; c < before.length; c++) {
              const [ahead, behind] = [before[a]!, before[c]!];
              if (after.indexOf(behind) > after.indexOf(ahead)) continue;
              const explained = at.some(
                (e) =>
                  (e.kind === 'overtake' && e.driverId === behind && e.otherId === ahead) ||
                  (explains.has(e.kind) && [ahead, behind].includes(e.driverId ?? '')),
              );
              if (!explained) silent++;
            }
          }
        }
      }
    }
    expect(silent / races).toBeLessThan(2);
  });

  it('decides the order into the first corner at the launch and reports the places won', () => {
    let gained = 0;
    let bogged = 0;
    for (let i = 0; i < 20; i++) {
      const race = simulateRace(input('parco-reale', `launch-${i}`));
      const launches = race.events.filter((e) => e.kind === 'launch');
      gained += launches
        .filter((e) => e.detail.bad !== 1)
        .reduce((sum, e) => sum + Number(e.detail.places), 0);
      bogged += launches.filter((e) => e.detail.bad === 1).length;
      for (const e of launches) expect(e.timeS).toBeLessThan(10);
    }
    expect(gained / 20).toBeGreaterThan(5);
    expect(gained / 20).toBeLessThan(25);
    expect(bogged).toBeGreaterThan(0);
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
