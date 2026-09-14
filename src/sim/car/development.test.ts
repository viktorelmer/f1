/**
 * Car development (docs/systems/car-development.md): a part takes months, the tunnel says what it
 * should give, the track says what it gave, and the difference is the factory's own correlation.
 */
import { describe, expect, it } from 'vitest';
import { balance } from '@/data/balance';
import { loadActivePack } from '@/data/packs/active';
import { streams } from '../rng/rng';
import { gameDate } from '../types/game-date';
import type { World } from '../types/world';
import { createWorld } from '../world/create-world';
import {
  advanceDevelopment,
  aeroAllowance,
  bedIn,
  freshnessPenalty,
  installProject,
  isReady,
  setPhilosophy,
  officeCapacity,
  projectCeiling,
  projectId,
  startProject,
  validateProject,
} from './development';

const pack = loadActivePack();
const TEAM = pack.teams[0]!.id;
const world = createWorld('development', pack, { mode: 'takeover', teamId: TEAM, principalName: 'Test' });
const at = gameDate(2027, 1, 10);
const rng = (name: string) => streams('development')(name);
const plan = { part: 'floor' as const, targetSeason: world.season.year, atrShare: 0.33 };
const idOf = (w: World) => w.projects[0]!.id;

const started = startProject(world, pack, TEAM, plan, at, rng('start'));

describe('starting a project', () => {
  it('hides what it is really worth and shows the team only a belief', () => {
    const project = started.projects[0]!;
    expect(project.id).toBe(projectId(TEAM, plan, at));
    expect(project.stage).toBe('concept');
    expect(started.hidden.projects[project.id]!.trueGain).toBeGreaterThan(0);
    // The belief is a range around the tunnel's number, not the truth.
    expect(project.expectedGain.basis.sd).toBeGreaterThan(0);
    expect(project.expectedGain.value).not.toBe(started.hidden.projects[project.id]!.trueGain);
  });

  it('finds more with better aerodynamicists and more tunnel', () => {
    const ceiling = projectCeiling(world, pack, TEAM, plan, 'balanced');
    const moreTunnel = projectCeiling(world, pack, TEAM, { ...plan, atrShare: 1 }, 'balanced');
    expect(moreTunnel).toBeGreaterThan(ceiling);

    const better = {
      ...world,
      teams: {
        ...world.teams,
        [TEAM]: {
          ...world.teams[TEAM]!,
          departments: {
            ...world.teams[TEAM]!.departments,
            aerodynamics: { ...world.teams[TEAM]!.departments.aerodynamics, quality: 95 },
          },
        },
      },
    };
    expect(projectCeiling(better, pack, TEAM, plan, 'balanced')).toBeGreaterThan(ceiling);
  });

  it('pays the philosophy that fits and charges the one that does not', () => {
    const neutral = projectCeiling(world, pack, TEAM, plan, 'balanced');
    expect(projectCeiling(world, pack, TEAM, plan, 'high-downforce')).toBeGreaterThan(neutral);
    expect(projectCeiling(world, pack, TEAM, plan, 'low-drag')).toBeLessThan(neutral);
  });

  it('hands the tunnel out by last season’s table', () => {
    expect(aeroAllowance(world, pack, TEAM)).toBeGreaterThan(0);
    expect(officeCapacity(world, TEAM, 3)).toBeGreaterThan(officeCapacity(world, TEAM, 8));
  });
});

describe('the months of work', () => {
  it('walks the stages and narrows the belief as it goes', () => {
    const s = balance.development.stages.days;
    let open = started;
    const first = open.projects[0]!.expectedGain.basis.sd;

    open = advanceDevelopment(open, pack, s.concept + 2, at);
    expect(open.projects[0]!.stage).toBe('research');

    open = advanceDevelopment(open, pack, s.research, at);
    expect(['research', 'design']).toContain(open.projects[0]!.stage);
    expect(open.projects[0]!.expectedGain.basis.sd).toBeLessThan(first);
    expect(open.projects[0]!.spentM).toBeGreaterThan(0);
  });

  it('gets there faster with a bigger office and slower with eight projects at once', () => {
    const days = 30;
    const one = advanceDevelopment(started, pack, days, at).projects[0]!;
    let busy = started;
    for (const part of ['frontWing', 'rearWing', 'sidepods', 'suspension', 'brakes', 'gearbox'] as const)
      busy = startProject(busy, pack, TEAM, { ...plan, part }, at, rng(`start:${part}`));
    const crowded = advanceDevelopment(busy, pack, days, at).projects[0]!;
    expect(progressOf(crowded)).toBeLessThan(progressOf(one));
  });
});

