import { useEffect } from 'react';
import { useRace } from '@/app/store/race';

/** Longest real-time step taken in one frame: a backgrounded tab does not jump the race ahead. */
const MAX_STEP_MS = 250;

/** Drives the race clock from the browser's frames while a race is on screen. */
export function usePlaybackClock(active: boolean) {
  const tick = useRace((s) => s.tick);
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      tick(Math.min(MAX_STEP_MS, now - last));
      last = now;
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [active, tick]);
}
