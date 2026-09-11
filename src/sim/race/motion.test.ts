import { describe, expect, it } from 'vitest';
import { loadActivePack } from '@/data/packs/active';
import { fractionAtTimeShare, lapMotion, timeShareAt } from './motion';

const pack = loadActivePack();
const motions = pack.tracks.map((track) => ({
  track,
  motion: lapMotion(
    track,
    pack.geometry.find((g) => g.trackId === track.id)!,
  ),
}));

/** Speed at each sample, km/h, from the profile. */
function speeds({ track, motion }: (typeof motions)[number]): number[] {
  const count = motion.timeShare.length - 1;
  const stepM = (track.lengthKm * 1000) / count;
  return motion.timeShare.slice(1).map((s, i) => (stepM / ((s - motion.timeShare[i]!) * motion.lapS)) * 3.6);
}

describe('lapMotion', () => {
  it('implies a lap time close to the track’s own: the motion constants are physical', () => {
    for (const { track, motion } of motions) {
      expect(motion.lapS / track.baseLapTime, track.id).toBeGreaterThan(0.8);
      expect(motion.lapS / track.baseLapTime, track.id).toBeLessThan(1.2);
    }
  });

  it('slows the car for corners and lets it run on the straights', () => {
    for (const m of motions) {
      const v = speeds(m);
      expect(Math.min(...v), m.track.id).toBeLessThan(0.45 * Math.max(...v));
      expect(Math.max(...v), m.track.id).toBeGreaterThan(280);
    }
  });

  it('maps lap distance to lap time and back', () => {
    const { motion } = motions[0]!;
    let previous = -1;
    for (let f = 0; f <= 1; f += 0.01) {
      const share = timeShareAt(motion, f);
      expect(share).toBeGreaterThanOrEqual(previous);
      expect(fractionAtTimeShare(motion, share)).toBeCloseTo(f, 6);
      previous = share;
    }
    expect(timeShareAt(motion, 0)).toBe(0);
    expect(timeShareAt(motion, 1)).toBe(1);
  });
});
