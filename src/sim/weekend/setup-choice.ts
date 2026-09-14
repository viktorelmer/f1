/**
 * Choosing a setup (docs/systems/setup.md, plan 5.2, 5.19). The options are exactly the four
 * sources of the autosetup plus the steps the last run suggested; the score is the lap time the
 * engineer *expects* to lose, read off his own recommendation — never off the hidden optimum.
 *
 * The player's delegate and a rival's engineer run this same function; the player picking a button
 * on the setup screen is picking one of these options by hand.
 */
import { balance } from '@/data/balance';
import { SETUP_PARAMETERS, type SetupParameter } from '@/data/schema/pack';
import { chooseByScore, type Decide, type Evaluation } from '../decide/decide';
import { openParameters, parameterLossS, type Setup, type SetupCapability, withinAccess } from '../car/setup';
import type { SetupNote, SetupReading } from './setup-knowledge';

/** What the weekend is being set up for: a lap on Saturday or a race distance on Sunday. */
export type SetupGoal = 'qualifying' | 'race';

export type SetupContext = {
  /** The engineer's reading of the optimum — the only view of it anyone has. */
  reading: SetupReading;
  /** The factory preset of this track: where a closed slider stays. */
  factory: Setup;
  /** What the car is on right now. */
  current: Setup;
  /** What the driver said after the last run, if anything. */
  notes: readonly SetupNote[];
  /** The team-mate's car, when there is one worth copying. */
  teamMate?: Setup;
  /** A setup the player saved for this track in an earlier season. */
  saved?: Setup;
  capability: SetupCapability;
};

/** A named candidate setup, so the screen can say where each button's numbers come from. */
export type SetupOption = { source: SetupSource; setup: Setup };
export type SetupSource = 'engineer' | 'factory' | 'team-mate' | 'saved' | 'stay' | 'driver-note';

/**
 * What the engineer believes this setup costs: the same loss curve the track will apply, but
 * measured against his recommendation instead of the truth. He can be wrong — that is the point.
 */
export function expectedLossS(setup: Setup, reading: SetupReading): number {
  let loss = 0;
  for (const p of SETUP_PARAMETERS) loss += parameterLossS(p, setup[p] - reading[p].value);
  return loss;
}

/** The candidates: the four sources of 5.2, staying put, and the steps the driver asked for. */
export function setupOptions(context: SetupContext): SetupOption[] {
  const open = openParameters(context.capability);
  const shape = (setup: Setup) => withinAccess(setup, context.factory, open);
  const recommended = {} as Setup;
  for (const p of SETUP_PARAMETERS) recommended[p] = context.reading[p].value;

  const options: SetupOption[] = [
    { source: 'engineer', setup: shape(recommended) },
    { source: 'factory', setup: shape(context.factory) },
    { source: 'stay', setup: shape(context.current) },
  ];
  if (context.teamMate) options.push({ source: 'team-mate', setup: shape(context.teamMate) });
  if (context.saved) options.push({ source: 'saved', setup: shape(context.saved) });

  // What the driver asked for: the current car, nudged the way he said, as far as the window allows.
  const step = balance.setup.loss.tolerance * balance.setup.loss.plateau;
  for (const note of context.notes) {
    if (!open.has(note.parameter)) continue;
    const moved = { ...context.current };
    moved[note.parameter] = clamp(
      context.current[note.parameter] + (note.direction === 'more' ? step : -step),
    );
    options.push({ source: 'driver-note', setup: shape(moved) });
  }
  return options;
}

/**
 * The engineer's call. A race setup is judged on the whole distance, so it leans on what the
 * recommendation is sure about; a qualifying setup chases the reading even where it is loose.
 */
export const decideSetup: Decide<SetupContext, SetupGoal, SetupOption> = (
  context,
  competence,
  intent,
  rng,
) => {
  const options = setupOptions(context);
  const losses = new Map(options.map((o) => [o, expectedLossS(o.setup, context.reading)] as const));
  const best = Math.min(...losses.values());
  const worst = Math.max(...losses.values());
  const span = Math.max(1e-6, worst - best);
  const evaluate = (option: SetupOption): Evaluation => ({
    score: 1 - (losses.get(option)! - best) / span,
    reasons: [`setup.source.${option.source}`, `setup.goal.${intent.goal}`],
  });
  return chooseByScore(options, evaluate, competence, rng);
};

const clamp = (value: number) => Math.max(0, Math.min(100, value));

export type { SetupParameter };
