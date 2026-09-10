import { describe, expect, it } from 'vitest';
import { hashString } from '../util/hash';
import { createRng, fromState, streams } from './rng';

function firstUint32s(seed: string, stream: string, n: number): number[] {
  const rng = createRng(seed, stream);
  return Array.from({ length: n }, () => rng.nextUint32());
}

describe('xoshiro128**', () => {
  it('matches the reference implementation for state (1, 2, 3, 4)', () => {
    const rng = fromState(1, 2, 3, 4);
    expect([rng.nextUint32(), rng.nextUint32(), rng.nextUint32(), rng.nextUint32()]).toEqual([
      11_520, 0, 5_927_040, 70_819_200,
    ]);
  });
});

describe('named streams', () => {
  it('are deterministic: seed + name → fixed sequence hash', () => {
    // Pinned. If this changes, every seeded result in the game changes with it.
    expect(hashString(firstUint32s('M1-seed', 'world:hidden:driver:r-hart', 1000).join(','))).toBe(
      '0f9ee677e42512',
    );
  });

  it('restart from the same state every time they are created', () => {
    expect(firstUint32s('s', 'race:2027:r01:incidents', 50)).toEqual(
      firstUint32s('s', 'race:2027:r01:incidents', 50),
    );
  });

  it('differ by name and by seed', () => {
    const base = firstUint32s('s', 'a', 20);
    expect(firstUint32s('s', 'b', 20)).not.toEqual(base);
    expect(firstUint32s('t', 'a', 20)).not.toEqual(base);
    // The separator keeps (seed, name) pairs apart even when their concatenation matches.
    expect(firstUint32s('a b', 'c', 20)).not.toEqual(firstUint32s('a', 'b c', 20));
  });

  it('are exposed per playthrough through streams()', () => {
    const rng = streams('s');
    expect(rng('x').next()).toBe(createRng('s', 'x').next());
  });
});

describe('distributions', () => {
  const rng = createRng('dist', 'test');
  const N = 20_000;

  it('keeps int and range within bounds and covers the ends', () => {
    const ints = Array.from({ length: N }, () => rng.int(-2, 3));
    expect(Math.min(...ints)).toBe(-2);
    expect(Math.max(...ints)).toBe(3);
    for (let i = 0; i < N; i++) {
      const x = rng.range(5, 6);
      if (x < 5 || x >= 6) throw new Error(`range out of bounds: ${x}`);
    }
    expect(() => rng.int(3, 2)).toThrow(RangeError);
  });

  it('draws uniform values with mean ½ and variance 1/12', () => {
    const xs = Array.from({ length: N }, () => rng.next());
    const mean = xs.reduce((a, b) => a + b, 0) / N;
    const variance = xs.reduce((a, x) => a + (x - mean) ** 2, 0) / N;
    expect(mean).toBeCloseTo(0.5, 1);
    expect(variance).toBeCloseTo(1 / 12, 2);
  });

  it('draws normal values with the requested mean and sd', () => {
    const xs = Array.from({ length: N }, () => rng.normal(10, 2));
    const mean = xs.reduce((a, b) => a + b, 0) / N;
    const sd = Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / N);
    expect(mean).toBeGreaterThan(9.95);
    expect(mean).toBeLessThan(10.05);
    expect(sd).toBeGreaterThan(1.95);
    expect(sd).toBeLessThan(2.05);
  });

  it('respects probabilities in chance()', () => {
    const hits = Array.from({ length: N }, () => rng.chance(0.3)).filter(Boolean).length;
    expect(hits / N).toBeGreaterThan(0.28);
    expect(hits / N).toBeLessThan(0.32);
  });

  it('picks from lists and refuses empty ones', () => {
    expect(['a', 'b', 'c']).toContain(rng.pick(['a', 'b', 'c']));
    expect(() => rng.pick([])).toThrow(RangeError);
  });
});
