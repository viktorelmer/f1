import { describe, expect, it } from 'vitest';
import { balance } from '@/data/balance';
import { isLocalPack, loadActivePack } from '@/data/packs/active';
import type { Pack } from '@/data/schema/pack';
import { DELEGATION_AREAS } from '../decide/delegation';
import { gameDate } from '../types/game-date';
import type { World } from '../types/world';
import { fingerprint, stableStringify } from '../util/hash';
import { checkWorld } from './check-world';
import { type CareerSetup, CareerSetupError, createWorld, FOUNDER_TEAM_ID } from './create-world';
import { potentialSd } from './knowledge';

const pack = loadActivePack();

const TAKEOVER: CareerSetup = { mode: 'takeover', teamId: 'kestrel', principalName: '  Alex Morgan ' };
const FREE_AGENTS = pack.drivers.filter((d) => !d.contract).map((d) => d.id);
const FOUNDER: CareerSetup = {
  mode: 'founder',
  principalName: 'Alex Morgan',
  team: {
    name: 'Meridian Racing',
    shortName: 'Meridian',
    colours: { primary: '#2E8B57', secondary: '#F5F5F5' },
    baseCountry: 'GB',
    baseCity: 'Oxbridge',
  },
  engineSupplierId: 'rosso',
  driverIds: [FREE_AGENTS[0]!, FREE_AGENTS[11]!],
};

/** Everything the seed must not touch: the world minus the seed itself, hidden truth and estimates. */
function visible(world: World): string {
  const { seed: _seed, hidden: _hidden, knowledge: _knowledge, ...rest } = world;
  return stableStringify(rest);
}

describe('createWorld — career mode A (takeover)', () => {
  const world = createWorld('seed-a', pack, TAKEOVER);

  it('returns a valid world', () => {
    expect(checkWorld(world, pack)).toEqual([]);
  });

  it('hands the chosen team to the player and the other ten to the AI', () => {
    expect(Object.keys(world.teams)).toHaveLength(11);
    expect(world.career).toMatchObject({ mode: 'takeover', playerTeamId: 'kestrel', startSeason: 2027 });
    expect(Object.values(world.teams).filter((t) => t.controller === 'ai')).toHaveLength(10);
    expect(Object.values(world.teams).flatMap((t) => t.drivers.race)).toHaveLength(22);
  });

  it('keeps the owners’ expectations from the pack and a fully delegable staff', () => {
    expect(world.teams.kestrel!.ownerExpectations).toEqual({
      kind: 'results',
      targetPosition: 5,
      patienceSeasons: 3,
    });
    expect(world.career.delegation.development).toBe('manual');
    expect(world.career.delegation.setup).toBe('directed');
    expect(world.career.principal).toEqual({
      name: 'Alex Morgan',
      reputation: balance.career.principalReputation.takeover,
    });
  });

  it('starts on the pack’s start date with the 2027 calendar', () => {
    expect(world.date).toBe(gameDate(2027, 1, 4));
    expect(world.season.calendar).toHaveLength(22);
    expect(world.season.calendar.filter((r) => r.format === 'sprint')).toHaveLength(6);
  });

  it('gives works teams the works engine flag', () => {
    expect(world.teams.argent!.engine.works).toBe(true);
    expect(world.teams.marlowe!.engine.works).toBe(false);
  });
});

