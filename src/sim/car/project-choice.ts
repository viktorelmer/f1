/**
 * What to build next (docs/systems/car-development.md, plan 5.1, 5.19). The technical director —
 * the player's delegate or a rival's — picks the part, the season it is for and how much of the
 * tunnel it gets. One function for everyone: there is no separate AI path.
 */
import { balance } from '@/data/balance';
import { CHASSIS_PARTS } from '@/data/schema/balance';
import type { Pack } from '@/data/schema/pack';
import { carPerformance } from './performance';
import { chooseByScore, type Decide, type Evaluation } from '../decide/decide';
import type { TeamId, World } from '../types/world';
import { aeroAllowance, projectCeiling, type ProjectPlan } from './development';

/** What the director is after: this year's points, or the car that starts next season. */
export type ProjectGoal = 'this-season' | 'next-season';

export type ProjectContext = {
  world: World;
  pack: Pack;
  teamId: TeamId;
  /** Projects already under way: the office only has so much room. */
  active: number;
  /** Weeks left in the season — a part that will not be ready in time is worth nothing this year. */
  daysLeftInSeason: number;
};

/**
 * The candidates: every part, for this season or the next, at one of three shares of the tunnel.
 * A part that is already strong gains less from the same work — the room to improve is the point.
 */
export function projectOptions(context: ProjectContext): ProjectPlan[] {
  const season = context.world.season.year;
  // Three shares of the tunnel: a cheap side project, a normal one, a bet.
  const shares = [0.2, 0.35, 0.6];
  const plans: ProjectPlan[] = [];
  for (const part of CHASSIS_PARTS)
    for (const targetSeason of [season, season + 1])
      for (const atrShare of shares) plans.push({ part, targetSeason, atrShare });
  return plans;
}

/** Roughly how long this plan needs before the part can be on the car. */
export function daysToBuild(context: ProjectContext, plan: ProjectPlan): number {
  const s = balance.development.stages;
  const capacity = officeRate(context);
  const tunnel = plan.atrShare * aeroAllowance(context.world, context.pack, context.teamId) * 3;
  let days = 0;
  for (const stage of ['concept', 'research', 'design', 'production'] as const) {
    const aero = s.atrShareOfWork[stage];
    days += s.days[stage] / Math.max(0.05, (1 - aero) * capacity + aero * tunnel);
  }
  return days;
}

function officeRate(context: ProjectContext): number {
  const c = balance.development.capacity;
  const office = context.world.teams[context.teamId]!.departments.design;
  const size =
    c.qualityWeight * (office.quality / c.referenceQuality) +
    (1 - c.qualityWeight) * (office.headcount / c.referenceHeadcount);
  const over = Math.max(0, context.active + 1 - c.projectsWithoutPenalty);
  return Math.max(c.minFactor, size * (1 - c.overloadPenalty) ** over);
}

/**
 * What a project is worth to the team: the lap time the part is expected to buy, over the races it
 * can still reach. A part for next season is judged on next season, so the trade the plan calls the
 * central strategic choice is a real one — the same office, the same tunnel, two different years.
 */
export const decideProject: Decide<ProjectContext, ProjectGoal, ProjectPlan> = (
  context,
  competence,
  intent,
  rng,
) => {
  const { world, pack, teamId } = context;
  const team = world.teams[teamId]!;
  const options = projectOptions(context);
  const car = carPerformance(team.chassis, team.engine.spec);

  const value = (plan: ProjectPlan) => {
    const ceiling = projectCeiling(world, pack, teamId, plan, team.philosophy);
    const correlation = world.knowledge[teamId]?.correlation.value ?? 0;
    const expected = Math.max(0, ceiling * (1 + correlation));
    // A part already near the top of its scale has little room left, whatever the tunnel says.
    const room = Math.max(0, 100 - team.chassis[plan.part]) / 100;
    const inTime =
      plan.targetSeason > world.season.year || daysToBuild(context, plan) <= context.daysLeftInSeason;
    if (!inTime) return 0;
    // What it is worth depends on what is being aimed at: this year's car or next year's.
    const forGoal =
      plan.targetSeason === world.season.year
        ? intent.goal === 'this-season'
          ? 1
          : 0.45
        : intent.goal === 'next-season'
          ? 1
          : 0.5;
    const races =
      plan.targetSeason === world.season.year ? remainingRaces(context) : world.season.calendar.length;
    return (
      expected *
      room *
      forGoal *
      Math.min(1, races / world.season.calendar.length) *
      (0.7 + 0.3 * car.reliability)
    );
  };

  const values = new Map(options.map((o) => [o, value(o)] as const));
  const best = Math.max(...values.values(), 1e-6);
  const evaluate = (plan: ProjectPlan): Evaluation => ({
    score: Math.max(0, values.get(plan)! / best),
    reasons: [`development.part.${plan.part}`, `development.season.${plan.targetSeason}`],
  });
  return chooseByScore(options, evaluate, competence, rng);
};

function remainingRaces(context: ProjectContext): number {
  return context.world.season.calendar.filter((r) => r.status !== 'completed').length;
}
