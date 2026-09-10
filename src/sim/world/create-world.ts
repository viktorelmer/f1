/**
 * createWorld(seed, pack, career) — the starting state of a career (plan M1, 5.11, section 10;
 * docs/systems/world.md).
 *
 * The world is fixed: everything visible comes from the pack without touching the seed. The seed
 * only draws hidden values and each team's first estimates of them, through named streams.
 */
import { balance } from '@/data/balance';
import type { Pack, PackStaff, PackTeam, StaffRole } from '@/data/schema/pack';
import { type DelegationPreset, resolveDelegation } from '../decide/delegation';
import { streams } from '../rng/rng';
import { clone } from '../util/clone';
import type {
  DepartmentState,
  Driver,
  DriverHidden,
  DriverId,
  EngineDeal,
  Season,
  Staff,
  Team,
  TeamHidden,
  TeamId,
  TeamKnowledge,
  World,
} from '../types/world';
import { drawDriverHidden, drawTeamHidden } from './hidden';
import { initialKnowledge } from './knowledge';

export type CareerSetup =
  | {
      /** Mode A: take over one of the pack's teams. */
      mode: 'takeover';
      teamId: TeamId;
      principalName: string;
      delegationPreset?: DelegationPreset;
    }
  | {
      /** Mode B: found a new team, the grid's twelfth. */
      mode: 'founder';
      principalName: string;
      delegationPreset?: DelegationPreset;
      team: {
        name: string;
        shortName: string;
        colours: { primary: string; secondary: string };
        baseCountry: string;
        baseCity: string;
      };
      engineSupplierId: string;
      /** Two free agents. */
      driverIds: readonly [DriverId, DriverId];
    };

/** Id of the team a founder creates. */
export const FOUNDER_TEAM_ID = 'founder';
const DEFAULT_PRESET: DelegationPreset = 'principal';

export class CareerSetupError extends Error {
  override name = 'CareerSetupError';
}

export function createWorld(seed: string, pack: Pack, career: CareerSetup): World {
  validateSetup(pack, career);
  const rng = streams(seed);
  const date = pack.manifest.startDate;

  // ── Deterministic part: straight from the pack ───────────────────────────────────────────
  const season = firstSeason(pack);
  const drivers: Driver[] = pack.drivers.map(({ hiddenRanges: _ranges, ...driver }) => clone(driver));
  const staff: Staff[] = pack.staff.map((person) => clone(person));
  const teams: Team[] = pack.teams.map((team) => teamFromPack(team, pack, drivers, staff, career));

  if (career.mode === 'founder') teams.push(foundTeam(pack, career, season.year, drivers, staff));

  const player = teams.find((t) => t.controller === 'player')!;
  const playerRoles = new Set<StaffRole>(
    staff.filter((s) => s.contract?.teamId === player.id).map((s) => s.role),
  );

  // ── Seeded part: hidden truth, then each team's estimates of it ─────────────────────────
  const driverHidden: Record<DriverId, DriverHidden> = Object.fromEntries(
    pack.drivers.map((d) => [d.id, drawDriverHidden(rng(`world:hidden:driver:${d.id}`), d.hiddenRanges)]),
  );
  const teamHidden: Record<TeamId, TeamHidden> = Object.fromEntries(
    teams.map((t) => {
      const ranges =
        t.id === FOUNDER_TEAM_ID
          ? pack.newTeam.hiddenRanges
          : pack.teams.find((p) => p.id === t.id)!.hiddenRanges;
      return [t.id, drawTeamHidden(rng(`world:hidden:team:${t.id}`), ranges)];
    }),
  );
  const knowledge: Record<TeamId, TeamKnowledge> = Object.fromEntries(
    teams.map((t) => {
      const scout = staff.find((s) => s.contract?.teamId === t.id && s.role === 'scout');
      return [t.id, initialKnowledge(t.id, scout, drivers, driverHidden, date, rng)];
    }),
  );

  const principalReputation = balance.career.principalReputation[career.mode];

  return {
    schemaVersion: 1,
    seed,
    pack: { id: pack.manifest.id, version: pack.manifest.version },
    date,
    season,
    career: {
      mode: career.mode,
      playerTeamId: player.id,
      principal: { name: career.principalName.trim(), reputation: principalReputation },
      delegation: resolveDelegation(career.delegationPreset ?? DEFAULT_PRESET, playerRoles),
      startSeason: season.year,
    },
    teams: byId(teams),
    drivers: byId(drivers),
    staff: byId(staff),
    engineSuppliers: byId(pack.engineSuppliers.map((e) => clone(e))),
    hidden: { drivers: driverHidden, teams: teamHidden },
    knowledge,
    projects: [],
    news: [],
    social: [],
  };
}

