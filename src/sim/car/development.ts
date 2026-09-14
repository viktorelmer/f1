/**
 * Car development (docs/systems/car-development.md, plan 5.1): a part goes from a concept to a box
 * in the garage over weeks of work, and what it is really worth is not known until it runs.
 *
 * Three things live apart on purpose. The *ceiling* is what the tunnel measured — a number the team
 * can compute. The *truth* is that ceiling through the factory's own correlation plus a surprise,
 * and it lives in `world.hidden.projects`. The *belief* is an `Estimate` built from the model
 * only (`estimateFromModel` cannot take the truth), narrowing stage by stage.
 */
import { balance } from '@/data/balance';
import type { ChassisPart } from '@/data/schema/balance';
import type { RnDStage, WorkStage } from '@/data/schema/development-balance';
import type { Pack } from '@/data/schema/pack';
import { estimateFromModel, measure, refine } from '../knowledge/estimate';
import type { Rng } from '../rng/rng';
import type { GameDate } from '../types/game-date';
import type { Philosophy, RnDProject, TeamId, World } from '../types/world';

/** What the player (or a rival's technical director) asks for when a project is started. */
export type ProjectPlan = {
  part: ChassisPart;
  /** This season's car, or next year's — they share the same office and the same allowance. */
  targetSeason: number;
  /** Share of the team's aero allowance to point at this project, 0..1. */
  atrShare: number;
};

const WORK: readonly WorkStage[] = ['concept', 'research', 'design', 'production'];

/** Which parts each philosophy is about (plan 5.1). A direction pays off only where it applies. */
const PHILOSOPHY_PARTS: Record<Philosophy, readonly ChassisPart[]> = {
  balanced: [],
  'low-drag': ['rearWing', 'sidepods'],
  'high-downforce': ['frontWing', 'floor'],
  'braking-stability': ['brakes', 'suspension'],
};

/** The id of a project: from the team, the part and the day it started — never from an index. */
export function projectId(teamId: TeamId, plan: ProjectPlan, startedOn: GameDate): string {
  return `${teamId}:${plan.part}:${plan.targetSeason}:${startedOn}`;
}

/** What this team's design office gets through, 1 being the reference office at three projects. */
export function officeCapacity(world: World, teamId: TeamId, activeProjects: number): number {
  const c = balance.development.capacity;
  const team = world.teams[teamId]!;
  const office = team.departments.design;
  const size =
    c.qualityWeight * (office.quality / c.referenceQuality) +
    (1 - c.qualityWeight) * (office.headcount / c.referenceHeadcount);
  const over = Math.max(0, activeProjects - c.projectsWithoutPenalty);
  return Math.max(c.minFactor, size * (1 - c.overloadPenalty) ** over);
}

/**
 * The team's aero allowance as a multiplier on the reference: the regulation hands less wind tunnel
 * to whoever finished higher last season (plan 5.1, the pack's `aeroTestingAllowancePct`).
 */
export function aeroAllowance(world: World, pack: Pack, teamId: TeamId): number {
  const regulation = pack.regulations.find((r) => r.season === world.season.year) ?? pack.regulations[0]!;
  const table = regulation.aeroTestingAllowancePct;
  const standings = world.season.standings.constructors;
  const order = Object.entries(standings)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
  const place = order.indexOf(teamId);
  const pct = table[place >= 0 ? Math.min(place, table.length - 1) : table.length - 1] ?? 100;
  return pct / 100;
}

/** How much of the tunnel this project is really getting, 1 being a normal share of a normal team. */
function atrFactor(atrShare: number, allowance: number): number {
  return atrShare * allowance * balance.development.capacity.projectsWithoutPenalty;
}

/** What the tunnel says this part can gain: the number the team can compute for itself. */
export function projectCeiling(
  world: World,
  pack: Pack,
  teamId: TeamId,
  plan: ProjectPlan,
  philosophy: Philosophy,
): number {
  const g = balance.development.gain;
  const p = balance.development.philosophy;
  const aero = world.teams[teamId]!.departments.aerodynamics.quality;
  const tunnel = atrFactor(plan.atrShare, aeroAllowance(world, pack, teamId));
  const raw =
    g.ceilingAtReference +
    g.ceilingPerAeroPoint * (aero - g.aeroReference) +
    g.ceilingPerAtrShare * (tunnel - 1);
  const parts = PHILOSOPHY_PARTS[philosophy];
  const direction =
    philosophy === 'balanced' ? 1 : parts.includes(plan.part) ? 1 + p.matchBonus : 1 - p.mismatchPenalty;
  return Math.max(g.minCeiling, raw * direction);
}

