/**
 * A race on screen (docs/systems/race-screen.md, race-control.md): the engine computes the whole
 * race, the store keeps it as a replay and a playback clock — time, speed, pause. The UI turns
 * (replay, time) into a frame with `frameAt` and draws it.
 *
 * The player's side lives here too: how the team is run (control), and every command given, in
 * race time. A command is appended to the log and the race re-simulated from the start with the
 * same seed — identical up to the command, different after it — and playback carries on.
 */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { DelegationMode } from '@/sim/decide/delegation';
import { buildReplay, type Replay } from '@/sim/race/replay';
import type { PitAnswer, RaceCommand, RaceControl, StrategyDecision, StrategyPlan } from '@/sim/race/types';
import { createWorkerEngine, type RaceEngine } from '../worker/engine';
import type { PlanChoice } from '../worker/race-api';
import { randomSeed, useCareer } from './career';

/** Playback speeds of plan 3.4. */
export const SPEEDS = [1, 2, 5, 15] as const;
export type Speed = (typeof SPEEDS)[number];

/** A command as the player gives it: the store stamps it with the race time. */
export type PlayerCommand = RaceCommand extends infer C
  ? C extends RaceCommand
    ? Omit<C, 'timeS'>
    : never
  : never;

type RaceStore = {
  phase: 'setup' | 'loading' | 'ready' | 'error';
  round: number;
  seed: string;
  replay: Replay | null;
  timeS: number;
  speed: Speed;
  paused: boolean;
  error: string | null;
  /** How the player's team is run now (for the screen), and as it was at the start (for re-runs). */
  control: RaceControl;
  startControl: RaceControl;
  commands: RaceCommand[];
  /** Pause at the strategist's calls even when he decides (plan 5.19, rule 2), with a 10 s timer. */
  suggestWithPause: boolean;
  decisionTimer: boolean;
  /** The strategist's pre-race options, once worked out. */
  plans: PlanChoice | null;
  /** The call the race is paused on, and calls already put to the player. */
  pending: StrategyDecision | null;
  handled: string[];
  busy: boolean;
  setRound: (round: number) => void;
  setSeed: (seed: string) => void;
  loadPlans: () => Promise<void>;
  /** Before the start: the plan both cars run in manual strategy. */
  choosePlan: (plan: StrategyPlan) => void;
  setStrategy: (strategy: RaceControl['strategy']) => Promise<void>;
  setRadio: (radio: RaceControl['radio']) => Promise<void>;
  setSuggestWithPause: (on: boolean) => void;
  setDecisionTimer: (on: boolean) => void;
  start: () => Promise<void>;
  command: (command: PlayerCommand) => Promise<void>;
  /** Settles the paused call: 'accept' takes the strategist's pick. */
  answer: (answer: PitAnswer | 'accept') => Promise<void>;
  /** Advances the clock by real milliseconds, scaled by the playback speed; stops at a call to put. */
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

const decisionKey = (d: StrategyDecision) => `${d.driverId}@${d.timeS}`;

/** The control a career starts a race with: its delegation settings, neutral instructions. */
export function defaultControl(): RaceControl {
  const { world } = useCareer.getState();
  const mode = (area: 'race-strategy' | 'race-radio'): DelegationMode => world.career.delegation[area];
  return {
    teamId: world.career.playerTeamId,
    strategy: { mode: mode('race-strategy'), risk: 0.5, goal: 'fastest' },
    radio: { mode: mode('race-radio'), aggression: 'normal', saving: 'none' },
    plans: {},
  };
}

export const useRace = create<RaceStore>()(
  immer((set, get) => {
    const request = () => {
      const { round, seed, startControl, commands } = get();
      return { world: useCareer.getState().world, round, seed, control: startControl, commands };
    };

    /** Re-runs the race with the command log and swaps the replay in at the same moment. */
    const rerun = async () => {
      set({ busy: true });
      try {
        engine ??= createWorkerEngine();
        const { input, result } = await engine.run(request());
        set(() => ({ replay: buildReplay(input, result), busy: false }));
      } catch (error) {
        set({ busy: false, phase: 'error', error: error instanceof Error ? error.message : String(error) });
      }
    };

    /** Whether a call stops the race: always when nobody has made it, and when suggesting. */
    const needsPlayer = (d: StrategyDecision) =>
      d.by === 'unanswered' || (d.by === 'strategist' && get().suggestWithPause);

    return {
      phase: 'setup',
      round: 1,
      seed: randomSeed(),
      replay: null,
      timeS: 0,
      speed: 1,
      paused: false,
      error: null,
      control: defaultControl(),
      startControl: defaultControl(),
      commands: [],
      suggestWithPause: false,
      decisionTimer: true,
      plans: null,
      pending: null,
      handled: [],
      busy: false,

      // Another round or seed is another race: its options are worked out afresh, a picked plan dropped.
      setRound: (round) =>
        set((s) => {
          s.round = round;
          s.plans = null;
          s.control.plans = {};
        }),
      setSeed: (seed) =>
        set((s) => {
          s.seed = seed;
          s.plans = null;
          s.control.plans = {};
        }),

      loadPlans: async () => {
        engine ??= createWorkerEngine();
        const asked = { ...request(), control: get().control, commands: [] };
        const plans = await engine.plans(asked);
        // Dropped if the round, seed or instruction changed while the worker was busy.
        const now = get();
        if (
          now.round === asked.round &&
          now.seed === asked.seed &&
          now.control.strategy === asked.control.strategy
        )
          set(() => ({ plans }));
      },

      choosePlan: (plan) =>
        set((s) => {
          const world = useCareer.getState().world;
          const drivers = world.teams[s.control.teamId]!.drivers.race;
          s.control.plans = Object.fromEntries(drivers.map((id) => [id, plan]));
        }),

      setStrategy: async (strategy) => {
        set((s) => {
          s.control.strategy = strategy;
          // Before the start a directed instruction can change the strategist's pick.
          if (s.phase !== 'ready') s.plans = null;
        });
        if (get().phase === 'ready') await get().command({ kind: 'control', strategy });
      },
      setRadio: async (radio) => {
        set((s) => {
          s.control.radio = radio;
        });
        if (get().phase === 'ready') await get().command({ kind: 'control', radio });
      },
      setSuggestWithPause: (on) => set({ suggestWithPause: on }),
      setDecisionTimer: (on) => set({ decisionTimer: on }),

      start: async () => {
        set((s) => {
          s.phase = 'loading';
          s.error = null;
          s.commands = [];
          s.handled = [];
          s.pending = null;
          s.startControl = s.control;
        });
        try {
          engine ??= createWorkerEngine();
          const { input, result } = await engine.run(request());
          // The replay is read-only data: stored as is, not drafted.
          set(() => ({ phase: 'ready', replay: buildReplay(input, result), timeS: 0, paused: false }));
        } catch (error) {
          set({ phase: 'error', error: error instanceof Error ? error.message : String(error) });
        }
      },

      command: async (command) => {
        const timeS = Math.round(get().timeS * 1000) / 1000;
        set((s) => {
          s.commands.push({ ...command, timeS });
        });
        await rerun();
      },

      answer: async (answer) => {
        const d = get().pending;
        if (!d) return;
        set((s) => {
          s.pending = null;
          s.paused = false;
          s.handled.push(decisionKey(d));
        });
        const chosen = answer === 'accept' ? d.options[d.recommended]!.answer : answer;
        const applied = d.options[d.applied]!.answer;
        const same =
          chosen.call === applied.call &&
          (chosen.call === 'stay' || (applied.call === 'pit' && chosen.compound === applied.compound));
        if (same && d.by !== 'unanswered') return;
        set((s) => {
          s.commands.push({ timeS: d.timeS, kind: 'call', driverId: d.driverId, answer: chosen });
        });
        await rerun();
      },

      tick: (realMs) => {
        const { replay, paused, speed, timeS, busy, handled } = get();
        if (!replay || paused || busy || timeS >= replay.durationS) return;
        const next = Math.min(replay.durationS, timeS + (realMs / 1000) * speed);
        const call = replay.result.pitWall?.decisions.find(
          (d) => d.timeS > timeS && d.timeS <= next && needsPlayer(d) && !handled.includes(decisionKey(d)),
        );
        if (call) set(() => ({ timeS: call.timeS, paused: true, pending: call }));
        else set({ timeS: next });
      },
      seek: (timeS) => {
        const { replay } = get();
        if (replay) set({ timeS: Math.max(0, Math.min(replay.durationS, timeS)) });
      },
      setSpeed: (speed) => set({ speed }),
      togglePause: () => set((s) => ({ paused: !s.paused })),
      restart: () => set({ timeS: 0, paused: false, pending: null, handled: [] }),
      backToSetup: () =>
        set({
          phase: 'setup',
          replay: null,
          timeS: 0,
          seed: randomSeed(),
          commands: [],
          pending: null,
          plans: null,
          control: { ...get().control, plans: {} },
        }),
    };
  }),
);
