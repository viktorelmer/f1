/**
 * What a team knows about its own setup (docs/systems/setup.md, plan 5.2). The optimum is hidden;
 * the race engineer reads it and hands the player a range per parameter, and the driver comes back
 * from a run with a direction, not a number.
 *
 * Precision comes from the engineer, the simulator, the driver's feedback and the laps already run
 * here — the same four things the plan names. Truth is touched in one place only: `measure()`.
 */
import { balance } from '@/data/balance';
import { SETUP_PARAMETERS } from '@/data/schema/pack';
import { measure, observe, refine } from '../knowledge/estimate';
import type { Rng } from '../rng/rng';
import type { GameDate } from '../types/game-date';
import type { SetupNote, SetupReading } from '../types/world';
import type { Setup, SetupCapability } from '../car/setup';

export type { SetupNote, SetupReading };

/**
 * How wide the engineer's reading is, in points of the scale. Every source of precision takes its
 * own bite out of the base; laps close the rest exponentially, and nothing goes under the floor —
 * the centre of the window is not knowable, and with the plateau in the loss it need not be.
 */
export function setupReadingSd(capability: SetupCapability, setupLaps: number): number {
  const r = balance.setup.reading;
  const fromPeople =
    r.baseSd -
    r.perEngineerPoint * (capability.engineerSkill - r.engineerRef) -
    r.perSimulatorLevel * capability.simulatorLevel -
    r.perFeedbackPoint * (capability.feedback - r.feedbackRef);
  const laps = Math.exp(-Math.max(0, setupLaps) / r.lapScale);
  return Math.max(r.minSd, fromPeople * laps + r.minSd * (1 - laps));
}

/** The first reading of the weekend: what the engineer says before the car has turned a wheel. */
export function readSetup(
  ideal: Setup,
  capability: SetupCapability,
  at: GameDate,
  rng: Rng,
  setupLaps = 0,
): SetupReading {
  const sd = setupReadingSd(capability, setupLaps);
  const quantity = balance.estimate.quantities['car.setupParameter'];
  const reading = {} as SetupReading;
  for (const p of SETUP_PARAMETERS)
    reading[p] = observe(ideal[p], { sd, bias: 0 }, rng, { quantity, at, sources: ['simulator'] });
  return reading;
}

/**
 * What the run taught the engineer: another measurement of the same optimum, fused into the
 * reading. More laps mean a tighter measurement, so the range narrows as the session goes.
 */
export function refineSetup(
  prior: SetupReading,
  ideal: Setup,
  capability: SetupCapability,
  setupLaps: number,
  at: GameDate,
  rng: Rng,
): SetupReading {
  if (setupLaps <= 0) return prior;
  const sd = setupReadingSd(capability, setupLaps);
  const reading = {} as SetupReading;
  for (const p of SETUP_PARAMETERS)
    reading[p] = refine(prior[p], measure(ideal[p], { sd, bias: 0 }, rng, at));
  return reading;
}

/**
 * The driver's read of the car after a run (plan 5.2). Only parameters far enough out to be felt
 * are reported, worst first; a driver who cannot describe a car blames the wrong one sometimes —
 * the deviation he felt is real, the parameter he names is not.
 */
export function driverNotes(
  setup: Setup,
  ideal: Setup,
  capability: SetupCapability,
  rng: Rng,
  limit = 2,
): SetupNote[] {
  const f = balance.setup.feedback;
  const wrong = Math.max(
    f.minWrongCause,
    f.wrongCauseAtRef - f.perFeedbackPoint * (capability.feedback - balance.setup.reading.feedbackRef),
  );
  const felt = SETUP_PARAMETERS.map((parameter) => ({
    parameter,
    deviation: setup[parameter] - ideal[parameter],
  }))
    .filter((entry) => Math.abs(entry.deviation) >= f.noticeableDeviation)
    .sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation))
    .slice(0, limit);

  return felt.map((entry) => {
    const direction = entry.deviation > 0 ? ('less' as const) : ('more' as const);
    if (rng.next() >= wrong) return { parameter: entry.parameter, direction, trusted: true };
    // The car did something; the driver names the wrong reason for it.
    const others = SETUP_PARAMETERS.filter((p) => p !== entry.parameter);
    return { parameter: others[Math.floor(rng.next() * others.length)]!, direction, trusted: false };
  });
}