/** How tightly the team knows that ceiling at this stage of the work. */
export function gainSd(world: World, teamId: TeamId, plan: ProjectPlan, stage: RnDStage): number {
  const u = balance.development.uncertainty;
  const team = world.teams[teamId]!;
  const raw =
    u.sdAtReference -
    u.sdPerAeroPoint * (team.departments.aerodynamics.quality - balance.development.gain.aeroReference) -
    u.sdPerSimulatorLevel * team.facilities.simulator -
    u.sdPerAtrShare * plan.atrShare;
  return Math.max(u.minSd, raw) * u.stageSdFactor[stage];
}

/**
 * Starts a project: the truth is drawn now and hidden, the team gets its first belief about it.
 * The belief is the tunnel's ceiling seen through what the team thinks of its own tunnel — which is
 * exactly what a team has: a measurement and a suspicion about the measurement.
 */
export function startProject(
  world: World,
  pack: Pack,
  teamId: TeamId,
  plan: ProjectPlan,
  at: GameDate,
  rng: Rng,
): World {
  const team = world.teams[teamId]!;
  const id = projectId(teamId, plan, at);
  if (world.projects.some((p) => p.id === id)) return world;
  const ceiling = projectCeiling(world, pack, teamId, plan, team.philosophy);
  const bias = world.hidden.teams[teamId]?.correlationBias ?? 0;
  const trueGain = Math.max(0, ceiling * (1 + bias) + rng.normal(0, balance.development.correlation.noiseSd));

  const project: RnDProject = {
    id,
    teamId,
    part: plan.part,
    targetSeason: plan.targetSeason,
    stage: 'concept',
    startedOn: at,
    spentM: 0,
    expectedGain: believedGain(world, pack, teamId, plan, 'concept', at),
    progress: 0,
    atrShare: plan.atrShare,
    philosophy: team.philosophy,
  };
  return {
    ...world,
    projects: [...world.projects, project],
    hidden: { ...world.hidden, projects: { ...world.hidden.projects, [id]: { trueGain } } },
  };
}

/** What the team expects this project to give, from its model of the tunnel and of itself. */
function believedGain(
  world: World,
  pack: Pack,
  teamId: TeamId,
  plan: ProjectPlan,
  stage: RnDStage,
  at: GameDate,
) {
  const ceiling = projectCeiling(world, pack, teamId, plan, world.teams[teamId]!.philosophy);
  const correlation = world.knowledge[teamId]?.correlation.value ?? 0;
  return estimateFromModel(
    { mean: Math.max(0, ceiling * (1 + correlation)), sd: gainSd(world, teamId, plan, stage) },
    {
      quantity: balance.estimate.quantities['car.partGain'],
      at,
      sources: plan.atrShare > 0 ? ['wind-tunnel', 'cfd'] : ['cfd'],
    },
  );
}

/**
 * Days of work on every active project. A stage moves when its work is done; the belief narrows as
 * it does. Parts that reach `production` wait there: fitting one to the car is a decision, not a
 * consequence (plan 5.1).
 */
