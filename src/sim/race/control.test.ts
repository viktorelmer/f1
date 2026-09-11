import { describe, expect, it } from 'vitest';
import { isLocalPack, loadActivePack } from '@/data/packs/active';
import { fingerprint } from '../util/hash';
import { createWorld } from '../world/create-world';
import { buildRaceInput } from './build-input';
import { obeyChance } from './orders';
import { raceStrategy, simulateRace } from './simulate';
import { overtakeProbability } from './traffic';
import type { LapRecord, RaceCommand, RaceControl, RaceResult } from './types';

const pack = loadActivePack();
const TEAM = 'kestrel';
const world = createWorld('control-tests', pack, { mode: 'takeover', teamId: TEAM, principalName: 'Test' });
const [CAR_A, CAR_B] = world.teams[TEAM]!.drivers.race;
const roundOf = (trackId: string) => world.season.calendar.find((r) => r.trackId === trackId)!.round;

const control = (over: Partial<RaceControl> = {}): RaceControl => ({
  teamId: TEAM,
  strategy: { mode: 'delegated', risk: 0.5, goal: 'fastest' },
  radio: { mode: 'delegated', aggression: 'normal', saving: 'none' },
  plans: {},
  ...over,
});
const race = (track: string, seed: string, ctl: RaceControl | null, commands: RaceCommand[] = []) =>
  simulateRace(buildRaceInput(world, pack, roundOf(track), seed, { control: ctl, commands }));
const firstStop = (r: RaceResult, id: string) => r.laps[id]!.find((l) => l.pitted)?.lap ?? null;
const positionAt = (r: RaceResult, id: string, lap: number) => r.laps[id]![lap - 1]?.position ?? Infinity;

describe('commands', () => {
  it('act from their moment on: the race before it is byte for byte the same', () => {
    const base = race('al-rimal', 'cmd-1', control());
    const at = base.laps[CAR_A]![20]!.lineTimeS;
    const changed = race('al-rimal', 'cmd-1', control(), [
      { timeS: at, kind: 'radio', driverId: CAR_A, radio: { pace: 'push' } },
    ]);
    const before = (r: RaceResult) => ({
      events: r.events.filter((e) => e.timeS < at),
      laps: Object.fromEntries(
        Object.entries(r.laps).map(([id, ls]) => [id, ls.filter((l) => l.lineTimeS < at)]),
      ),
    });
    expect(fingerprint(before(changed))).toBe(fingerprint(before(base)));
    expect(fingerprint(changed)).not.toBe(fingerprint(base));
  });

  it('are deterministic: the same commands give the same race', () => {
    const commands: RaceCommand[] = [
      { timeS: 300, kind: 'radio', driverId: CAR_A, radio: { pace: 'push', aggression: 'aggressive' } },
      { timeS: 900, kind: 'team-order', teamId: TEAM, order: 'swap' },
    ];
    const a = race('al-rimal', 'cmd-2', control(), commands);
    expect(fingerprint(race('al-rimal', 'cmd-2', control(), commands))).toBe(fingerprint(a));
  });

  it('a new plan re-plans the rest of the race for the stops asked; "box" brings the car in', () => {
    const base = race('al-rimal', 'cmd-3', control());
    const at = base.laps[CAR_A]![4]!.lineTimeS;
    const replanned = race('al-rimal', 'cmd-3', control(), [
      { timeS: at, kind: 'plan', driverId: CAR_A, stops: 2 },
    ]);
    const revision = replanned.planHistory[CAR_A]!.find((p) => p.timeS >= at)!;
    // The stint on the car and two more after it.
    expect(revision.stints).toHaveLength(3);
    const call = replanned.events.find((e) => e.kind === 'strategy-call' && e.driverId === CAR_A)!;
    expect(call.detail).toMatchObject({ trigger: 'player', call: 'plan', stops: 2 });

    const boxed = race('al-rimal', 'cmd-3', control(), [
      { timeS: at, kind: 'pit', driverId: CAR_A, compound: 'hard' },
    ]);
    const stop = boxed.events.find((e) => e.kind === 'pit' && e.driverId === CAR_A)!;
    expect(stop.lap).toBeLessThanOrEqual(6);
    expect(boxed.laps[CAR_A]![stop.lap]!.compound).toBe('hard');
  });

  it.skipIf(isLocalPack)('pins a race with commands for the default pack', () => {
    const a = race('al-rimal', 'cmd-2', control(), [
      { timeS: 300, kind: 'radio', driverId: CAR_A, radio: { pace: 'push', aggression: 'aggressive' } },
      { timeS: 900, kind: 'team-order', teamId: TEAM, order: 'swap' },
    ]);
    expect(fingerprint(a)).toBe('1bee776a7d76a4');
  });
});