describe('a new part on the car', () => {
  it('is green: it costs reliability and beds in over the weeks', () => {
    const ready = advanceDevelopment(started, pack, 400, at);
    const fitted = installProject(ready, idOf(ready));
    expect(fitted.teams[TEAM]!.freshness.floor).toBe(1);
    expect(freshnessPenalty(fitted, TEAM)).toBeCloseTo(balance.development.freshness.reliabilityCost, 9);

    const later = bedIn(fitted, balance.development.freshness.beddedInAfterDays);
    expect(later.teams[TEAM]!.freshness.floor).toBe(0);
    expect(freshnessPenalty(later, TEAM)).toBe(0);
  });
});

describe('the season’s direction', () => {
  it('writes off part of the work in progress when it changes mid-season', () => {
    const working = advanceDevelopment(started, pack, 15, at);
    const before = working.projects[0]!.progress;
    const turned = setPhilosophy(working, TEAM, 'low-drag');
    expect(turned.teams[TEAM]!.philosophy).toBe('low-drag');
    expect(turned.projects[0]!.progress).toBeCloseTo(
      before * (1 - balance.development.philosophy.switchLossShare),
      9,
    );
    // Turning to the same direction costs nothing.
    expect(setPhilosophy(turned, TEAM, 'low-drag')).toBe(turned);
  });
});

describe('what the track says', () => {
  it('puts the true gain on the car, not the promise', () => {
    let open = advanceDevelopment(started, pack, 400, at);
    expect(isReady(open.projects[0]!)).toBe(true);
    const before = open.teams[TEAM]!.chassis.floor;
    const truth = open.hidden.projects[idOf(open)]!.trueGain;

    open = installProject(open, idOf(open));
    expect(open.projects[0]!.stage).toBe('installed');
    expect(open.teams[TEAM]!.chassis.floor).toBeCloseTo(before + truth, 6);
  });

  it('teaches the team about its own tunnel when the part has run', () => {
    let open = installProject(advanceDevelopment(started, pack, 400, at), idOf(started));
    const before = open.knowledge[TEAM]!.correlation;
    open = validateProject(open, pack, idOf(open), at, rng('validate'));

    const after = open.knowledge[TEAM]!.correlation;
    expect(open.projects[0]!.stage).toBe('validated');
    expect(after.basis.sd).toBeLessThan(before.basis.sd);
    // What the part gave is now known to the part of a tenth, not guessed.
    expect(open.projects[0]!.expectedGain.basis.sd).toBeLessThanOrEqual(
      balance.development.correlation.validationSd,
    );
  });

  it('converges on the truth about the tunnel over several upgrades', () => {
    const bias = world.hidden.teams[TEAM]!.correlationBias;
    let open = world;
    const far = Math.abs(open.knowledge[TEAM]!.correlation.basis.mean - bias);
    for (const part of ['floor', 'frontWing', 'rearWing', 'sidepods', 'brakes'] as const) {
      open = startProject(open, pack, TEAM, { ...plan, part }, at, rng(`converge:start:${part}`));
      const project = open.projects.at(-1)!;
      open = validateProject(
        installProject(advanceDevelopment(open, pack, 400, at), project.id),
        pack,
        project.id,
        at,
        rng(`converge:validate:${part}`),
      );
    }
    const now = Math.abs(open.knowledge[TEAM]!.correlation.basis.mean - bias);
    expect(now).toBeLessThan(far);
    expect(open.knowledge[TEAM]!.correlation.basis.sd).toBeLessThan(
      world.knowledge[TEAM]!.correlation.basis.sd,
    );
  });
});

/** Stages walked plus progress inside the current one: one number to compare two runs by. */
function progressOf(project: World['projects'][number]): number {
  const order = ['concept', 'research', 'design', 'production', 'installed', 'validated'];
  return order.indexOf(project.stage) + project.progress;
}
