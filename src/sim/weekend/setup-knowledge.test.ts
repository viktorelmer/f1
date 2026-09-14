/**
 * What a team knows about its own setup (docs/systems/setup.md): a range that narrows with the
 * people, the tools and the laps, and a driver who points the right way — usually.
 */
import { describe, expect, it } from 'vitest';
import { balance } from '@/data/balance';
import { loadActivePack } from '@/data/packs/active';
import { SETUP_PARAMETERS } from '@/data/schema/pack';
import { idealSetup, type SetupCapability } from '../car/setup';
import { streams } from '../rng/rng';
import { gameDate } from '../types/game-date';
import { driverNotes, readSetup, refineSetup, setupReadingSd } from './setup-knowledge';

const pack = loadActivePack();
const track = pack.tracks[0]!;
const at = gameDate(2027, 3, 6);
const dry = { trackTempC: balance.setup.ideal.referenceTrackTempC, windKph: 15, wetness: 0 };
const ideal = idealSetup(track, dry);
const weak: SetupCapability = { engineerSkill: 45, simulatorLevel: 1, feedback: 45 };
const strong: SetupCapability = { engineerSkill: 88, simulatorLevel: 4, feedback: 80 };
const rng = (name: string) => streams('setup-knowledge')(name);

describe('the engineer’s recommendation', () => {
  it('is tighter with a better engineer, a better simulator and a driver who can describe a car', () => {
    expect(setupReadingSd(strong, 0)).toBeLessThan(setupReadingSd(weak, 0));
    expect(setupReadingSd({ ...weak, simulatorLevel: 4 }, 0)).toBeLessThan(setupReadingSd(weak, 0));
    expect(setupReadingSd({ ...weak, feedback: 90 }, 0)).toBeLessThan(setupReadingSd(weak, 0));
  });

  it('narrows with setup laps and never goes under the floor', () => {
    const cold = setupReadingSd(weak, 0);
    const worked = setupReadingSd(weak, 12);
    expect(worked).toBeLessThan(cold);
    expect(setupReadingSd(strong, 500)).toBeGreaterThanOrEqual(balance.setup.reading.minSd);
    expect(setupReadingSd(strong, 500)).toBeCloseTo(balance.setup.reading.minSd, 6);
  });

  it('is a range around the optimum, and the range holds it about as often as it promises', () => {
    let inside = 0;
    let total = 0;
    for (let i = 0; i < 200; i++) {
      const reading = readSetup(ideal, weak, at, rng(`read:${i}`));
      for (const p of SETUP_PARAMETERS) {
        total++;
        if (reading[p].low <= ideal[p] && ideal[p] <= reading[p].high) inside++;
        expect(reading[p].value).toBeGreaterThanOrEqual(0);
        expect(reading[p].value).toBeLessThanOrEqual(100);
      }
    }
    // The interval is the estimate's own, so it should hold the truth most of the time.
    expect(inside / total).toBeGreaterThan(0.7);
  });

  it('a session of running tightens what the engineer had', () => {
    const cold = readSetup(ideal, weak, at, rng('cold'));
    const after = refineSetup(cold, ideal, weak, 14, at, rng('after'));
    for (const p of SETUP_PARAMETERS) expect(after[p].basis.sd).toBeLessThan(cold[p].basis.sd);
  });
});

describe('what the driver says', () => {
  const off = { ...ideal, frontWing: Math.min(100, ideal.frontWing + 25), toe: Math.max(0, ideal.toe - 20) };

  it('says nothing about a car that is where it should be', () => {
    expect(driverNotes(ideal, ideal, strong, rng('nothing'))).toEqual([]);
  });

  it('points the right way at the worst thing first', () => {
    const notes = driverNotes(off, ideal, { ...strong, feedback: 100 }, rng('good'));
    expect(notes.length).toBeGreaterThan(0);
    const first = notes[0]!;
    expect(first.parameter).toBe('frontWing');
    expect(first.direction).toBe('less');
    expect(first.trusted).toBe(true);
  });

  it('blames the wrong thing more often the worse the driver describes a car', () => {
    const share = (capability: SetupCapability) => {
      let wrong = 0;
      const runs = 300;
      for (let i = 0; i < runs; i++) {
        const notes = driverNotes(off, ideal, capability, rng(`blame:${capability.feedback}:${i}`));
        if (notes.some((n) => !n.trusted)) wrong++;
      }
      return wrong / runs;
    };
    expect(share({ ...weak, feedback: 40 })).toBeGreaterThan(share({ ...strong, feedback: 95 }));
    expect(share({ ...strong, feedback: 95 })).toBeLessThan(0.35);
  });
});
