/**
 * The tyre entry (docs/systems/weekend-play.md): declared before the weekend, spent for real, and
 * felt on Saturday afternoon when there is nothing fresh left to bolt on.
 */
import { describe, expect, it } from 'vitest';
import { balance } from '@/data/balance';
import { loadActivePack } from '@/data/packs/active';
import { DRY_COMPOUNDS } from '@/data/schema/race-balance';
import { openWeekend, runSession, setTyreEntry, WEEKEND_SESSIONS } from '../season/weekend';
import type { SessionKind, TyreAllocation, World } from '../types/world';
import { createWorld } from '../world/create-world';
import { allocations, noSets, planFits, tyreReserve } from './tyres';

const pack = loadActivePack();
const TEAM = 'kestrel';
const world = createWorld('tyres-tests', pack, {
  mode: 'takeover',
  teamId: TEAM,
  principalName: 'Test',
});
const regulation = pack.regulations.find((r) => r.season === world.season.year)!;
const standard = world.season.calendar.find((r) => r.format === 'standard')!.round;
const mine = world.teams[TEAM]!.drivers.race;
const total = (a: TyreAllocation) => a.soft + a.medium + a.hard;

/** Runs a whole weekend session by session and hands back the world and every session's detail. */
function play(from: World, round: number, seed: string) {
  let open = from.weekend ? from : openWeekend(from, pack, round, seed);
  const details = [];
  while (open.weekend!.stage !== 'done') {
    const outcome = runSession(open, pack);
    details.push({ stage: outcome.stage, detail: outcome.detail });
    open = outcome.world;
  }
  return { world: open, details };
}

describe('what a car may declare', () => {
  it('splits the regulation’s sets three ways, keeping a minimum of each', () => {
    const min = balance.weekend.tyres.minPerCompound;
    const limit = regulation.tyreSetsPerWeekend.standard;
    const options = allocations(limit, min);
    expect(options.length).toBeGreaterThan(1);
    for (const option of options) {
      expect(total(option)).toBe(limit);
      for (const compound of DRY_COMPOUNDS) expect(option[compound]).toBeGreaterThanOrEqual(min);
    }
    // Every split appears exactly once.
    expect(new Set(options.map((o) => `${o.soft}-${o.medium}-${o.hard}`)).size).toBe(options.length);
  });

  it('counts a set per stint: three stints on the soft need three sets of softs', () => {
    const plan = { stints: [{ compound: 'soft' as const, laps: 20 }] };
    expect(planFits(plan, { soft: 1, medium: 0, hard: 0 })).toBe(true);
    const three = { stints: Array.from({ length: 3 }, () => ({ compound: 'soft' as const, laps: 20 })) };
    expect(planFits(three, { soft: 2, medium: 5, hard: 5 })).toBe(false);
    expect(planFits(three, { soft: 3, medium: 0, hard: 0 })).toBe(true);
  });

  it('reserves a set for every part of every qualifying, and for every fresh practice run', () => {
    const parts = balance.weekend.qualifying.partMinutes.length;
    const nothing = () => [];
    expect(tyreReserve(WEEKEND_SESSIONS.standard, nothing).soft).toBe(parts);
    // A sprint weekend qualifies twice, and its entry has to cover both.
    expect(tyreReserve(WEEKEND_SESSIONS.sprint, nothing).soft).toBe(2 * parts);
    // A long run goes out on a fresh set; setup work does not.
    const fresh = tyreReserve(['fp1'], () => [
      { programme: 'long-run', compound: 'medium' },
      { programme: 'setup', compound: 'hard' },
    ]);
    expect(fresh.medium).toBe(1);
    expect(fresh.hard).toBe(0);
  });
});

