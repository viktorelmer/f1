/**
 * The car on screen (docs/systems/car-development.md): what it is made of, what the factory is
 * building, and the two decisions that belong to the player — what to build next and which
 * direction the season takes.
 *
 * Development is cheap arithmetic over days, so it runs in place: only the race needs a worker.
 */
import { create } from 'zustand';
import { installProject, setPhilosophy, startProject } from '@/sim/car/development';
import type { ProjectPlan } from '@/sim/car/development';
import { streams } from '@/sim/rng/rng';
import type { Philosophy, RnDProject, World } from '@/sim/types/world';
import { useCareer } from './career';

export type CarStore = {
  error: string | null;
  /** Signs off a new project for the player's team. */
  start: (plan: ProjectPlan) => void;
  /** Fits a part that is built and waiting. */
  install: (projectId: string) => void;
  /** Takes the season in a direction (plan 5.1): work in progress pays part of the price. */
  choosePhilosophy: (philosophy: Philosophy) => void;
};

export const useCar = create<CarStore>()((set) => ({
  error: null,

  start: (plan) => {
    const { world, pack } = useCareer.getState();
    try {
      const teamId = world.career.playerTeamId;
      const next = startProject(world, pack, teamId, plan, world.date, streamFor(world, teamId, plan));
      // One project per part per day: the same part signed off twice in one day is the same project.
      if (next.projects.length === world.projects.length) {
        set({ error: 'already-started' });
        return;
      }
      useCareer.setState({ world: next });
      set({ error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  install: (projectId) => {
    const { world } = useCareer.getState();
    useCareer.setState({ world: installProject(world, projectId) });
  },

  choosePhilosophy: (philosophy) => {
    const { world } = useCareer.getState();
    useCareer.setState({ world: setPhilosophy(world, world.career.playerTeamId, philosophy) });
  },
}));

/** The team's own projects, newest first. */
export function projectsOf(world: World, teamId = world.career.playerTeamId): RnDProject[] {
  return world.projects
    .filter((p) => p.teamId === teamId)
    .slice()
    .reverse();
}

/**
 * The stream a project draws its truth from: the same name the factory would have used, built from
 * the team, the part and the day — never from an index (invariant 2).
 */
function streamFor(world: World, teamId: string, plan: ProjectPlan) {
  return streams(world.seed)(`dev:${world.season.year}:${teamId}:${world.date}:${plan.part}:gain`);
}
