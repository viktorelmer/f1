/**
 * Deterministic random numbers (plan section 3.3, docs/systems/rng.md).
 *
 * One seed per playthrough; every process draws from its own named stream, derived afresh from
 * (seed, name). Streams are stateless between processes, so RNG state never goes into a save, and
 * adding a new system never shifts the randomness of existing ones.
 *
 * Generator: xoshiro128** (32-bit arithmetic only). Stream seeding: cyrb128 hash of seed and name.
 */

export type Rng = {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform 32-bit unsigned integer. */
  nextUint32(): number;
  /** Uniform integer in [min, max], both ends inclusive. */
  int(min: number, max: number): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  chance(probability: number): boolean;
  /** Normally distributed (Marsaglia polar method). */
  normal(mean: number, sd: number): number;
  pick<T>(items: readonly T[]): T;
};

/** Returns the stream factory for one playthrough: `rng('race:2027:r05:incidents')`. */
export function streams(seed: string): (name: string) => Rng {
  return (name) => createRng(seed, name);
}

export function createRng(seed: string, stream: string): Rng {
  // A NUL separator cannot appear in either part, so ("a", "b:c") and ("a:b", "c") differ.
  const [a, b, c, d] = cyrb128(`${seed}\u0000${stream}`);
  return fromState(a, b, c, d);
}

const TWO_POW_32 = 4_294_967_296;

/** Exposed for the reference-vector test; use `streams()` everywhere else. */
export function fromState(a: number, b: number, c: number, d: number): Rng {
  // xoshiro128** must not start from the all-zero state.
  if ((a | b | c | d) === 0) a = 1;

  function nextUint32(): number {
    const result = Math.imul(rotl(Math.imul(b, 5), 7), 9);
    const t = b << 9;
    c ^= a;
    d ^= b;
    b ^= c;
    a ^= d;
    c ^= t;
    d = rotl(d, 11);
    return result >>> 0;
  }

  const next = () => nextUint32() / TWO_POW_32;

  const rng: Rng = {
    next,
    nextUint32,
    int(min, max) {
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
        throw new RangeError(`int(${min}, ${max}): need integers with min <= max`);
      }
      return min + Math.floor(next() * (max - min + 1));
    },
    range(min, max) {
      return min + next() * (max - min);
    },
    chance(probability) {
      return next() < probability;
    },
    normal(mean, sd) {
      let u: number;
      let v: number;
      let s: number;
      do {
        u = next() * 2 - 1;
        v = next() * 2 - 1;
        s = u * u + v * v;
      } while (s >= 1 || s === 0);
      return mean + sd * u * Math.sqrt((-2 * Math.log(s)) / s);
    },
    pick(items) {
      if (items.length === 0) throw new RangeError('pick() from an empty list');
      return items[Math.floor(next() * items.length)]!;
    },
  };
  return rng;
}

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}

/** cyrb128 by bryc (public domain): a fast 128-bit string hash, used only to seed streams. */
function cyrb128(text: string): [number, number, number, number] {
  let h1 = 1_779_033_703;
  let h2 = 3_144_134_277;
  let h3 = 1_013_904_242;
  let h4 = 2_773_480_762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597_399_067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2_869_860_233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951_274_213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2_716_044_179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597_399_067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2_869_860_233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951_274_213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2_716_044_179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}
