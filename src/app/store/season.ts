/**
 * The season on screen (docs/systems/season.md): where the clock stands, what the next event is, and
 * running a weekend in the worker. The world itself lives in the career slice — this one moves it
 * forward and never keeps a copy.
 */
import { create } from 'zustand';
import type { SessionKind, World } from '@/sim/types/world';
import { nextEvent, type SeasonEvent, upcoming } from '@/sim/season/events';
import type { PracticePlan, Run } from '@/sim/weekend/practice';
import { defaultPlan } from '@/sim/weekend/practice';
import { PRACTICE_SESSIONS } from '@/sim/weekend/run-practice';
import { createWorkerEngine, type RaceEngine } from '../worker/engine';
import { useCareer } from './career';

export type SeasonStore = {
  /** Running the weekend takes a moment in the worker; the screen says so. */
  busy: boolean;
  error: string | null;
  /** The practice programmes the player has chosen, by session. Empty means the default. */
  programmes: Partial<Record<SessionKind, PracticePlan>>;
  setProgramme: (session: SessionKind, driverId: string, runs: readonly Run[]) => void;
  /** Runs the next round of the calendar, start to finish, and moves the world on. */
  runNextWeekend: () => Promise<void>;
  /** "Continue": the clock to the day of the next event. */
  advance: () => void;
};

let engine: RaceEngine | null = null;

/** Tests supply their own engine; the browser uses the worker. */
export function setSeasonEngine(next: RaceEngine) {
  engine = next;
}

/** The round the season is waiting on, or null when the calendar is done. */
export function pendingRound(world: World): number | null {
  const event = upcoming(world).find(
    (e): e is Extract<SeasonEvent, { kind: 'weekend' }> => e.kind === 'weekend',
  );
  return event ? event.round : null;
}

export const useSeason = create<SeasonStore>()((set, get) => ({
  busy: false,
  error: null,
  programmes: {},

  setProgramme: (session, driverId, runs) =>
    set((state) => ({
      programmes: {
        ...state.programmes,
        [session]: { ...(state.programmes[session] ?? {}), [driverId]: [...runs] },
      },
    })),

  runNextWeekend: async () => {
    const { world, pack } = useCareer.getState();
    const round = pendingRound(world);
    if (round === null || get().busy) return;
    set({ busy: true, error: null });
    try {
      engine ??= createWorkerEngine();
      const outcome = await engine.weekend({
        world,
        round,
        seed: `${world.seed}:r${round}`,
        plans: fullPlans(world, get().programmes),
      });
      useCareer.setState({ world: outcome.world, pack });
      set({ busy: false, programmes: {} });
    } catch (error) {
      set({ busy: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  advance: () => {
    const { world } = useCareer.getState();
    const next = nextEvent(world);
    if (next && next.date > world.date) useCareer.setState({ world: { ...world, date: next.date } });
  },
}));

/**
 * The player's choices over the default programme: everyone the player did not decide for runs what
 * a team would normally run, so a weekend never stalls waiting for an instruction.
 */
function fullPlans(
  world: World,
  chosen: Partial<Record<SessionKind, PracticePlan>>,
): Partial<Record<SessionKind, PracticePlan>> {
  if (Object.keys(chosen).length === 0) return {};
  const mine = new Set(world.teams[world.career.playerTeamId]?.drivers.race ?? []);
  const plans: Partial<Record<SessionKind, PracticePlan>> = {};
  for (const session of PRACTICE_SESSIONS.standard) {
    const picked = chosen[session];
    if (!picked) continue;
    plans[session] = Object.fromEntries(Object.entries(picked).filter(([driverId]) => mine.has(driverId)));
  }
  return plans;
}

/** What the default programme looks like for a session, for the screen to show and start from. */
export function defaultRuns(world: World, session: SessionKind): readonly Run[] {
  const driverId = world.teams[world.career.playerTeamId]?.drivers.race[0] ?? '';
  return defaultPlan([{ driverId }], session)[driverId] ?? [];
}
