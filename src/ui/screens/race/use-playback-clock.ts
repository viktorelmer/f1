import { useEffect } from 'react';
import { MAX_STEP_MS } from '@/app/store/playback';

/**
 * Drives a session clock from the browser's frames while it is on screen: the race, practice or
 * qualifying — whichever store's `tick` is handed in.
 */
export function usePlaybackClock(active: boolean, tick: (realMs: number) => void) {
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