describe('the entry through a weekend', () => {
  const played = play(world, standard, 'spend');

  it('declares within the limit and never spends more than it declared', () => {
    const open = openWeekend(world, pack, standard, 'spend');
    for (const entry of Object.values(open.weekend!.tyres))
      expect(total(entry)).toBe(regulation.tyreSetsPerWeekend.standard);
    for (const [driverId, left] of Object.entries(played.world.weekend!.sets)) {
      const declared = open.weekend!.tyres[driverId]!;
      for (const compound of DRY_COMPOUNDS) {
        expect(left[compound]).toBeGreaterThanOrEqual(0);
        expect(left[compound]).toBeLessThanOrEqual(declared[compound]);
      }
      expect(total(left)).toBeLessThan(total(declared));
    }
  });

  it('takes a set for every part a car qualifies in', () => {
    const before = play(world, standard, 'spend');
    const qualifying = before.details.find((d) => d.stage === 'qualifying')!;
    if (qualifying.detail.kind !== 'qualifying') throw new Error('qualifying ran as something else');
    const { laps, setsLeft } = qualifying.detail.qualifying;
    // The state before qualifying is what the session started from.
    const practiceEnd = playUntil(world, standard, 'spend', 'qualifying');
    for (const driverId of Object.keys(setsLeft)) {
      const parts = laps.filter((l) => l.driverId === driverId).length;
      const had = practiceEnd.weekend!.sets[driverId]!;
      const now = setsLeft[driverId]!;
      expect(total(had) - total(now)).toBe(Math.min(parts, total(had)));
    }
  });

  it('does not plan a race on rubber the car has not got', () => {
    const race = played.details.find((d) => d.stage === 'race')!;
    if (race.detail.kind !== 'race') throw new Error('the race ran as something else');
    const start = playUntil(world, standard, 'spend', 'race');
    let overBudget = 0;
    for (const [driverId, plan] of Object.entries(race.detail.result.plans)) {
      const had = start.weekend!.sets[driverId]!;
      const used = noSets();
      for (const stint of plan.stints) if (stint.compound in used) used[stint.compound as 'soft'] += 1;
      const over = DRY_COMPOUNDS.some((c) => used[c] > had[c]);
      if (!over) continue;
      overBudget++;
      // The one case where a plan may exceed the rack: a car down to a single dry compound cannot
      // satisfy the two-compound rule at all, so it plans as if it had the rubber (see planOptions).
      expect(DRY_COMPOUNDS.filter((c) => had[c] > 0).length).toBeLessThan(2);
    }
    // And that is the exception, not how the field races.
    expect(overBudget).toBeLessThan(race.detail.input.entries.length / 4);
  });
});

describe('a declaration you regret', () => {
  it('leaves a car qualifying on whatever it has left, and it is slower for it', () => {
    /** The first part of qualifying, which every car runs: mean lap of the player's two cars. */
    const q1 = (entry: TyreAllocation, seed: string) => {
      let open = openWeekend(world, pack, standard, seed);
      for (const driverId of mine) open = setTyreEntry(open, driverId, entry);
      const qualifying = play(open, standard, seed).details.find((d) => d.stage === 'qualifying')!;
      if (qualifying.detail.kind !== 'qualifying') throw new Error('qualifying ran as something else');
      const laps = qualifying.detail.qualifying.laps.filter((l) => l.part === 0 && mine.includes(l.driverId));
      return laps.reduce((sum, l) => sum + l.timeS, 0) / laps.length;
    };
    const mean = (entry: TyreAllocation) =>
      [0, 1, 2, 3].reduce((sum, i) => sum + q1(entry, `regret-${i}`), 0) / 4;

    const onSofts = mean({ soft: 6, medium: 4, hard: 3 });
    const noSofts = mean({ soft: 0, medium: 7, hard: 6 });
    // Nothing fresh at all: the car goes out on a scrubbed soft, which is what the rules leave it.
    const nothing = mean({ soft: 0, medium: 0, hard: 0 });
    expect(noSofts).toBeGreaterThan(onSofts);
    expect(nothing).toBeGreaterThan(onSofts);
  });

  it('leaves a practice run in the garage when the compound has run out', () => {
    let open = openWeekend(world, pack, standard, 'no-rubber');
    for (const driverId of mine) open = setTyreEntry(open, driverId, { soft: 9, medium: 2, hard: 2 });
    const greedy = Object.fromEntries(
      mine.map((id) => [
        id,
        Array.from({ length: 4 }, () => ({ programme: 'long-run' as const, compound: 'medium' as const })),
      ]),
    );
    const outcome = runSession(open, pack, { plans: greedy });
    if (outcome.detail.kind !== 'practice') throw new Error('fp1 ran as something else');
    const skipped = outcome.detail.practice.skipped.filter((s) => mine.includes(s.driverId));
    expect(skipped.length).toBeGreaterThan(0);
    for (const driverId of mine) expect(outcome.world.weekend!.sets[driverId]!.medium).toBe(0);
  });
});

/** The world as it stood when `stage` was about to be run. */
function playUntil(from: World, round: number, seed: string, stage: SessionKind): World {
  let open = openWeekend(from, pack, round, seed);
  while (open.weekend!.stage !== stage) open = runSession(open, pack).world;
  return open;
}
