/**
 * A race on screen (docs/systems/race-screen.md): the engine computes the whole race, the store
 * keeps it as a replay and a playback clock — time, speed, pause. The UI turns (replay, time) into
 * a frame with `frameAt` and draws it.
 */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { buildReplay, type Replay } from '@/sim/race/replay';
import { createWorkerEngine, type RaceEngine } from '../worker/engine';
import { randomSeed, useCareer } from './career';

/** Playback speeds of plan 3.4. */
export const SPEEDS = [1, 2, 5, 15] as const;
export type Speed = (typeof SPEEDS)[number];

type RaceStore = {
  phase: 'setup' | 'loading' | 'ready' | 'error';
  round: number;
  seed: string;
  replay: Replay | null;
  timeS: number;
  speed: Speed;
  paused: boolean;
  error: string | null;
  setRound: (round: number) => void;
  setSeed: (seed: string) => void;
  start: () => Promise<void>;
  /** Advances the clock by real milliseconds, scaled by the playback speed. */
  tick: (realMs: number) => void;
  seek: (timeS: number) => void;
  setSpeed: (speed: Speed) => void;
  togglePause: () => void;
  restart: () => void;
  backToSetup: () => void;
};

let engine: RaceEngine | null = null;

/** Tests (and future hosts) supply their own engine; the browser uses the worker by default. */
export function setRaceEngine(next: RaceEngine) {
  engine = next;
}

export const useRace = create<RaceStore>()(
  immer((set, get) => ({
    phase: 'setup',
    round: 1,
    seed: randomSeed(),
    replay: null,
    timeS: 0,
    speed: 1,
    paused: false,
    error: null,

    setRound: (round) => set({ round }),
    setSeed: (seed) => set({ seed }),

    start: async () => {
      const { round, seed } = get();
      set({ phase: 'loading', error: null });
      try {
        engine ??= createWorkerEngine();
        const { input, result } = await engine.run(useCareer.getState().world, round, seed);
        // The replay is read-only data: stored as is, not drafted.
        set(() => ({ phase: 'ready', replay: buildReplay(input, result), timeS: 0, paused: false }));
      } catch (error) {
        set({ phase: 'error', error: error instanceof Error ? error.message : String(error) });
      }
    },

    tick: (realMs) => {
      const { replay, paused, speed, timeS } = get();
      if (!replay || paused || timeS >= replay.durationS) return;
      set({ timeS: Math.min(replay.durationS, timeS + (realMs / 1000) * speed) });
    },
    seek: (timeS) => {
      const { replay } = get();
      if (replay) set({ timeS: Math.max(0, Math.min(replay.durationS, timeS)) });
    },
    setSpeed: (speed) => set({ speed }),
    togglePause: () => set((s) => ({ paused: !s.paused })),
    restart: () => set({ timeS: 0, paused: false }),
    backToSetup: () => set({ phase: 'setup', replay: null, timeS: 0, seed: randomSeed() }),
  })),
);
