/**
 * The car's setup (docs/systems/setup.md, plan 5.2): nine parameters, a hidden optimum that moves
 * with the conditions, and the lap time a car loses by not being on it.
 *
 * The optimum is computed, never stored: the pack's factory preset is the optimum in reference
 * conditions, and heat, wind and water move it from there. Nobody sees it — a team only ever has
 * its engineer's reading of it (`weekend/setup-knowledge.ts`).
 */
import { balance } from '@/data/balance';
import { SETUP_PARAMETERS, type SetupParameter } from '@/data/schema/pack';
import type { PackTrack, Setup } from '@/data/schema/pack';
import type { WeatherTimeline } from '../race/types';

export type { Setup, SetupParameter };

/** The three levels of 5.2: what a team may touch depends on what it has, not on what it knows. */
export type SetupLevel = 'base' | 'mechanical' | 'fine';

export const SETUP_LEVEL: Record<SetupParameter, SetupLevel> = {
  frontWing: 'base',
  rearWing: 'base',
  brakeBias: 'base',
  frontRideHeight: 'mechanical',
  rearRideHeight: 'mechanical',
  suspensionStiffness: 'mechanical',
  camber: 'fine',
  toe: 'fine',
  gearRatios: 'fine',
};

/** What the weekend's weather means for the setup: one number per thing the optimum reacts to. */
export type SetupConditions = { trackTempC: number; windKph: number; wetness: number };

/**
 * The conditions a weekend is set up for: the mean of the session's own weather. A setup is chosen
 * once for a session, so it is chosen for the session as a whole, not for one of its minutes.
 */
export function setupConditions(weather: WeatherTimeline): SetupConditions {
  const samples = weather.samples;
  const mean = (of: (s: WeatherTimeline['samples'][number]) => number) =>
    samples.reduce((sum, s) => sum + of(s), 0) / Math.max(1, samples.length);
  return {
    trackTempC: mean((s) => s.trackTempC),
    windKph: mean((s) => s.windKph),
    wetness: mean((s) => Math.max(...s.rain)),
  };
}

/** Where the optimum sits today: the factory preset moved by heat, wind and water. */
export function idealSetup(track: PackTrack, conditions: SetupConditions): Setup {
  const i = balance.setup.ideal;
  const heat = conditions.trackTempC - i.referenceTrackTempC;
  const wind = conditions.windKph - i.windReferenceKph;
  const wet = Math.max(0, Math.min(1, conditions.wetness));
  const ideal = {} as Setup;
  for (const p of SETUP_PARAMETERS) {
    const moved =
      track.factorySetup[p] + heat * i.perTrackTempC[p] + wind * i.perWindKph[p] + wet * i.perWetness[p];
    ideal[p] = clamp(moved);
  }
  return ideal;
}

/**
 * Seconds a lap one parameter costs at this distance from its optimum. Nothing inside the plateau,
 * then it grows with the square of the distance and stops at what the parameter is worth: a slider
 * at the wrong end of the scale is as bad as it gets, and no worse (plan 5.2).
 */
export function parameterLossS(parameter: SetupParameter, deviation: number): number {
  const l = balance.setup.loss;
  const over = Math.max(0, Math.abs(deviation) - l.plateau * l.tolerance);
  const scale = Math.max(1e-9, l.tolerance * (1 - l.plateau));
  return l.seconds[parameter] * Math.min(1, (over / scale) ** l.exponent);
}

/** What this setup costs a lap against the optimum: the sum over the nine parameters. */
export function setupLossS(setup: Setup, ideal: Setup): number {
  let loss = 0;
  for (const p of SETUP_PARAMETERS) loss += parameterLossS(p, setup[p] - ideal[p]);
  return loss;
}

/** What the car and the crew around it can actually dial in (plan 5.2, read per car). */
export type SetupCapability = {
  /** The race engineer of this car, 0..100. */
  engineerSkill: number;
  /** The team's simulator, 1..5. */
  simulatorLevel: number;
  /** The driver's ability to say what the car is doing, 0..100. */
  feedback: number;
  /** The game setting of 5.2: every slider moves, and the engineer says nothing about the rest. */
  expertMode?: boolean;
};

/** The highest level this car can dial in. */
export function setupLevelOf(capability: SetupCapability): SetupLevel {
  const a = balance.setup.access;
  if (
    capability.engineerSkill >= a.fineEngineer &&
    capability.simulatorLevel >= a.fineSimulator &&
    capability.feedback >= a.fineFeedback
  )
    return 'fine';
  if (capability.engineerSkill >= a.mechanicEngineer || capability.simulatorLevel >= a.mechanicSimulator)
    return 'mechanical';
  return 'base';
}

const ORDER: readonly SetupLevel[] = ['base', 'mechanical', 'fine'];

/** Which parameters this car may move. In expert mode, all of them (plan 5.2). */
export function openParameters(capability: SetupCapability): Set<SetupParameter> {
  if (capability.expertMode) return new Set(SETUP_PARAMETERS);
  const reached = ORDER.indexOf(setupLevelOf(capability));
  return new Set(SETUP_PARAMETERS.filter((p) => ORDER.indexOf(SETUP_LEVEL[p]) <= reached));
}

/** A setup that leaves closed parameters where the factory left them. */
export function withinAccess(chosen: Setup, factory: Setup, open: ReadonlySet<SetupParameter>): Setup {
  const setup = {} as Setup;
  for (const p of SETUP_PARAMETERS) setup[p] = clamp(open.has(p) ? chosen[p] : factory[p]);
  return setup;
}

const clamp = (value: number) => Math.max(0, Math.min(100, value));
