import { describe, expect, it } from 'vitest';
import { createRng } from '../rng/rng';
import { fingerprint } from '../util/hash';
import { chooseByScore, type DecisionMakerProfile, type Evaluation, profileFromAttributes } from './decide';

// Five options whose true quality is known: 'e' is best, each step down loses 5%.
const OPTIONS = ['a', 'b', 'c', 'd', 'e'] as const;
const TRUE_SCORE: Record<(typeof OPTIONS)[number], number> = { a: 0.8, b: 0.85, c: 0.9, d: 0.95, e: 1 };
const evaluate = (o: (typeof OPTIONS)[number]): Evaluation => ({
  score: TRUE_SCORE[o],
  reasons: [`reason.${o}`],
});

const STRONG: DecisionMakerProfile = { skill: 1, consistency: 1, rapport: 0 };
const WEAK: DecisionMakerProfile = { skill: 0.1, consistency: 0.1, rapport: 0 };

function outcomes(profile: DecisionMakerProfile, runs = 3000) {
  const rng = createRng('decide', `test:${profile.skill}:${profile.consistency}`);
  return Array.from(
    { length: runs },
    () => TRUE_SCORE[chooseByScore(OPTIONS, evaluate, profile, rng).choice],
  );
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)));

describe('chooseByScore', () => {
  it('lets a strong decision maker land at 90–97%+ of the best achievable result', () => {
    const strong = outcomes(STRONG);
    expect(mean(strong)).toBeGreaterThan(0.95);
    expect(strong.filter((s) => s === 1).length / strong.length).toBeGreaterThan(0.6);
  });

  it('makes a weak decision maker worse mostly through spread', () => {
    const [strong, weak] = [outcomes(STRONG), outcomes(WEAK)];
    expect(mean(weak)).toBeLessThan(mean(strong));
    expect(sd(weak)).toBeGreaterThan(2 * sd(strong));
    // Still not hopeless: the average stays well above the worst option.
    expect(mean(weak)).toBeGreaterThan(0.86);
  });

  it('narrows the gap with rapport', () => {
    const middling = { skill: 0.4, consistency: 1, rapport: 0 };
    expect(mean(outcomes({ ...middling, rapport: 1 }))).toBeGreaterThan(mean(outcomes(middling)));
  });

  it('reports every option it considered, with perceived scores and reasons', () => {
    const decision = chooseByScore(OPTIONS, evaluate, STRONG, createRng('s', 'x'));
    expect(decision.considered.map((c) => c.option)).toEqual([...OPTIONS]);
    expect(decision.considered.map((c) => c.reasons)).toEqual(OPTIONS.map((o) => [`reason.${o}`]));
    const top = decision.considered.reduce((a, b) => (b.score > a.score ? b : a));
    expect(decision.choice).toBe(top.option);
  });

  it('is deterministic: same inputs and stream → same decision', () => {
    const run = () => chooseByScore(OPTIONS, evaluate, WEAK, createRng('M1', 'decide:fixture'));
    expect(fingerprint(run())).toBe(fingerprint(run()));
    expect(fingerprint(run())).toBe('1a8ffb56ec1cb5');
  });

  it('refuses an empty option list', () => {
    expect(() => chooseByScore([], evaluate, STRONG, createRng('s', 'x'))).toThrow(RangeError);
  });
});

describe('profileFromAttributes', () => {
  it('maps 1..100 staff attributes onto 0..1', () => {
    expect(profileFromAttributes({ skill: 100, consistency: 1 })).toEqual({
      skill: 1,
      consistency: 0,
      rapport: 0,
    });
    expect(profileFromAttributes({ skill: 50.5, consistency: 50.5 }, 2).rapport).toBe(1);
  });
});