describe('radio', () => {
  const manual = control({ radio: { mode: 'manual', aggression: 'normal', saving: 'none' } });
  /** The opening laps of a race, for comparing one radio setting against another. */
  const opening = (r: RaceResult) => r.laps[CAR_A]!.slice(1, 4);
  const usable = (l: LapRecord | undefined) =>
    l !== undefined && !l.incident && !l.pitted && l.status === 'green';

  it('push is quicker and wears the tyres harder; saving tyres is the other way round', () => {
    // Lap for lap over the opening stint of many races: a car held in a queue laps at the pace of
    // the car in front however hard it is asked to push, so one race says nothing on its own. Later
    // in a stint the comparison turns over by design — push has worn its tyres out by then.
    const run = (seed: string, pace: 'push' | 'save-tyres') =>
      opening(race('valles', seed, manual, [{ timeS: 0, kind: 'radio', driverId: CAR_A, radio: { pace } }]));
    let pairs = 0;
    let lapDelta = 0;
    let wearDelta = 0;
    for (let i = 0; i < 24; i++) {
      const [push, save] = [run(`radio-${i}`, 'push'), run(`radio-${i}`, 'save-tyres')];
      for (const [lap, a] of push.entries()) {
        const b = save[lap];
        if (!usable(a) || !usable(b)) continue;
        pairs++;
        lapDelta += a.lapTimeS - b!.lapTimeS;
        wearDelta += a.tyreWear - b!.tyreWear;
      }
    }
    expect(pairs).toBeGreaterThan(40);
    expect(lapDelta / pairs).toBeLessThan(-0.05);
    expect(wearDelta / pairs).toBeGreaterThan(0);
  });

  it('ERS attack drains the battery, harvesting charges it', () => {
    const battery = (ers: 'attack' | 'harvest') =>
      race('valles', 'radio-2', manual, [{ timeS: 0, kind: 'radio', driverId: CAR_A, radio: { ers } }])
        .laps[CAR_A]!.slice(3, 10)
        .reduce((sum, l) => sum + l.battery, 0);
    expect(battery('attack')).toBeLessThan(battery('harvest'));
  });

  it('aggression raises the odds of a pass (and of contact, in the balance)', () => {
    const odds = (aggression: number) =>
      overtakeProbability({
        paceAdvantageS: 0.6,
        drsOpen: true,
        drsZone: true,
        attackerRacecraft: 85,
        defenderRacecraft: 85,
        wearAdvantage: 0,
        overtakingDifficulty: 0.5,
        lap1: false,
        attackerPushes: false,
        defenderPushes: false,
        aggression,
      });
    expect(odds(0.5)).toBeGreaterThan(odds(0));
    expect(odds(0)).toBeGreaterThan(odds(-0.5));
  });

  it('stands the engineer down under a neutralisation: nobody pushes behind the safety car', () => {
    const r = race('marina-lights', 'M3-flag', control());
    const laps = r.laps[CAR_A]!;
    const history = r.pitWall!.radio[CAR_A]!;
    /** The settings the car ran a lap on: the ones in force when it crossed the previous line. */
    const runOn = (lap: number) =>
      history.filter((h) => h.timeS <= (laps[lap - 2]?.lineTimeS ?? 0)).at(-1)!.settings;
    // Laps neutralised at both ends: the whole lap was behind the queue.
    const neutralised = laps.filter(
      (l) => l.lap > 1 && l.status !== 'green' && laps[l.lap - 2]!.status !== 'green',
    );
    expect(neutralised.length).toBeGreaterThan(0);
    for (const lap of neutralised) {
      expect(runOn(lap.lap).pace).not.toBe('push');
      expect(runOn(lap.lap).ers).not.toBe('attack');
    }
  });

  it('lets the race engineer run the radio of every car, the player’s included, through the same call', () => {
    const r = race('al-rimal', 'radio-3', control());
    expect(r.pitWall!.radio[CAR_A]!.length).toBeGreaterThan(1);
    expect(r.events.some((e) => e.kind === 'radio' && e.detail.by === 'engineer')).toBe(true);
  });
});

