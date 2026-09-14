/**
 * The weekend on screen (docs/systems/weekend-play.md): which session the round is waiting on, the
 * session being played on its own clock, and everything the player said during it.
 *
 * The weekend itself lives in the world (`world.weekend`), never here — this slice only moves it
 * on. A session is computed whole in the worker from the world it starts from (`base`), played back
 * from a replay, and filed into the career world at the flag. A command during the session appends
 * to the log and re-runs it from `base` with the same seed, and the clock stays where it was: the
 * race's trick from M4 (docs/systems/race-control.md), because it is the same trick.
 */
import { create } from 'zustand';
import type { DelegationArea, DelegationMode } from '@/sim/decide/delegation';
import { closeWeekend, planPractice, setCarSetup, setTyreEntry } from '@/sim/season/weekend';
import type {
  DriverId,
  PracticePlan,
  SessionKind,
  SessionResult,
  Setup,
  TyreAllocation,
  World,
} from '@/sim/types/world';
import { defaultPlan, type PracticeCommand, type Run } from '@/sim/weekend/practice';
import { buildPracticeReplay, type PracticeReplay, practiceFrameAt } from '@/sim/weekend/practice-replay';
import type { QualifyingCommand } from '@/sim/weekend/qualifying';
import {
  buildQualifyingReplay,
  qualifyingFrameAt,
  type QualifyingReplay,
} from '@/sim/weekend/qualifying-replay';
import { createWorkerEngine, type RaceEngine } from '../worker/engine';
import { useCareer } from './career';
import { defaultControl, unwatchedControl } from './control';
import type { Speed } from './playback';
import { pendingRound } from './season';

/** A session being watched: practice or qualifying. The race is played by the race slice. */
export type SessionPlay =
  { kind: 'practice'; replay: PracticeReplay } | { kind: 'qualifying'; replay: QualifyingReplay };

type WeekendStore = {
  phase: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  /** A re-run is in flight: the clock holds until the new replay is in. */
  busy: boolean;
  /** The world the session on screen starts from, and the one it leaves behind. */
  base: World | null;
  after: World | null;
  committed: boolean;
  stage: SessionKind | null;
  play: SessionPlay | null;
  timeS: number;
  speed: Speed;
  paused: boolean;
  practiceCommands: PracticeCommand[];
  qualifyingCommands: QualifyingCommand[];
  /** Programmes chosen before the weekend is open; once it is, they live in the world. */
  draft: Partial<Record<SessionKind, PracticePlan>>;
  /** The queue this car runs in that practice session. */
  setProgramme: (session: SessionKind, driverId: DriverId, runs: readonly Run[]) => void;
  /** The tyres this car declares for the weekend, over what its strategist would have taken. */
  setEntry: (driverId: DriverId, entry: TyreAllocation) => void;
  /** The setup this car runs, over what its engineer dialled in (docs/systems/setup.md). */
  setSetup: (driverId: DriverId, setup: Setup) => void;
  /** Who decides in an area from now on (plan 5.19, 6.5): the career's own setting. */
  setDelegation: (area: DelegationArea, mode: DelegationMode) => void;
  /** Opens the weekend of the round the season is waiting on, with the programmes chosen so far. */
  open: () => Promise<void>;
  /** Runs the session the weekend waits on and holds it for playback (practice and qualifying). */
  enter: () => Promise<void>;
  /** Runs the pending session with nobody watching and files it straight away. */
  simulateSession: () => Promise<SessionResult | null>;
  /** Runs every session left of the weekend and closes it. */
  simulateRest: () => Promise<void>;
  /** The rest of this car's practice queue, said now. */
  setRuns: (driverId: string, runs: readonly Run[]) => Promise<void>;
  /** "Out now" in qualifying, for the part the clock is in. */
  sendOut: (driverId: string) => Promise<void>;
  tick: (realMs: number) => void;
  seek: (timeS: number) => void;
  setSpeed: (speed: Speed) => void;
  togglePause: () => void;
  /** To the flag at once: the session is over and filed, and stays on screen to be read. */
  skipToEnd: () => void;
  /** Leaves the session on screen. A session already filed stays filed; an unfinished one is dropped. */
  leave: () => void;
};

let engine: RaceEngine | null = null;

