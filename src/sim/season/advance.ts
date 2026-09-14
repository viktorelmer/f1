/**
 * The weeks between races (docs/systems/car-development.md, plan 3.4). Moving the clock is not just
 * a date: the factory works, projects walk their stages, parts that are ready go on the car, and
 * teams start new ones when the office has room.
 *
 * Everything here is pure and seeded: the same world and the same date give the same factory.
 */
import type { Pack } from '@/data/schema/pack';
import {
  advanceDevelopment,
  installProject,
  isReady,
  startProject,
  validateProject,
} from '../car/development';
import { decideProject } from '../car/project-choice';
import { profileFromAttributes } from '../decide/decide';
import { streams } from '../rng/rng';
import { addDays, type GameDate } from '../types/game-date';
import type { TeamId, World } from '../types/world';

/**
 * Moves the clock to `date` and runs everything that happens on the way. The clock never goes
 * backwards, and a day is never worked twice.
 */
export function advanceTo(world: World, pack: Pack, date: GameDate): World {
  if (date <= world.date) return world;
  let next = world;
  let cursor: GameDate = world.date;
  // The factory works in weeks, whatever the player does with the calendar: parts are fitted and
  // new projects signed off on the same day of the week whether the clock moves in one step or ten.
  while (cursor < date) {
    const toBoundary = 7 - (((cursor % 7) + 7) % 7);
    const step = Math.min(date - cursor, toBoundary === 0 ? 7 : toBoundary);
    cursor = addDays(cursor, step);
    next = advanceDevelopment(next, pack, step, cursor);
    if (cursor % 7 === 0) {
      next = fitReadyParts(next);
      next = startNewProjects(next, pack, cursor);
    }
  }
  return { ...next, date };
}

/** A part that has run a race weekend has told the team what it was really worth. */
export function validateInstalled(world: World, pack: Pack, at: GameDate): World {
  const rng = streams(world.seed);
  let next = world;
  for (const project of world.projects.filter((p) => p.stage === 'installed'))
    next = validateProject(next, pack, project.id, at, rng(`dev:${project.id}:validation`));
  return next;
}

/**
 * Parts that are built go on the car. Whoever runs development decides: in manual the player's
 * parts wait in the garage until the player fits them (plan 5.19).
 */
function fitReadyParts(world: World): World {
  let next = world;
  for (const project of world.projects.filter(isReady)) {
    if (project.targetSeason !== world.season.year) continue;
    const manual =
      project.teamId === world.career.playerTeamId && world.career.delegation.development === 'manual';
    if (!manual) next = installProject(next, project.id);
  }
  return next;
}

/** How many projects a team keeps running at once: its appetite for development, 1 to 4. */
function projectAppetite(world: World, teamId: TeamId): number {
  const character = world.teams[teamId]!.character;
  return 1 + Math.round(character.developmentAggression * 3);
}

/** Teams with room in the office start something new; the technical director picks what. */
function startNewProjects(world: World, pack: Pack, at: GameDate): World {
  const rng = streams(world.seed);
  let next = world;
  for (const team of Object.values(world.teams)) {
    const manual = team.id === world.career.playerTeamId && world.career.delegation.development === 'manual';
    if (manual) continue;
    let active = next.projects.filter((p) => p.teamId === team.id && isWorking(next, p.id)).length;
    const want = projectAppetite(next, team.id);
    while (active < want) {
      const director = next.teams[team.id]!.staffIds.map((id) => next.staff[id]!).find(
        (s) => s.role === 'technical-director',
      );
      const decision = decideProject(
        {
          world: next,
          pack,
          teamId: team.id,
          active,
          daysLeftInSeason: daysLeft(next, at),
        },
        director ? profileFromAttributes(director.attributes) : { skill: 0, consistency: 0, rapport: 0 },
        {
          goal: daysLeft(next, at) < 60 ? 'next-season' : 'this-season',
          risk: team.character.riskAppetite,
          issuedBy: team.id === next.career.playerTeamId ? 'player' : 'team-character',
        },
        rng(`dev:${next.season.year}:${team.id}:${at}:${active}`),
      );
      const before = next.projects.length;
      next = startProject(
        next,
        pack,
        team.id,
        decision.choice,
        at,
        rng(`dev:${next.season.year}:${team.id}:${at}:${active}:gain`),
      );
      if (next.projects.length === before) break;
      active++;
    }
  }
  return next;
}

const isWorking = (world: World, id: string) => {
  const project = world.projects.find((p) => p.id === id);
  return (
    project !== undefined &&
    !isReady(project) &&
    project.stage !== 'installed' &&
    project.stage !== 'validated'
  );
};

/** Days from `at` to the last race of the season: what a part still has time to be worth. */
function daysLeft(world: World, at: GameDate): number {
  const last = world.season.calendar.at(-1);
  return last ? Math.max(0, last.raceDate - at) : 0;
}
