import { describe, expect, it } from 'vitest';
import { loadDefaultPack } from '@/data/packs/default';
import type { PackTrack } from '@/data/schema/pack';
import { createRng } from '../rng/rng';
import { fingerprint } from '../util/hash';
import { prepareTrack } from './track';
import type { WeatherTimeline } from './types';
import {
  advanceSurface,
  generateWeather,
  greenTrackFraction,
  initialSurface,
  sampleAt,
  windSeconds,
} from './weather';

const pack = loadDefaultPack();
const base = pack.tracks.find((t) => t.id === 'northfield')!;
const withRain = (rainChance: number): PackTrack => ({ ...base, weather: { ...base.weather, rainChance } });

describe('generateWeather', () => {
  it('is deterministic: seed + track → fixed timeline', () => {
    const run = () => generateWeather(base, createRng('M2', 'race:2027:r10:weather'));
    expect(fingerprint(run())).toBe(fingerprint(run()));
    expect(fingerprint(run())).toBe('125f62f8781201');
  });

  it('never rains at a track with no rain chance', () => {
    for (let i = 0; i < 50; i++) {
      const w = generateWeather(withRain(0), createRng(`dry-${i}`, 'weather'));
      expect(w.samples.every((s) => s.rain.every((r) => r === 0))).toBe(true);
    }
  });

  it('rains in about the share of races the track’s rain chance says', () => {
    const N = 400;
    let wet = 0;
    for (let i = 0; i < N; i++) {
      const w = generateWeather(withRain(0.4), createRng(`share-${i}`, 'weather'));
      if (w.samples.some((s) => s.rain.some((r) => r > 0))) wet++;
    }
    expect(wet / N).toBeGreaterThan(0.33);
    expect(wet / N).toBeLessThan(0.47);
  });

  it('brings rain to the sectors at different times', () => {
    for (let i = 0; i < 200; i++) {
      const w = generateWeather(withRain(1), createRng(`front-${i}`, 'weather'));
      const firstWet = [0, 1, 2].map((k) => w.samples.find((s) => s.rain[k]! > 0)?.minute ?? Infinity);
      if (firstWet.every(Number.isFinite)) {
        expect(new Set(firstWet).size).toBeGreaterThan(1);
        return;
      }
    }
    throw new Error('no full rain episode in 200 seeds');
  });

  it('keeps the asphalt warmer than the air in the sun and cools it under cloud', () => {
    const w = generateWeather(withRain(0), createRng('sun', 'weather'));
    const sunny = w.samples.filter((s) => s.cloud < 0.3);
    const cloudy = w.samples.filter((s) => s.cloud > 0.7);
    for (const s of w.samples) expect(s.trackTempC).toBeGreaterThanOrEqual(s.airTempC - 1);
    if (sunny.length && cloudy.length) {
      const offset = (xs: typeof sunny) => xs.reduce((a, s) => a + s.trackTempC - s.airTempC, 0) / xs.length;
      expect(offset(sunny)).toBeGreaterThan(offset(cloudy));
    }
  });

  it('holds the last sample past the end of the timeline', () => {
    const w = generateWeather(base, createRng('end', 'weather'));
    expect(sampleAt(w, 1e6)).toBe(w.samples[w.samples.length - 1]);
    expect(sampleAt(w, -5)).toBe(w.samples[0]);
  });
});

describe('the surface during a race', () => {
  const rainy: WeatherTimeline = {
    samples: Array.from({ length: 121 }, (_, minute) => {
      const r = minute >= 10 && minute < 40 ? 0.8 : 0;
      return {
        minute,
        airTempC: 18,
        trackTempC: 22,
        humidity: 90,
        windKph: 10,
        windFromDeg: 0,
        cloud: 1,
        rain: [r, r, r],
      };
    }),
  };

  it('gets wet in the rain and dries after it', () => {
    let s = initialSurface(rainy);
    expect(s.wetness).toEqual([0, 0, 0]);
    s = advanceSurface(s, rainy, 40 * 60, 0);
    expect(s.wetness[0]).toBeGreaterThan(0.9);
    const afterRain = s.wetness[0];
    s = advanceSurface(s, rainy, 80 * 60, 0);
    expect(s.wetness[0]).toBeLessThan(afterRain);
  });

  it('rubbers in with laps and washes out with rain', () => {
    const dry = {
      samples: rainy.samples.map((x) => ({ ...x, rain: [0, 0, 0] as [number, number, number] })),
    };
    const start = initialSurface(dry);
    expect(advanceSurface(start, dry, 60, 100).grip).toBeGreaterThan(start.grip);
    expect(advanceSurface(start, rainy, 40 * 60, 0).grip).toBeLessThan(start.grip);
  });

  it('costs time on a green track in proportion to the track’s evolution factor', () => {
    const street = prepareTrack(
      pack.tracks.find((t) => t.id === 'marina-lights')!,
      pack.geometry.find((g) => g.trackId === 'marina-lights')!,
    );
    const open = prepareTrack(
      pack.tracks.find((t) => t.id === 'valles')!,
      pack.geometry.find((g) => g.trackId === 'valles')!,
    );
    expect(greenTrackFraction(street, 0)).toBeGreaterThan(greenTrackFraction(open, 0));
    expect(greenTrackFraction(street, 1)).toBe(0);
  });

  it('makes a headwind sector slower than a tailwind one', () => {
    const model = prepareTrack(
      base,
      pack.geometry.find((g) => g.trackId === base.id)!,
    );
    const sector = model.sectors.reduce((a, b) => (b.straightShare > a.straightShare ? b : a));
    const heading = (Math.atan2(sector.straight[1], sector.straight[0]) * 180) / Math.PI;
    // Bearing the straight points to, clockwise from north (SVG: x east, y south).
    const towards = (90 + heading + 360) % 360;
    const sample = { ...rainy.samples[0]!, windKph: 30 };
    const tail = windSeconds(sector, { ...sample, windFromDeg: (towards + 180) % 360 });
    const head = windSeconds(sector, { ...sample, windFromDeg: towards });
    expect(head).toBeGreaterThan(tail);
  });
});
