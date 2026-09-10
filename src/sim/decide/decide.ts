/**
 * The one decision contract (plan 5.19, docs/systems/decide.md). A player's delegate and a rival
 * team's AI are the same code: each system exposes a `Decide` function, called with the deciding
 * staff member's profile and either the player's instruction or the rival's team character.
 */
import { balance } from '@/data/balance';
import type { Rng } from '../rng/rng';

/** Who is deciding, derived from a staff member's attributes. All 0..1. */
export type DecisionMakerProfile = {
  /** How close to the best option they land. */
  readonly skill: number;
  /** How rarely they badly misjudge an option. */
  readonly consistency: number;
  /** Working relationship with the player: narrows the gap to what the player would have picked. */
  readonly rapport: number;
};

/** What the decision should achieve: the player's instruction, or a rival's team character. */
export type Intent<TGoal extends string> = {
  readonly goal: TGoal;
  /** Appetite for risk, 0..1. */
  readonly risk: number;
  readonly issuedBy: 'player' | 'team-character';
};

/** An option as the decision maker saw it. Reasons are i18n keys for the rationale. */
export type ScoredOption<T> = {
  readonly option: T;
  /** Perceived score: what the decision maker believed, not the truth. */
  readonly score: number;
  readonly reasons: readonly string[];
};

/** The choice plus everything considered: rationale is always visible (plan 5.19, rule 1). */
export type Decision<T> = {
  readonly choice: T;
  readonly considered: readonly ScoredOption<T>[];
};

export type Decide<TContext, TGoal extends string, TChoice> = (
  context: TContext,
  competence: DecisionMakerProfile,
  intent: Intent<TGoal>,
  rng: Rng,
) => Decision<TChoice>;

/** A system's verdict on one option under the intent. */
export type Evaluation = {
  /** Fraction of the best achievable outcome, 0..1. */
  readonly score: number;
  readonly reasons: readonly string[];
};

/**
 * The shared chooser behind every `Decide`: the decision maker sees each option's score through
 * noise that shrinks with skill (and rapport), occasionally blunders on one option (less often the
 * more consistent they are), and picks what looks best. Draws a fixed number of values per option,
 * so the outcome depends only on the inputs and the stream.
 */
export function chooseByScore<T>(
  options: readonly T[],
  evaluate: (option: T) => Evaluation,
  competence: DecisionMakerProfile,
  rng: Rng,
): Decision<T> {
  if (options.length === 0) throw new RangeError('chooseByScore needs at least one option');
  const tuning = balance.decide;

  const noiseSd =
    lerp(tuning.noiseSdAtSkill0, tuning.noiseSdAtSkill1, unit(competence.skill)) *
    (1 - tuning.rapportNoiseReduction * unit(competence.rapport));
  const blunderChance = lerp(
    tuning.blunderChanceAtConsistency0,
    tuning.blunderChanceAtConsistency1,
    unit(competence.consistency),
  );

  const considered = options.map((option): ScoredOption<T> => {
    const { score, reasons } = evaluate(option);
    const noise = rng.normal(0, noiseSd);
    const blunder = rng.chance(blunderChance) ? (rng.chance(0.5) ? 1 : -1) * tuning.blunderSize : 0;
    return { option, score: score + noise + blunder, reasons };
  });

  let best = considered[0]!;
  for (const candidate of considered) if (candidate.score > best.score) best = candidate;
  return { choice: best.option, considered };
}

/** A staff member's 1..100 attributes as a decision-maker profile. */
export function profileFromAttributes(
  attributes: { readonly skill: number; readonly consistency: number },
  rapport = 0,
): DecisionMakerProfile {
  return {
    skill: unit((attributes.skill - 1) / 99),
    consistency: unit((attributes.consistency - 1) / 99),
    rapport: unit(rapport),
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function unit(x: number): number {
  return Math.min(1, Math.max(0, x));
}