describe('createWorld — career mode B (founder)', () => {
  const world = createWorld('seed-b', pack, FOUNDER);
  const team = world.teams[FOUNDER_TEAM_ID]!;
  const tuning = balance.career.founder;

  it('returns a valid world', () => {
    expect(checkWorld(world, pack)).toEqual([]);
  });

  it('adds a twelfth team for 24 cars; all eleven pack teams stay with the AI', () => {
    expect(Object.keys(world.teams)).toHaveLength(12);
    expect(Object.values(world.teams).flatMap((t) => t.drivers.race)).toHaveLength(24);
    expect(team.controller).toBe('player');
    expect(pack.teams.every((t) => world.teams[t.id]!.controller === 'ai')).toBe(true);
  });

  it('pays the FIA entry fee and deposit up front and earns no heritage money for two seasons', () => {
    expect(team.finances.cashM).toBe(
      tuning.startingCapitalM - pack.newTeam.entryFeeM - pack.newTeam.depositM,
    );
    expect(team.finances.heritageBonusM).toBe(0);
    expect(team.finances.heritageFromSeason).toBe(2027 + tuning.heritageFreeSeasons);
  });

  it('starts from nothing: rented facilities, zero reputation, a customer engine a generation behind', () => {
    expect(Object.values(team.facilities).every((level) => level === 0)).toBe(true);
    expect(Object.values(team.reputation).every((r) => r === tuning.startingReputation)).toBe(true);
    const works = pack.engineSuppliers.find((e) => e.id === 'rosso')!.spec;
    expect(team.engine.works).toBe(false);
    expect(team.engine.spec.power).toBe(works.power - tuning.customerSpecPenalty.power);
    expect(team.engine.spec.ersDeployment).toBe(
      works.ersDeployment - tuning.customerSpecPenalty.ersDeployment,
    );
  });

  it('asks the owners for survival, not results', () => {
    expect(team.ownerExpectations).toEqual({ kind: 'survival', pointsBySeason: 2029, topFiveBySeason: 2032 });
  });

  it('signs the two chosen free agents and the skeleton staff', () => {
    expect(team.drivers.race).toEqual(FOUNDER.driverIds);
    for (const id of FOUNDER.driverIds)
      expect(world.drivers[id]!.contract).toMatchObject({ teamId: FOUNDER_TEAM_ID, role: 'race' });
    expect(team.staffIds).toHaveLength(pack.newTeam.startingStaff.length);
    const engineers = team.staffIds.map((id) => world.staff[id]!).filter((s) => s.role === 'race-engineer');
    expect(engineers.map((e) => e.assignedDriverId).sort()).toEqual([...FOUNDER.driverIds].sort());
  });

  it('cannot delegate areas nobody on the skeleton staff can run', () => {
    expect(world.career.delegation.scouting).toBe('manual');
    expect(world.career.delegation.hiring).toBe('manual');
    expect(world.career.delegation['race-radio']).toBe('directed');
    expect(DELEGATION_AREAS.filter((a) => world.career.delegation[a] !== 'manual').length).toBeGreaterThan(0);
  });

  it('knows nothing about potential without a scout', () => {
    const estimates = Object.values(world.knowledge[FOUNDER_TEAM_ID]!.drivers);
    expect(estimates.every((e) => e.potential.confidence === 0)).toBe(true);
  });

  it('refuses setups the rules do not allow', () => {
    const contracted = pack.drivers.find((d) => d.contract)!.id;
    const bad: CareerSetup[] = [
      { ...FOUNDER, driverIds: [contracted, FREE_AGENTS[1]!] },
      { ...FOUNDER, driverIds: [FREE_AGENTS[1]!, FREE_AGENTS[1]!] },
      { ...FOUNDER, engineSupplierId: 'steam-engines' },
      { ...FOUNDER, team: { ...FOUNDER.team, colours: { primary: 'green', secondary: '#FFFFFF' } } },
      { ...FOUNDER, principalName: '   ' },
      { ...TAKEOVER, teamId: 'no-such-team' },
    ];
    for (const setup of bad) expect(() => createWorld('s', pack, setup)).toThrow(CareerSetupError);
  });

  it('does not touch the pack it was built from', () => {
    const before = stableStringify(pack);
    createWorld('seed-b', pack, FOUNDER);
    expect(stableStringify(pack)).toBe(before);
  });
});

