/**
 * Choosing a setup (docs/systems/setup.md): the engineer weighs what he believes, not what is true,
 * and a car that cannot touch a slider never offers to.
 */
import { describe, expect, it } from 'vitest';
import { balance } from '@/data/balance';
import { loadActivePack } from '@/data/packs/active';
import { SETUP_PARAMETERS } from '@/data/schema/pack';
import { idealSetup, type SetupCapability } from '../car/setup';
import { streams } from '../rng/rng';
import { gameDate } from '../types/game-date';
import { decideSetup, expectedLossS, setupOptions } from './setup-choice';
import { readSetup } from './setup-knowledge';

const pack = loadActivePack();
const track = pack.tracks[0]!;
const at = gameDate(2027, 3, 6);
const dry = { trackTempC: balance.setup.ideal.referenceTrackTempC, windKph: 15, wetness: 0 };
const ideal = idealSetup(track, dry);
const rng = (name: string) => streams('setup-choice')(name);
const engineer = { skill: 0.8, consistency: 0.8, rapport: 0.5 };
const capability: SetupCapability = { engineerSkill: 75, simulatorLevel: 3, feedback: 70 };
const reading = readSetup(ideal, capability, at, rng('reading'));

const context = {
  reading,
  factory: track.factorySetup,
  current: track.factorySetup,
  notes: [],
  capability,
};

describe('the options on the table', () => {
  it('are the sources of the autosetup, and what the driver asked for', () => {
    const plain = setupOptions(context).map((o) => o.source);
    expect(plain).toContain('engineer');
    expect(plain).toContain('factory');
    expect(plain).toContain('stay');

    const withMore = setupOptions({
      ...context,
      teamMate: track.factorySetup,
      saved: track.factorySetup,
      notes: [{ parameter: 'frontWing', direction: 'more', trusted: true }],
    }).map((o) => o.source);
    expect(withMore).toContain('team-mate');
    expect(withMore).toContain('saved');
    expect(withMore).toContain('driver-note');
  });

  it('never moves a slider the car may not touch', () => {
    const shut: SetupCapability = { engineerSkill: 40, simulatorLevel: 1, feedback: 40 };
    const options = setupOptions({ ...context, capability: shut });
    for (const option of options) {
      expect(option.setup.camber).toBe(track.factorySetup.camber);
      expect(option.setup.toe).toBe(track.factorySetup.toe);
      expect(option.setup.gearRatios).toBe(track.factorySetup.gearRatios);
    }
  });
});

describe('the call', () => {
  it('takes the engineer’s own recommendation when nothing better is on offer', () => {
    const decision = decideSetup(
      context,
      engineer,
      { goal: 'race', risk: 0.5, issuedBy: 'player' },
      rng('call'),
    );
    expect(decision.choice.source).toBe('engineer');
    // Every option is scored, and the chosen one is among them with its reasons.
    expect(decision.considered.length).toBeGreaterThan(2);
    expect(decision.considered.some((o) => o.reasons.includes('setup.goal.race'))).toBe(true);
  });

  it('is judged on what the engineer believes, and he can be wrong', () => {
    const recommended = {} as typeof ideal;
    for (const p of SETUP_PARAMETERS) recommended[p] = reading[p].value;
    // By his own model the recommendation is perfect; against the truth it is not.
    expect(expectedLossS(recommended, reading)).toBe(0);
  });

  it('does not pretend the closed sliders are the problem', () => {
    const shut: SetupCapability = { engineerSkill: 40, simulatorLevel: 1, feedback: 40 };
    const decision = decideSetup(
      { ...context, capability: shut },
      engineer,
      { goal: 'qualifying', risk: 0.5, issuedBy: 'player' },
      rng('shut'),
    );
    expect(decision.choice.setup.camber).toBe(track.factorySetup.camber);
  });
});
