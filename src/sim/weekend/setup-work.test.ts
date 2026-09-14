/**
 * Dialling the car in over a weekend (docs/systems/setup.md): every car gets a setup before anyone
 * runs, practice narrows what the engineer knows, and the player's own sliders stand when the area
 * is theirs.
 */
import { describe, expect, it } from 'vitest';
import { loadActivePack } from '@/data/packs/active';
import { SETUP_PARAMETERS } from '@/data/schema/pack';
import { openParameters, setupLevelOf, setupLossS, idealSetup, setupConditions } from '../car/setup';
import { buildRaceInput } from '../race/build-input';
import { openWeekend, runSession, setCarSetup } from '../season/weekend';
import { createWorld } from '../world/create-world';
import { capabilityOf } from './setup-work';

const pack = loadActivePack();
const TEAM = pack.teams[0]!.id;
const world = createWorld('setup-work', pack, { mode: 'takeover', teamId: TEAM, principalName: 'Test' });
const round = world.season.calendar.find((r) => r.format === 'standard')!.round;
const track = (w: typeof world) =>
  pack.tracks.find((t) => t.id === w.season.calendar.find((r) => r.round === round)!.trackId)!;
const lossOf = (w: typeof world, driverId: string) => {
  const input = buildRaceInput(w, pack, round, 'setup-work');
  return input.entries.find((e) => e.driverId === driverId)!.setupLossS;
};

describe('when the weekend opens', () => {
  const open = openWeekend(world, pack, round, 'setup-work');

  it('puts a setup on every car and a reading in every garage', () => {
    const entries = buildRaceInput(open, pack, round, 'setup-work').entries;
    expect(Object.keys(open.weekend!.setups)).toHaveLength(entries.length);
    for (const entry of entries) {
      const reading = open.knowledge[entry.teamId]!.weekend!.setup[entry.driverId]!;
      expect(reading.laps).toBe(0);
      expect(reading.reading.frontWing.basis.sd).toBeGreaterThan(0);
    }
  });

  it('leaves the sliders a car may not touch on the factory preset', () => {
    for (const entry of buildRaceInput(open, pack, round, 'setup-work').entries) {
      const capability = capabilityOf(open, entry.teamId, entry.driverId);
      const allowed = openParameters(capability);
      const setup = open.weekend!.setups[entry.driverId]!;
      for (const p of SETUP_PARAMETERS)
        if (!allowed.has(p)) expect(setup[p]).toBe(track(open).factorySetup[p]);
      expect(['base', 'mechanical', 'fine']).toContain(setupLevelOf(capability));
    }
  });

  it('is worth about the half second the plan says a car off the truck is worth', () => {
    const entries = buildRaceInput(open, pack, round, 'setup-work').entries;
    const mean = entries.reduce((sum, e) => sum + e.setupLossS, 0) / entries.length;
    expect(mean).toBeGreaterThan(0.1);
    expect(mean).toBeLessThan(0.7);
  });
});

describe('what practice does to it', () => {
  it('narrows the reading and takes the car closer to the optimum', () => {
    let open = openWeekend(world, pack, round, 'setup-work');
    const driverId = world.teams[TEAM]!.drivers.race[0];
    const before = lossOf(open, driverId);
    const sdBefore = open.knowledge[TEAM]!.weekend!.setup[driverId]!.reading.frontWing.basis.sd;

    for (let i = 0; i < 3; i++) open = runSession(open, pack).world;

    const after = open.knowledge[TEAM]!.weekend!.setup[driverId]!;
    expect(after.laps).toBeGreaterThan(0);
    expect(after.reading.frontWing.basis.sd).toBeLessThan(sdBefore);
    expect(lossOf(open, driverId)).toBeLessThan(before);
  });

  it('keeps the player’s own setup when the area is theirs', () => {
    const manual = {
      ...world,
      career: { ...world.career, delegation: { ...world.career.delegation, setup: 'manual' as const } },
    };
    let open = openWeekend(manual, pack, round, 'setup-work');
    const driverId = manual.teams[TEAM]!.drivers.race[0];
    // The player dials in the optimum by hand — which they could only do by luck, but the point is
    // that nobody overwrites it.
    const ideal = idealSetup(
      track(open),
      setupConditions(buildRaceInput(open, pack, round, 'setup-work').weather),
      open.hidden.tracks[track(open).id]!.setupOffset,
    );
    open = setCarSetup(open, pack, driverId, ideal);
    const mine = open.weekend!.setups[driverId]!;

    for (let i = 0; i < 3; i++) open = runSession(open, pack).world;
    expect(open.weekend!.setups[driverId]).toEqual(mine);
    // And the engineer's rival cars were still dialled in by their engineers.
    const other = Object.values(open.teams).find((t) => t.id !== TEAM)!.drivers.race[0];
    expect(open.weekend!.setups[other]).not.toEqual(
      openWeekend(manual, pack, round, 'setup-work').weekend!.setups[other],
    );
  });
});

describe('the player’s own hand', () => {
  it('takes the sliders it may and refuses the ones it may not', () => {
    const open = openWeekend(world, pack, round, 'setup-work');
    const driverId = world.teams[TEAM]!.drivers.race[0];
    const allowed = openParameters(capabilityOf(open, TEAM, driverId));
    const wild = Object.fromEntries(SETUP_PARAMETERS.map((p) => [p, 3])) as typeof open.weekend extends null
      ? never
      : NonNullable<typeof open.weekend>['setups'][string];

    const after = setCarSetup(open, pack, driverId, wild).weekend!.setups[driverId]!;
    for (const p of SETUP_PARAMETERS) expect(after[p]).toBe(allowed.has(p) ? 3 : track(open).factorySetup[p]);
    // A setup this far out costs real time.
    expect(setupLossS(after, track(open).factorySetup)).toBeGreaterThan(0.3);
  });
});