describe('the seed (plan section 10: a fixed world)', () => {
  for (const [label, career] of [
    ['mode A', TAKEOVER],
    ['mode B', FOUNDER],
  ] as const) {
    it(`leaves the visible world identical and varies hidden values — ${label}`, () => {
      const [a, b] = [createWorld('first seed', pack, career), createWorld('second seed', pack, career)];
      expect(visible(a)).toBe(visible(b));

      expect(fingerprint(a.hidden)).not.toBe(fingerprint(b.hidden));
      const drivers = Object.keys(a.hidden.drivers);
      const differing = drivers.filter(
        (id) => stableStringify(a.hidden.drivers[id]) !== stableStringify(b.hidden.drivers[id]),
      );
      expect(differing.length).toBeGreaterThan(drivers.length / 2);
      expect(fingerprint(a.knowledge)).not.toBe(fingerprint(b.knowledge));
    });
  }

  it('is deterministic: seed + pack + career → the same world', () => {
    const a = createWorld('M1', pack, TAKEOVER);
    expect(fingerprint(createWorld('M1', pack, TAKEOVER))).toBe(fingerprint(a));
  });

  // Pinned for the default pack only: a local pack has other content and so other hashes.
  it.skipIf(isLocalPack)('pins the default pack’s worlds to fixed hashes', () => {
    expect(fingerprint(createWorld('M1', pack, TAKEOVER))).toBe('1e6db09e1ecdfc');
    expect(fingerprint(createWorld('M1', pack, FOUNDER))).toBe('154f92d8072f74');
  });

  it('draws each driver from their own stream: adding a driver to the pack moves nobody else', () => {
    const newcomer = {
      ...pack.drivers[pack.drivers.length - 1]!,
      id: 'late-addition',
      name: 'Late Addition',
    };
    const bigger: Pack = { ...pack, drivers: [newcomer, ...pack.drivers] };

    const [before, after] = [createWorld('s', pack, TAKEOVER), createWorld('s', bigger, TAKEOVER)];
    for (const id of Object.keys(before.hidden.drivers))
      expect(after.hidden.drivers[id]).toEqual(before.hidden.drivers[id]);
    expect(after.knowledge.kestrel!.drivers['daan-vermeer']).toEqual(
      before.knowledge.kestrel!.drivers['daan-vermeer'],
    );
  });
});

describe('knowledge at the start of a career', () => {
  const world = createWorld('knowledge', pack, TAKEOVER);

  it('gives every team, the AI included, its own estimates — never the truth', () => {
    const truth = world.hidden.drivers['enzo-marchetti']!.potential;
    const byTeam = Object.values(world.knowledge).map((k) => k.drivers['enzo-marchetti']!.potential);
    expect(byTeam).toHaveLength(11);
    expect(new Set(byTeam.map((e) => e.value)).size).toBeGreaterThan(1);
    for (const e of byTeam) expect(JSON.stringify(e)).not.toContain(`"truth"`);
    // The estimate is close to the truth but carries its own noise.
    expect(byTeam.some((e) => e.value !== truth)).toBe(true);
  });

  it('reads a team’s own drivers more tightly, and a better scout reads everyone more tightly', () => {
    const scoutSkill = (teamId: string) =>
      world.teams[teamId]!.staffIds.map((id) => world.staff[id]!).find((s) => s.role === 'scout')!.attributes
        .skill;
    const own = world.knowledge.marlowe!.drivers['liam-whitaker']!.potential;
    const rival = world.knowledge.marlowe!.drivers['daan-vermeer']!.potential;
    expect(own.basis.sd).toBeCloseTo(potentialSd(scoutSkill('marlowe'), true), 10);
    expect(rival.basis.sd).toBeCloseTo(potentialSd(scoutSkill('marlowe'), false), 10);
    expect(own.basis.sd).toBeLessThan(rival.basis.sd);
    expect(potentialSd(90, false)).toBeLessThan(potentialSd(60, false));
  });
});