/** Tests supply their own engine; the browser uses the worker. */
export function setWeekendEngine(next: RaceEngine) {
  engine = next;
}

const enginer = () => (engine ??= createWorkerEngine());

/**
 * A session's world into the career: the weekend moves on, and a weekend with nothing left to run
 * closes itself — the round is completed and the clock is on race day (docs/systems/season.md).
 */
export function commitSession(after: World) {
  useCareer.setState({ world: after.weekend?.stage === 'done' ? closeWeekend(after) : after });
}

/** The session the open weekend is waiting on, or null when no weekend is open. */
export function pendingStage(world: World): SessionKind | null {
  const stage = world.weekend?.stage;
  return stage && stage !== 'done' ? stage : null;
}

export const useWeekend = create<WeekendStore>()((set, get) => {
  /** Runs the pending session from `base` with the command log, and swaps the replay in. */
  const run = async (base: World): Promise<{ after: World; play: SessionPlay; stage: SessionKind }> => {
    const outcome = await enginer().session({
      world: base,
      control: defaultControl(),
      practiceCommands: get().practiceCommands,
      qualifyingCommands: get().qualifyingCommands,
    });
    const detail = outcome.detail;
    if (detail.kind === 'race')
      throw new Error(`${outcome.stage} is driven on the race screen, not watched from the pit wall`);
    const play: SessionPlay =
      detail.kind === 'practice'
        ? { kind: 'practice', replay: buildPracticeReplay(detail.practice) }
        : { kind: 'qualifying', replay: buildQualifyingReplay(detail.qualifying) };
    return { after: outcome.world, play, stage: outcome.stage };
  };

  /** A command re-runs the session from the start; the clock does not move while it does. */
  const rerun = async () => {
    const base = get().base;
    if (!base || get().committed) return;
    set({ busy: true });
    try {
      const { after, play } = await run(base);
      set({ after, play, busy: false });
    } catch (error) {
      set({ busy: false, phase: 'error', error: message(error) });
    }
  };

  /** The session is over: what it did to the world is the world now. */
  const commit = () => {
    const { after, committed } = get();
    if (!after || committed) return;
    commitSession(after);
    set({ committed: true });
  };

  return {
    phase: 'idle',
    error: null,
    busy: false,
    base: null,
    after: null,
    committed: false,
    stage: null,
    play: null,
    timeS: 0,
    speed: 1,
    paused: false,
    practiceCommands: [],
    qualifyingCommands: [],
    draft: {},

    setProgramme: (session, driverId, runs) => {
      const { world } = useCareer.getState();
      const plan = { ...(plansOf(world, get().draft, session) ?? {}), [driverId]: [...runs] };
      // An open weekend keeps its programmes in the world; before it opens they are a draft.
      if (world.weekend) useCareer.setState({ world: planPractice(world, session, plan) });
      else set((s) => ({ draft: { ...s.draft, [session]: plan } }));
    },

    setEntry: (driverId, entry) => {
      const { world } = useCareer.getState();
      if (!world.weekend) return;
      useCareer.setState({ world: setTyreEntry(world, driverId, entry) });
    },

    setDelegation: (area, mode) => {
      const { world } = useCareer.getState();
      const delegation = { ...world.career.delegation, [area]: mode };
      useCareer.setState({ world: { ...world, career: { ...world.career, delegation } } });
    },

    setSetup: (driverId, setup) => {
      const { world, pack } = useCareer.getState();
      if (!world.weekend) return;
      useCareer.setState({ world: setCarSetup(world, pack, driverId, setup) });
    },

    open: async () => {
      const { world } = useCareer.getState();
      const round = world.weekend?.round ?? pendingRound(world);
      if (round === null || get().busy) return;
      set({ busy: true, error: null });
      try {
        let opened = await enginer().open({ world, round, seed: `${world.seed}:r${round}` });
        for (const [session, plan] of Object.entries(get().draft))
          if (plan) opened = planPractice(opened, session as SessionKind, plan);
        useCareer.setState({ world: opened });
        set({ busy: false, draft: {} });
      } catch (error) {
        set({ busy: false, phase: 'error', error: message(error) });
      }
    },

    enter: async () => {
      const base = useCareer.getState().world;
      if (!pendingStage(base) || get().busy) return;
      set({
        phase: 'loading',
        error: null,
        base,
        after: null,
        committed: false,
        play: null,
        timeS: 0,
        paused: false,
        practiceCommands: [],
        qualifyingCommands: [],
      });
      try {
        const { after, play, stage } = await run(base);
        set({ phase: 'ready', after, play, stage });
      } catch (error) {
        set({ phase: 'error', error: message(error) });
      }
    },

    simulateSession: async () => {
      const world = useCareer.getState().world;
      if (!pendingStage(world) || get().busy) return null;
      set({ busy: true, error: null });
      try {
        const outcome = await enginer().session({ world, control: unwatchedControl() });
        commitSession(outcome.world);
        set({ busy: false });
        return outcome.session;
      } catch (error) {
        set({ busy: false, phase: 'error', error: message(error) });
        return null;
      }
    },

    simulateRest: async () => {
      if (get().busy) return;
      set({ busy: true, error: null });
      try {
        let world = useCareer.getState().world;
        while (pendingStage(world)) {
          const outcome = await enginer().session({ world, control: unwatchedControl() });
          world = outcome.world;
        }
        commitSession(world);
        set({ busy: false });
      } catch (error) {
        set({ busy: false, phase: 'error', error: message(error) });
      }
    },

    setRuns: async (driverId, runs) => {
      const { play, timeS, committed } = get();
      if (play?.kind !== 'practice' || committed) return;
      set((s) => ({
        practiceCommands: [...s.practiceCommands, { atS: round3(timeS), driverId, runs: [...runs] }],
      }));
      await rerun();
    },

    sendOut: async (driverId) => {
      const { play, timeS, committed } = get();
      if (play?.kind !== 'qualifying' || committed) return;
      const part = qualifyingFrameAt(play.replay, timeS).part;
      set((s) => ({
        qualifyingCommands: [...s.qualifyingCommands, { atS: round3(timeS), part, driverId }],
      }));
      await rerun();
    },

    tick: (realMs) => {
      const { play, paused, busy, speed, timeS } = get();
      if (!play || paused || busy) return;
      const durationS = play.replay.durationS;
      if (timeS >= durationS) return;
      const next = Math.min(durationS, timeS + (realMs / 1000) * speed);
      set({ timeS: next });
      if (next >= durationS) commit();
    },

    seek: (timeS) => {
      const play = get().play;
      if (play) set({ timeS: Math.max(0, Math.min(play.replay.durationS, timeS)) });
    },
    setSpeed: (speed) => set({ speed }),
    togglePause: () => set((s) => ({ paused: !s.paused })),

    skipToEnd: () => {
      const play = get().play;
      if (!play) return;
      set({ timeS: play.replay.durationS, paused: true });
      commit();
    },

    leave: () =>
      set({
        phase: 'idle',
        play: null,
        base: null,
        after: null,
        stage: null,
        committed: false,
        timeS: 0,
        paused: false,
        practiceCommands: [],
        qualifyingCommands: [],
      }),
  };
});

/**
 * The programmes a session will run as things stand: what the weekend already carries, what the
 * player has drafted before it opens, or what a team would normally run.
 */
export function plansOf(
  world: World,
  draft: Partial<Record<SessionKind, PracticePlan>>,
  session: SessionKind,
): PracticePlan | null {
  return world.weekend?.plans[session] ?? draft[session] ?? null;
}

/** The queue a car runs in a session, falling back to the default programme of a team. */
export function runsOf(
  world: World,
  draft: Partial<Record<SessionKind, PracticePlan>>,
  session: SessionKind,
  driverId: DriverId,
): readonly Run[] {
  const plan = plansOf(world, draft, session);
  return plan?.[driverId] ?? defaultPlan([{ driverId }], session)[driverId] ?? [];
}

/** The frame of the session on screen, whichever kind it is — what the screens draw. */
export function frameOf(play: SessionPlay, timeS: number) {
  return play.kind === 'practice'
    ? { kind: 'practice' as const, frame: practiceFrameAt(play.replay, timeS) }
    : { kind: 'qualifying' as const, frame: qualifyingFrameAt(play.replay, timeS) };
}

const round3 = (timeS: number) => Math.round(timeS * 1000) / 1000;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
