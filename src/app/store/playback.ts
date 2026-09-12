/** Playback speeds of plan 3.4: a session on screen runs at ×1, ×2, ×5 or ×15 of real time. */
export const SPEEDS = [1, 2, 5, 15] as const;
export type Speed = (typeof SPEEDS)[number];

/** Longest real-time step a clock takes in one frame: a backgrounded tab does not jump ahead. */
export const MAX_STEP_MS = 250;