function byId<T extends { id: string }>(items: readonly T[]): Record<string, T> {
  return Object.fromEntries(items.map((item) => [item.id, item]));
}

function firstSeason(pack: Pack): Season {
  const calendar = [...pack.calendars].sort((a, b) => a.season - b.season)[0]!;
  return {
    year: calendar.season,
    preseasonTest: { ...calendar.preseasonTest },
    calendar: calendar.rounds.map((r) => ({
      round: r.round,
      trackId: r.trackId,
      raceDate: r.raceDate,
      format: r.sprint ? 'sprint' : 'standard',
      status: 'upcoming',
      sessions: [],
    })),
    standings: { drivers: {}, constructors: {} },
  };
}

function departments(source: PackTeam['departments']): Team['departments'] {
  const { morale, workload } = balance.career.startingDepartment;
  return Object.fromEntries(
    Object.entries(source).map(([name, d]): [string, DepartmentState] => [name, { ...d, morale, workload }]),
  ) as Team['departments'];
}

function racingLineUp(teamId: TeamId, drivers: readonly Driver[]): Team['drivers'] {
  const contracted = drivers.filter((d) => d.contract?.teamId === teamId);
  const race = contracted.filter((d) => d.contract?.role === 'race').map((d) => d.id);
  if (race.length !== 2) throw new Error(`Team "${teamId}" needs two race drivers, has ${race.length}`);
  return {
    race: [race[0]!, race[1]!],
    reserves: contracted.filter((d) => d.contract?.role === 'reserve').map((d) => d.id),
  };
}

function teamFromPack(
  team: PackTeam,
  pack: Pack,
  drivers: readonly Driver[],
  staff: readonly Staff[],
  career: CareerSetup,
): Team {
  const supplier = pack.engineSuppliers.find((e) => e.id === team.engine.supplierId)!;
  const works = supplier.worksTeamId === team.id;
  const engine: EngineDeal = {
    supplierId: supplier.id,
    works,
    untilSeason: team.engine.untilSeason,
    spec: { ...supplier.spec },
  };

  return {
    id: team.id,
    name: team.name,
    shortName: team.shortName,
    colours: { ...team.colours },
    base: { ...team.base },
    founded: team.founded,
    history: clone(team.history),
    controller: career.mode === 'takeover' && career.teamId === team.id ? 'player' : 'ai',
    engine,
    chassis: { ...team.chassis },
    facilities: { ...team.facilities },
    departments: departments(team.departments),
    finances: { ...team.finances, heritageFromSeason: firstSeason(pack).year },
    sponsors: clone(team.sponsors),
    reputation: { ...team.reputation },
    ownerExpectations: { kind: 'results', ...team.ownerExpectations },
    character: { ...team.character },
    drivers: racingLineUp(team.id, drivers),
    staffIds: staff.filter((s) => s.contract?.teamId === team.id).map((s) => s.id),
  };
}

/**
 * Career mode B (plan 5.11): a twelfth team with rented facilities, a customer engine a generation
 * behind, no heritage money for two seasons, no reputation, a skeleton staff and two free agents.
 * Mutates `drivers` and `staff` to sign the people who join.
 */