export function advanceDevelopment(world: World, pack: Pack, days: number, at: GameDate): World {
  if (days <= 0) return world;
  const g = balance.development.gain;
  const s = balance.development.stages;
  const active = new Map<TeamId, number>();
  for (const project of world.projects)
    if (isWorking(project.stage)) active.set(project.teamId, (active.get(project.teamId) ?? 0) + 1);

  const projects = world.projects.map((project) => {
    if (!isWorking(project.stage)) return project;
    const capacity = officeCapacity(world, project.teamId, active.get(project.teamId) ?? 1);
    const tunnel = atrFactor(project.atrShare, aeroAllowance(world, pack, project.teamId));

    // Days are spent stage by stage: a long gap between races can finish more than one.
    let left = days;
    let stage: RnDStage = project.stage;
    let progress = project.progress;
    let spentM = project.spentM;
    while (isWorking(stage) && left > 0 && !(stage === 'production' && progress >= 1)) {
      const aeroShare = s.atrShareOfWork[stage];
      const rate = Math.max(1e-6, (1 - aeroShare) * capacity + aeroShare * tunnel);
      const needed = ((1 - progress) * s.days[stage]) / rate;
      const spent = Math.min(left, needed);
      spentM +=
        spent * (g.spend.perStageM / s.days[stage]) +
        spent * (g.spend.perAtrShareM / s.days[stage]) * project.atrShare;
      left -= spent;
      if (spent < needed) {
        progress += (spent * rate) / s.days[stage];
        break;
      }
      // The last stage ends with the part built and waiting: fitting it is the player's call.
      if (stage === 'production') {
        progress = 1;
        break;
      }
      stage = nextStage(stage);
      progress = 0;
    }

    const plan = { part: project.part, targetSeason: project.targetSeason, atrShare: project.atrShare };
    return {
      ...project,
      stage,
      progress: Math.min(1, progress),
      spentM: Math.round(spentM * 100) / 100,
      expectedGain:
        stage === project.stage
          ? project.expectedGain
          : believedGain(world, pack, project.teamId, plan, stage, at),
    };
  });
  return { ...world, projects };
}

/** Whether a part is built and waiting to be fitted. */
export function isReady(project: RnDProject): boolean {
  return project.stage === 'production' && project.progress >= 1;
}

/** Fitting a part to the car: the rating moves by what the part is really worth, not by the promise. */
export function installProject(world: World, id: string): World {
  const project = world.projects.find((p) => p.id === id);
  if (!project || !isReady(project)) return world;
  const trueGain = world.hidden.projects[id]?.trueGain ?? 0;
  const team = world.teams[project.teamId]!;
  const chassis = {
    ...team.chassis,
    [project.part]: Math.max(0, Math.min(100, team.chassis[project.part] + trueGain)),
  };
  return {
    ...world,
    teams: { ...world.teams, [team.id]: { ...team, chassis } },
    projects: world.projects.map((p) => (p.id === id ? { ...p, stage: 'installed' as const } : p)),
  };
}

/**
 * What the track said about a part that has run: the gain is measured, and what it says about the
 * factory's own tunnel is folded into what the team believes about it (plan 5.1, 5.17).
 */
export function validateProject(world: World, pack: Pack, id: string, at: GameDate, rng: Rng): World {
  const project = world.projects.find((p) => p.id === id);
  if (!project || project.stage !== 'installed') return world;
  const c = balance.development.correlation;
  const trueGain = world.hidden.projects[id]?.trueGain ?? 0;
  const measured = measure(trueGain, { sd: c.validationSd, bias: 0 }, rng, at);
  const ceiling = projectCeiling(
    world,
    pack,
    project.teamId,
    { part: project.part, targetSeason: project.targetSeason, atrShare: project.atrShare },
    project.philosophy,
  );

  const known = world.knowledge[project.teamId];
  const correlation = known
    ? refine(known.correlation, {
        value: measured.value / Math.max(0.01, ceiling) - 1,
        sd: c.validationSd / Math.max(0.01, ceiling),
        at,
      })
    : undefined;

  return {
    ...world,
    knowledge:
      known && correlation
        ? { ...world.knowledge, [project.teamId]: { ...known, correlation } }
        : world.knowledge,
    projects: world.projects.map((p) =>
      p.id === id
        ? {
            ...p,
            stage: 'validated' as const,
            expectedGain: estimateFromModel(
              { mean: Math.max(0, measured.value), sd: c.validationSd },
              {
                quantity: balance.estimate.quantities['car.partGain'],
                at,
                sources: ['track-test'],
              },
            ),
          }
        : p,
    ),
  };
}

const isWorking = (stage: RnDStage): stage is WorkStage => (WORK as readonly string[]).includes(stage);

function nextStage(stage: WorkStage): RnDStage {
  const order: readonly RnDStage[] = [...WORK, 'installed'];
  return order[order.indexOf(stage) + 1] ?? 'installed';
}
