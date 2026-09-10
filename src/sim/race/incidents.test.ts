import { describe, expect, it } from 'vitest';
import { balance } from '@/data/balance';
import { createRng } from '../rng/rng';
import {
  failureChancePerLap,
  mistakeChancePerLap,
  mistakeOutcome,
  pitLaneFactor,
  punctureChancePerLap,
  raceControlResponse,
  stationaryTimeS,
} from './incidents';

const N = 20_000;

describe('pit stops', () => {
  it('are quicker with a better crew and never below the floor', () => {
    const mean = (crew: number) => {
      const rng = createRng('pit', `crew-${crew}`);
      let sum = 0;
      for (let i = 0; i < 2000; i++) sum += stationaryTimeS(crew, rng).seconds;
      return sum / 2000;
    };
    expect(mean(95)).toBeLessThan(mean(60));
    const rng = createRng('pit', 'floor');
    for (let i = 0; i < 2000; i++)
      expect(stationaryTimeS(100, rng).seconds).toBeGreaterThanOrEqual(balance.race.pit.minStationaryS);
  });

  it('go slow at about the configured rate', () => {
    const rng = createRng('pit', 'slow');
    let slow = 0;
    for (let i = 0; i < N; i++) if (stationaryTimeS(80, rng).slow) slow++;
    expect(slow / N).toBeCloseTo(balance.race.pit.slowStopChance, 2);
  });

  it('cost less of the pit lane under SC and VSC', () => {
    expect(pitLaneFactor('sc')).toBeLessThan(pitLaneFactor('vsc'));
    expect(pitLaneFactor('vsc')).toBeLessThan(pitLaneFactor('green'));
  });
});

describe('driver mistakes', () => {
  const base = { consistency: 85, wetness: 0, gripDeficitS: 0, fatigue: 10 };

  it('are rarer for a consistent driver and likelier in the wet, on the wrong tyre and when tired', () => {
    const p = mistakeChancePerLap(base);
    expect(mistakeChancePerLap({ ...base, consistency: 95 })).toBeLessThan(p);
    expect(mistakeChancePerLap({ ...base, wetness: 0.8 })).toBeGreaterThan(p);
    expect(mistakeChancePerLap({ ...base, gripDeficitS: 3 })).toBeGreaterThan(p);
    expect(mistakeChancePerLap({ ...base, fatigue: 70 })).toBeGreaterThan(p);
  });

  it('end in the barrier more often on a street circuit', () => {
    const crashes = (profile: number) => {
      const rng = createRng('mistake', `p-${profile}`);
      let n = 0;
      for (let i = 0; i < N; i++) if (mistakeOutcome(rng, profile).kind === 'crash') n++;
      return n / N;
    };
    expect(crashes(0.85)).toBeGreaterThan(1.5 * crashes(0.2));
  });
});

describe('mechanical failures and punctures', () => {
  it('compound per lap to the per-race failure rate', () => {
    const laps = 57;
    const perLap = failureChancePerLap(0.85, laps);
    const perRace = 1 - (1 - perLap) ** laps;
    expect(perRace).toBeCloseTo(balance.race.reliability.failureScale * 0.15, 10);
    expect(failureChancePerLap(0.9, laps)).toBeLessThan(failureChancePerLap(0.8, laps));
  });

  it('puncture a tyre past its cliff far more often', () => {
    expect(punctureChancePerLap(0.9, 0.72)).toBeGreaterThan(5 * punctureChancePerLap(0.3, 0.72));
  });
});

describe('race control', () => {
  it('sends the safety car for a crash more often on a street circuit', () => {
    const share = (profile: number) => {
      const rng = createRng('rc', `crash-${profile}`);
      let sc = 0;
      for (let i = 0; i < N; i++) if (raceControlResponse('crash', profile, rng) === 'sc') sc++;
      return sc / N;
    };
    expect(share(0.85)).toBeGreaterThan(share(0.2) + 0.4);
  });

  it('mostly answers a stranded car with a VSC or nothing', () => {
    const rng = createRng('rc', 'stopped');
    const counts = { sc: 0, vsc: 0, none: 0 };
    for (let i = 0; i < N; i++) {
      const r = raceControlResponse('stopped-car', 0.4, rng);
      counts[r ?? 'none']++;
    }
    expect(counts.vsc).toBeGreaterThan(counts.sc);
    expect(counts.none).toBeGreaterThan(counts.sc);
  });
});