describe('team orders', () => {
  it('are obeyed more by a loyal, modest driver than by a proud one, and less when he is faster', () => {
    const calm = obeyChance({ loyalty: 90, ego: 20, morale: 70 }, { faster: false, pointsAtStake: false });
    const proud = obeyChance({ loyalty: 40, ego: 90, morale: 40 }, { faster: false, pointsAtStake: false });
    expect(calm).toBeGreaterThan(proud);
    expect(
      obeyChance({ loyalty: 60, ego: 60, morale: 60 }, { faster: true, pointsAtStake: true }),
    ).toBeLessThan(obeyChance({ loyalty: 60, ego: 60, morale: 60 }, { faster: false, pointsAtStake: false }));
  });

  it('end in a let-by or a refusal, and either reads in the feed', () => {
    let outcomes = 0;
    for (let i = 0; i < 8; i++) {
      const base = race('al-rimal', `order-${i}`, control());
      const at = base.laps[CAR_A]![10]!.lineTimeS;
      const r = race('al-rimal', `order-${i}`, control(), [
        { timeS: at, kind: 'team-order', teamId: TEAM, order: 'swap' },
      ]);
      expect(r.events.some((e) => e.kind === 'team-order' && e.timeS >= at)).toBe(true);
      if (r.events.some((e) => (e.kind === 'let-by' || e.kind === 'order-refused') && e.timeS >= at))
        outcomes++;
    }
    expect(outcomes).toBeGreaterThan(0);
  });
});

describe('the strategist’s decisions for the player', () => {
  /** A race where the strategist makes a call for the player's team (a safety car at a street circuit). */
  function raceWithDecision(ctl: RaceControl) {
    for (let i = 0; i < 40; i++) {
      const r = race('marina-lights', `call-${i}`, ctl);
      const d = r.pitWall!.decisions.find((x) => x.trigger === 'safety-car' && x.options.length > 1);
      if (d) return { seed: `call-${i}`, r, d };
    }
    throw new Error('no strategist decision found');
  }

  it('in manual mode wait for the player: nothing is done until an answer comes', () => {
    const manual = control({ strategy: { mode: 'manual', risk: 0.5, goal: 'fastest' } });
    const { seed, d } = raceWithDecision(manual);
    expect(d.by).toBe('unanswered');
    expect(d.options[d.applied]!.answer.call).toBe('stay');

    const box = d.options.find((o) => o.answer.call === 'pit')!;
    const answered = race('marina-lights', seed, manual, [
      { timeS: d.timeS, kind: 'call', driverId: d.driverId, answer: box.answer },
    ]);
    const settled = answered.pitWall!.decisions.find(
      (x) => x.timeS === d.timeS && x.driverId === d.driverId,
    )!;
    expect(settled.by).toBe('player');
    expect(
      answered.events.some((e) => e.kind === 'pit' && e.driverId === d.driverId && e.lap === d.lap),
    ).toBe(true);
  });

  it('when delegated, the strategist decides and the player can overrule it after the fact', () => {
    const { seed, d } = raceWithDecision(control());
    expect(d.by).toBe('strategist');
    const other = d.options.findIndex((_, i) => i !== d.recommended);
    const overruled = race('marina-lights', seed, control(), [
      { timeS: d.timeS, kind: 'call', driverId: d.driverId, answer: d.options[other]!.answer },
    ]);
    const settled = overruled.pitWall!.decisions.find(
      (x) => x.timeS === d.timeS && x.driverId === d.driverId,
    )!;
    expect(settled.applied).toBe(other);
    expect(settled.recommended).toBe(d.recommended);
  });
});

describe('forecast and pit window', () => {
  it('give an honest forecast: the finish falls inside the interval most of the time, narrowing to the flag', () => {
    let inside = 0;
    let total = 0;
    let earlyWidth = 0;
    let lateWidth = 0;
    for (let i = 0; i < 12; i++) {
      const r = race('al-rimal', `fc-${i}`, control());
      for (const id of [CAR_A, CAR_B]) {
        const finish = r.classification.find((c) => c.driverId === id)!;
        if (finish.status !== 'finished') continue;
        for (const f of r.pitWall!.forecasts[id]!) {
          if (f.lap < 10) continue;
          total++;
          if (finish.position >= Math.floor(f.position.low) && finish.position <= Math.ceil(f.position.high))
            inside++;
        }
        const fs = r.pitWall!.forecasts[id]!;
        earlyWidth += fs[5]!.position.high - fs[5]!.position.low;
        lateWidth += fs.at(-1)!.position.high - fs.at(-1)!.position.low;
      }
    }
    expect(inside / total).toBeGreaterThan(0.7);
    expect(lateWidth).toBeLessThan(earlyWidth);
  });

  it('puts the planned stop inside the pit window', () => {
    const r = race('al-rimal', 'window-1', control());
    const plan = r.planHistory[CAR_A]![0]!.stints;
    const window = r.pitWall!.forecasts[CAR_A]![0]!.window!;
    expect(plan[0]!.toLap).toBeGreaterThanOrEqual(window[0] - 1);
    expect(plan[0]!.toLap).toBeLessThanOrEqual(window[1] + 1);
  });
});

