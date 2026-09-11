import { useState } from 'react';

/**
 * Keeps the previous value while its signature is unchanged. The race frame is rebuilt 60 times a
 * second, but the timing board only changes at timing lines: with a stable reference, memoised
 * children skip the frames where nothing they show has moved.
 */
export function useStable<T>(value: T, signature: string): T {
  const [held, setHeld] = useState({ signature, value });
  if (held.signature !== signature) {
    // Storing information from previous renders: React re-renders at once with the new value.
    setHeld({ signature, value });
    return value;
  }
  return held.value;
}
