/**
 * The setup model (docs/systems/setup.md): the optimum moves with the conditions, being off it
 * costs a lap, and what a car may touch comes from what the team has.
 */
import { describe, expect, it } from 'vitest';
import { balance } from '@/data/balance';
import { loadActivePack } from '@/data/packs/active';
import { SETUP_PARAMETERS } from '@/data/schema/pack';
import { buildRaceInput } from '../race/build-input';
import { createWorld } from '../world/create-world';
import {
  idealSetup,
  openParameters,
  parameterLossS,
  setupConditions,
  setupLevelOf,
  setupLossS,
  withinAccess,
} from './setup';

const pack = loadActivePack();
const world = createWorld('setup-tests', pack, {
  mode: 'takeover',
  teamId: pack.teams[0]!.id,
  principalName: 'Test',
});
const track = pack.tracks[0]!;
const dry = { trackTempC: balance.setup.ideal.referenceTrackTempC, windKph: 15, wetness: 0 };

describe('where the optimum sits', () => {
  it('is the factory preset in the conditions the preset was made for', () => {
    expect(idealSetup(track, dry)).toEqual(track.factorySetup);
  });

  it('moves with heat, wind and water, and never off the scale', () => {
    const hot = idealSetup(track, { ...dry, trackTempC: dry.trackTempC + 20 });
    const windy = idealSetup(track, { ...dry, windKph: 45 });
    const wet = idealSetup(track, { ...dry, wetness: 1 });

    expect(hot.camber).toBeLessThan(track.factorySetup.camber);
    expect(windy.rearWing).toBeGreaterThan(track.factorySetup.rearWing);
    expect(wet.frontWing).toBeGreaterThan(track.factorySetup.frontWing);
    expect(wet.suspensionStiffness).toBeLessThan(track.factorySetup.suspensionStiffness);
    for (const setup of [hot, windy, wet])
      for (const p of SETUP_PARAMETERS) {
        expect(setup[p]).toBeGreaterThanOrEqual(0);
        expect(setup[p]).toBeLessThanOrEqual(100);
      }
  });

  it('reads the weekend’s own weather, not one minute of it', () => {
    const input = buildRaceInput(world, pack, 1, 'setup-conditions');
    const conditions = setupConditions(input.weather);
    const samples = input.weather.samples;
    const mean = samples.reduce((sum, s) => sum + s.trackTempC, 0) / samples.length;
    expect(conditions.trackTempC).toBeCloseTo(mean, 9);
    expect(conditions.wetness).toBeGreaterThanOrEqual(0);
  });
});

describe('what being off it costs', () => {
  it('is nothing on the optimum, and nothing inside the window', () => {
    const ideal = idealSetup(track, dry);
    expect(setupLossS(ideal, ideal)).toBe(0);
    const l = balance.setup.loss;
    expect(parameterLossS('frontWing', l.plateau * l.tolerance)).toBe(0);
    expect(parameterLossS('frontWing', l.plateau * l.tolerance + 1)).toBeGreaterThan(0);
  });

  it('grows with the square of the distance and stops at what the slider is worth', () => {
    const l = balance.setup.loss;
    const half = parameterLossS('rearWing', l.plateau * l.tolerance + 0.5 * l.tolerance * (1 - l.plateau));
    const full = parameterLossS('rearWing', l.tolerance);
    expect(half).toBeCloseTo(0.25 * l.seconds.rearWing, 9);
    expect(full).toBeCloseTo(l.seconds.rearWing, 9);
    expect(parameterLossS('rearWing', 100)).toBe(l.seconds.rearWing);
  });

  it('costs a tenth on a decent preset, half a second unread, and everything at the wrong end', () => {
    const ideal = idealSetup(track, dry);
    // A car on a preset that is the usual few points out: the tenth the plan asks the third level
    // to be worth (plan 5.2).
    const preset = { ...ideal };
    for (const p of SETUP_PARAMETERS) preset[p] = ideal[p] + (ideal[p] > 50 ? -6 : 6);
    expect(setupLossS(preset, ideal)).toBeGreaterThan(0.05);
    expect(setupLossS(preset, ideal)).toBeLessThan(0.3);

    // A car set up on a reading nobody has narrowed: about half a second, as in M5.
    const guessed = { ...ideal };
    for (const p of SETUP_PARAMETERS) guessed[p] = ideal[p] + (ideal[p] > 50 ? -11 : 11);
    expect(setupLossS(guessed, ideal)).toBeGreaterThan(0.3);
    expect(setupLossS(guessed, ideal)).toBeLessThan(0.8);

    const worst = { ...ideal };
    for (const p of SETUP_PARAMETERS) worst[p] = ideal[p] > 50 ? 0 : 100;
    const total = Object.values(balance.setup.loss.seconds).reduce((a, b) => a + b, 0);
    expect(setupLossS(worst, ideal)).toBeCloseTo(total, 9);
  });
});

describe('who may touch what', () => {
  const base = { engineerSkill: 50, simulatorLevel: 1, feedback: 50 };

  it('opens the mechanical level to an engineer or a simulator, and the fine level to neither alone', () => {
    expect(setupLevelOf(base)).toBe('base');
    expect(setupLevelOf({ ...base, engineerSkill: 60 })).toBe('mechanical');
    expect(setupLevelOf({ ...base, simulatorLevel: 2 })).toBe('mechanical');
    expect(setupLevelOf({ engineerSkill: 80, simulatorLevel: 3, feedback: 50 })).toBe('mechanical');
    expect(setupLevelOf({ engineerSkill: 80, simulatorLevel: 3, feedback: 70 })).toBe('fine');
  });

  it('leaves closed sliders on the factory preset, and expert mode opens them all', () => {
    const open = openParameters(base);
    expect(open.has('frontWing')).toBe(true);
    expect(open.has('camber')).toBe(false);
    expect(openParameters({ ...base, expertMode: true }).size).toBe(SETUP_PARAMETERS.length);

    const chosen = Object.fromEntries(SETUP_PARAMETERS.map((p) => [p, 12])) as typeof track.factorySetup;
    const applied = withinAccess(chosen, track.factorySetup, open);
    expect(applied.frontWing).toBe(12);
    expect(applied.camber).toBe(track.factorySetup.camber);
  });
});