describe('M4 DoD: the player’s decisions change the outcome', () => {
  it('an early stop — the undercut — wins a place that staying out loses', () => {
    let candidates = 0;
    let gained = 0;
    // A wide net: situations where an undercut is on at all are not that common, and a handful of
    // them says nothing about whether the move works.
    for (const track of ['huangpu', 'lakeside-park', 'al-rimal', 'northfield', 'valles']) {
      for (let i = 0; i < 25; i++) {
        const seed = `undercut-${i}`;
        const base = race(track, seed, control());
        for (const me of [CAR_A, CAR_B]) {
          const myStop = firstStop(base, me);
          if (!myStop || myStop < 6) continue;
          // The rival directly ahead three laps before our stop, close enough to undercut.
          const lap = myStop - 3;
          const mine = base.laps[me]![lap - 1]!;
          const ahead = Object.entries(base.laps).find(
            ([, ls]) => ls[lap - 1]?.position === mine.position - 1,
          );
          if (!ahead || ahead[0] === CAR_A || ahead[0] === CAR_B) continue;
          const [rival, theirs] = ahead;
          const rivalStop = firstStop(base, rival);
          const gap = mine.gapToLeaderS - theirs[lap - 1]!.gapToLeaderS;
          if (gap > 2.5 || !rivalStop || rivalStop < lap + 2 || rivalStop > myStop + 3) continue;
          const after = Math.max(rivalStop, myStop) + 2;
          if (positionAt(base, me, after) < positionAt(base, rival, after)) continue;
          candidates++;
          const box = {
            timeS: mine.lineTimeS + 0.001,
            kind: 'pit' as const,
            driverId: me,
            compound: base.laps[me]![myStop]!.compound,
          };
          const undercut = race(track, seed, control(), [box]);
          if (positionAt(undercut, me, after) < positionAt(undercut, rival, after)) gained++;
        }
      }
    }
    expect(candidates).toBeGreaterThan(15);
    // Measured at 15% on the owner's pack and 25% on the default one after M5 put the field on a
    // qualifying grid: the car 2.5 s up the road is now usually a genuinely faster one, and an
    // undercut on a faster car is meant to be hard. The move still wins places, which is the point.
    expect(gained / candidates).toBeGreaterThan(0.1);
  }, 120_000);

  it('delegated strategy is on average within 0.2 places of manual over 200 races, with the same strategist', () => {
    const manual = (track: string, seed: string) => {
      const input = buildRaceInput(world, pack, roundOf(track), seed, { control: control() });
      // The player picks the plan the strategist's model rates fastest, and answers every call
      // with the option it expects to be fastest — the strategist's numbers without the noise.
      const { options } = raceStrategy(input, TEAM);
      const best = options.reduce((a, b) => (b.timeS < a.timeS ? b : a)).plan;
      const ctl = control({
        strategy: { mode: 'manual', risk: 0.5, goal: 'fastest' },
        plans: { [CAR_A]: best, [CAR_B]: best },
      });
      const commands: RaceCommand[] = [];
      for (;;) {
        const r = race(track, seed, ctl, commands);
        const open = r.pitWall!.decisions.find((d) => d.by === 'unanswered');
        if (!open) return r;
        const pick = open.options.reduce((a, b) => (b.expectedS < a.expectedS ? b : a));
        commands.push({ timeS: open.timeS, kind: 'call', driverId: open.driverId, answer: pick.answer });
      }
    };
    const mean = (results: RaceResult[]) =>
      results
        .flatMap((r) => r.classification.filter((c) => c.teamId === TEAM).map((c) => c.position))
        .reduce((a, b) => a + b, 0) /
      (results.length * 2);
    // Twice the sample the DoD asks for: over 100 races the mean of a paired difference this
    // spread out (sd ≈ 2.1 places) still moves ±0.2 from one set of tracks to another.
    const tracks = [
      'al-rimal',
      'valles',
      'marina-lights',
      'huangpu',
      'northfield',
      'murtal',
      'parco-reale',
      'caspian',
      'isewan',
      'represa',
    ];
    const seeds = tracks.flatMap((track) =>
      Array.from({ length: 20 }, (_, i) => [track, `dod-${i}`] as const),
    );
    const manualMean = mean(seeds.map(([track, seed]) => manual(track, seed)));
    const delegatedMean = mean(seeds.map(([track, seed]) => race(track, seed, control())));
    expect(delegatedMean - manualMean).toBeLessThanOrEqual(0.2);
  }, 120_000);
});