function foundTeam(
  pack: Pack,
  career: Extract<CareerSetup, { mode: 'founder' }>,
  startSeason: number,
  drivers: Driver[],
  staff: Staff[],
): Team {
  const tuning = balance.career.founder;
  const template = pack.newTeam;
  const supplier = pack.engineSuppliers.find((e) => e.id === career.engineSupplierId)!;
  const penalty = tuning.customerSpecPenalty;
  const reputation = tuning.startingReputation;

  career.driverIds.forEach((id) => {
    const driver = drivers.find((d) => d.id === id)!;
    driver.contract = {
      teamId: FOUNDER_TEAM_ID,
      role: 'race',
      salaryM: tuning.driverSalaryM,
      fromSeason: startSeason,
      untilSeason: startSeason + tuning.driverContractSeasons - 1,
      bonuses: { perPoint: 0, perPodium: 0, title: 0 },
      buyoutM: 0,
      numberOne: false,
    };
  });

  let engineers = 0;
  for (const terms of template.startingStaff) {
    const person = staff.find((s) => s.id === terms.staffId)!;
    person.contract = {
      teamId: FOUNDER_TEAM_ID,
      salaryM: terms.salaryM,
      fromSeason: startSeason,
      untilSeason: terms.untilSeason,
    };
    person.assignedDriverId =
      person.role === 'race-engineer' ? (career.driverIds[engineers++] ?? null) : null;
  }

  const minus = (value: number, by: number) => Math.max(1, value - by);
  return {
    id: FOUNDER_TEAM_ID,
    name: career.team.name.trim(),
    shortName: career.team.shortName.trim(),
    colours: { ...career.team.colours },
    base: { country: career.team.baseCountry, city: career.team.baseCity.trim() },
    founded: startSeason,
    history: {
      seasons: 0,
      constructorsTitles: 0,
      driversTitles: 0,
      wins: 0,
      podiums: 0,
      lastSeasons: [null, null, null],
    },
    controller: 'player',
    engine: {
      supplierId: supplier.id,
      works: false,
      untilSeason: startSeason + tuning.engineDealSeasons - 1,
      spec: {
        power: minus(supplier.spec.power, penalty.power),
        ersDeployment: minus(supplier.spec.ersDeployment, penalty.ersDeployment),
        fuelEfficiency: minus(supplier.spec.fuelEfficiency, penalty.fuelEfficiency),
        reliability: supplier.spec.reliability,
      },
    },
    chassis: { ...template.chassis },
    facilities: { ...template.facilities },
    departments: departments(template.departments),
    finances: {
      cashM: tuning.startingCapitalM - template.entryFeeM - template.depositM,
      debtM: 0,
      heritageBonusM: 0,
      heritageFromSeason: startSeason + tuning.heritageFreeSeasons,
    },
    sponsors: [],
    reputation: {
      fans: reputation,
      paddock: reputation,
      fia: reputation,
      sponsors: reputation,
      press: reputation,
    },
    ownerExpectations: {
      kind: 'survival',
      pointsBySeason: startSeason + tuning.pointsBySeason - 1,
      topFiveBySeason: startSeason + tuning.topFiveBySeason - 1,
    },
    character: { ...template.character },
    drivers: { race: [career.driverIds[0], career.driverIds[1]], reserves: [] },
    staffIds: template.startingStaff.map((s) => s.staffId),
  };
}

function validateSetup(pack: Pack, career: CareerSetup): void {
  const fail = (message: string): never => {
    throw new CareerSetupError(message);
  };
  if (career.principalName.trim() === '') fail('The team principal needs a name.');

  if (career.mode === 'takeover') {
    if (!pack.teams.some((t) => t.id === career.teamId)) fail(`Unknown team "${career.teamId}".`);
    return;
  }

  const { team, engineSupplierId, driverIds } = career;
  if (pack.teams.some((t) => t.id === FOUNDER_TEAM_ID))
    fail(`The pack already uses the id "${FOUNDER_TEAM_ID}".`);
  if (team.name.trim() === '' || team.shortName.trim() === '')
    fail('The new team needs a name and a short name.');
  if (team.shortName.trim().length > 12) fail('The short name is at most 12 characters.');
  for (const colour of [team.colours.primary, team.colours.secondary]) {
    if (!/^#[0-9a-fA-F]{6}$/.test(colour)) fail(`Colour "${colour}" is not #rrggbb.`);
  }
  if (!/^[A-Z]{2}$/.test(team.baseCountry)) fail(`"${team.baseCountry}" is not a country code.`);
  if (team.baseCity.trim() === '') fail('The new team needs a base city.');
  if (!pack.engineSuppliers.some((e) => e.id === engineSupplierId))
    fail(`Unknown engine supplier "${engineSupplierId}".`);

  if (driverIds[0] === driverIds[1]) fail('Pick two different drivers.');
  for (const id of driverIds) {
    const driver = pack.drivers.find((d) => d.id === id);
    if (!driver) fail(`Unknown driver "${id}".`);
    else if (driver.contract)
      fail(
        `"${driver.name}" is under contract with ${driver.contract.teamId}; a new team can only sign free agents.`,
      );
  }
  const unknownStaff = pack.newTeam.startingStaff.find(
    (s) => !pack.staff.some((p: PackStaff) => p.id === s.staffId),
  );
  if (unknownStaff) fail(`Unknown starting staff "${unknownStaff.staffId}".`);
}
