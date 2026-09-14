/**
 * The weeks between races (docs/systems/car-development.md): the factory works while the calendar
 * waits, parts that are ready go on the car, and a season measurably moves the field.
 */
import { describe, expect, it } from 'vitest';
import { loadActivePack } from '@/data/packs/active';
import { runWeekend } from './weekend';
import { advanceTo } from './advance';
import { addDays } from '../types/game-date';
import { createWorld } from '../world/create-world';
import type { World } from '../types/world';

const pack = loadActivePack();
const TEAM = pack.teams[0]!.id;
const world = createWorld('advance', pack, { mode: 'takeover', teamId: TEAM, principalName: 'Test' });
const rival = pack.teams[1]!.id;
const chassisMean = (w: World, teamId: string) => {
  const parts = Object.values(w.teams[teamId]!.chassis);
  return parts.reduce((a, b) => a + b, 0) / parts.length;
};

describe('moving the clock', () => {
  it('never goes backwards and never works a day twice', () => {
    const ahead = advanceTo(world, pack, addDays(world.date, 30));
    expect(ahead.date).toBe(addDays(world.date, 30));
    expect(advanceTo(ahead, pack, world.date).date).toBe(ahead.date);

    const inOneGo = advanceTo(world, pack, addDays(world.date, 60));
    const inTwo = advanceTo(advanceTo(world, pack, addDays(world.date, 30)), pack, addDays(world.date, 60));
    // The same days of work, however they are taken: projects are at the same stage.
    expect(inTwo.projects.map((p) => p.stage).sort()).toEqual(inOneGo.projects.map((p) => p.stage).sort());
  });

  it('starts projects for teams that have room, and not for a player who keeps the area', () => {
    const ahead = advanceTo(world, pack, addDays(world.date, 14));
    expect(ahead.projects.length).toBeGreaterThan(0);
    // The career starts with development in the player's own hands (plan 5.19 preset).
    expect(world.career.delegation.development).toBe('manual');
    expect(ahead.projects.some((p) => p.teamId === TEAM)).toBe(false);
    expect(ahead.projects.some((p) => p.teamId === rival)).toBe(true);
  });

  it('fits a part that is built, and the rating moves with it', () => {
    let ahead = advanceTo(world, pack, addDays(world.date, 14));
    const before = chassisMean(ahead, rival);
    ahead = advanceTo(ahead, pack, addDays(ahead.date, 200));
    expect(ahead.projects.some((p) => p.teamId === rival && p.stage === 'installed')).toBe(true);
    expect(chassisMean(ahead, rival)).toBeGreaterThan(before);
  });
});

describe('M6 DoD: a season of development', () => {
  it('moves every car that develops, and leaves the field still a field', () => {
    let w: World = world;
    const before = Object.fromEntries(Object.keys(w.teams).map((id) => [id, chassisMean(w, id)]));
    for (const round of w.season.calendar) {
      w = advanceTo(w, pack, addDays(round.raceDate, -3));
      w = runWeekend(w, pack, round.round, `advance-${round.round}`).world;
    }

    const developed = Object.keys(w.teams).filter((id) => id !== TEAM);
    for (const id of developed) expect(chassisMean(w, id)).toBeGreaterThan(before[id]!);
    // The field is still a field: nobody has run away with it, nobody has collapsed.
    const spreadBefore = spread(Object.values(before));
    const spreadAfter = spread(developed.map((id) => chassisMean(w, id)));
    expect(spreadAfter).toBeLessThan(spreadBefore * 1.5);
    // And upgrades were checked on track, so teams learned about their own tunnels.
    expect(w.projects.filter((p) => p.stage === 'validated').length).toBeGreaterThan(10);
    const known = w.knowledge[rival]!.correlation;
    expect(known.basis.sd).toBeLessThan(world.knowledge[rival]!.correlation.basis.sd);
  }, 120_000);
});

const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
