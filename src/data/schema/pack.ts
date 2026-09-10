/**
 * The public content-pack format (plan rule 5, docs/systems/world.md). Every pack — the default one
 * or a player's own — goes through `parsePack()`. Content types are inferred from these schemas,
 * so the format and the types cannot drift apart.
 */
import { z } from 'zod';
import { type GameDate, gameDate } from '@/sim/types/game-date';
import { CHASSIS_PARTS, chassisPartSchema } from './balance';

export { CHASSIS_PARTS, chassisPartSchema };

// ── Shared field types ─────────────────────────────────────────────────────────────────────────

export const idSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'ids are lower-case kebab-case');
const countrySchema = z.string().regex(/^[A-Z]{2}$/, 'country is an ISO 3166-1 alpha-2 code');
const colourSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'colour is #rrggbb');
const textSchema = z.string().trim().min(1);
/** 1..100 attribute or rating. */
const ratingSchema = z.number().int().min(1).max(100);
const unitSchema = z.number().min(0).max(1);
const moneySchema = z.number().min(0); // $M
const seasonSchema = z.number().int().min(1950).max(2200);

/** "YYYY-MM-DD" in the pack, a GameDate in the game. */
export const dateSchema = z.iso.date().transform((iso): GameDate => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return gameDate(y, m, d);
});

function rangeSchema(min: number, max: number) {
  return z
    .tuple([z.number().min(min).max(max), z.number().min(min).max(max)])
    .refine(([low, high]) => low <= high, 'range must be [low, high] with low <= high');
}

function exhaustive<const K extends readonly [string, ...string[]], V extends z.ZodType>(keys: K, value: V) {
  return z.strictObject(Object.fromEntries(keys.map((k) => [k, value])) as { [P in K[number]]: V });
}

// ── Enumerations ───────────────────────────────────────────────────────────────────────────────

export const FACILITIES = [
  'windTunnel',
  'cfdCluster',
  'simulator',
  'compositesShop',
  'dynoBench',
  'medicalCentre',
  'headquarters',
  'marketingSuite',
] as const;
export type Facility = (typeof FACILITIES)[number];

export const DEPARTMENTS = [
  'aerodynamics',
  'design',
  'production',
  'vehicleDynamics',
  'raceTeam',
  'dataAnalysis',
  'marketing',
  'commercial',
] as const;
export type Department = (typeof DEPARTMENTS)[number];

/** Staff roles (plan 5.5) — every delegation area of 5.19 maps onto one of them. */
export const STAFF_ROLES = [
  'technical-director',
  'head-of-aerodynamics',
  'race-engineer',
  'strategist',
  'sporting-director',
  'chief-mechanic',
  'operations-director',
  'commercial-director',
  'head-of-marketing',
  'scout',
  'driver-coach',
  'meteorologist',
  'head-of-data-analysis',
  'press-officer',
  'team-doctor',
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
/** Two race engineers per team, one per race driver; one of every other role. */
export const RACE_ENGINEERS_PER_TEAM = 2;

export const SETUP_PARAMETERS = [
  'frontWing',
  'rearWing',
  'brakeBias',
  'frontRideHeight',
  'rearRideHeight',
  'suspensionStiffness',
  'camber',
  'toe',
  'gearRatios',
] as const;
export type SetupParameter = (typeof SETUP_PARAMETERS)[number];

export const REPUTATION_AXES = ['fans', 'paddock', 'fia', 'sponsors', 'press'] as const;
export const SPONSOR_SLOTS = [
  'title',
  'sidepod',
  'rear-wing',
  'engine-cover',
  'front-wing',
  'overalls',
  'cap',
] as const;
export const POWER_UNIT_COMPONENTS = [
  'ice',
  'turbocharger',
  'mguH',
  'mguK',
  'energyStore',
  'controlElectronics',
  'exhaust',
  'gearbox',
] as const;

// ── Files ──────────────────────────────────────────────────────────────────────────────────────

export const manifestSchema = z.strictObject({
  id: idSchema,
  name: textSchema,
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'version is semver'),
  formatVersion: z.literal(1),
  /** First day of a career in this pack. */
  startDate: dateSchema,
  license: textSchema,
  attribution: z.array(textSchema),
});

export const setupSchema = exhaustive(SETUP_PARAMETERS, z.number().min(0).max(100));

export const trackSchema = z.strictObject({
  id: idSchema,
  name: textSchema,
  country: countrySchema,
  lengthKm: z.number().min(2).max(8),
  laps: z.number().int().min(20).max(90),
  /** Reference lap in seconds for the M2 lap-time model. */
  baseLapTime: z.number().min(50).max(150),
  /** Seconds lost to a pit stop, lane plus stop. */
  pitLoss: z.number().min(10).max(40),
  drsZones: z.number().int().min(0).max(4),
  profile: z.strictObject({
    aeroSensitivity: unitSchema,
    powerSensitivity: unitSchema,
    lowSpeedCorners: z.number().int().min(0).max(20),
    highSpeedCorners: z.number().int().min(0).max(20),
    /** Multiplier on tyre degradation; 1 is average. */
    tyreDegFactor: z.number().min(0.4).max(2),
    trackEvolution: unitSchema,
    overtakingDifficulty: unitSchema,
    safetyCarProbability: unitSchema,
    brakeWear: unitSchema,
    /** Kilograms of fuel per lap. */
    fuelPerLap: z.number().min(0.8).max(3),
  }),
  weather: z.strictObject({
    rainChance: unitSchema,
    airTempC: rangeSchema(-10, 50),
    /** How much warmer the asphalt runs than the air, °C. */
    trackTempOffsetC: rangeSchema(0, 35),
    windKph: rangeSchema(0, 80),
  }),
  /** Factory preset (plan 5.2): decent, never ideal. Positions on the 0..100 slider scale. */
  factorySetup: setupSchema,
});

const fractionSchema = z.number().min(0).max(1);

export const geometrySchema = z.strictObject({
  trackId: idSchema,
  viewBox: z.tuple([z.number(), z.number(), z.number().positive(), z.number().positive()]),
  /** SVG path starting at the start/finish line, drawn in the racing direction. */
  path: z.string().regex(/^M[\d\s.,MLCZ-]+$/i, 'path is SVG path data (M/L/C/Z)'),
  /** Where sectors 2 and 3 begin, as fractions of the lap. */
  sectors: z
    .tuple([fractionSchema, fractionSchema])
    .refine(([s2, s3]) => 0 < s2 && s2 < s3 && s3 < 1, 'sector starts must satisfy 0 < s2 < s3 < 1'),
  /** Fractions of the lap; `from > to` means the zone crosses the start/finish line. */
  drsZones: z.array(z.strictObject({ from: fractionSchema, to: fractionSchema })),
  pitLane: z.strictObject({ entry: fractionSchema, exit: fractionSchema }),
  source: textSchema,
});

export const engineSupplierSchema = z.strictObject({
  id: idSchema,
  name: textSchema,
  /** The team the manufacturer runs itself, if any. */
  worksTeamId: idSchema.nullable(),
  spec: z.strictObject({
    power: ratingSchema,
    ersDeployment: ratingSchema,
    fuelEfficiency: ratingSchema,
    reliability: ratingSchema,
  }),
  customerPriceM: moneySchema,
});

const contractTermsSchema = {
  salaryM: moneySchema,
  fromSeason: seasonSchema,
  untilSeason: seasonSchema,
};

export const driverContractSchema = z
  .strictObject({
    teamId: idSchema,
    role: z.enum(['race', 'reserve']),
    ...contractTermsSchema,
    /** Bonuses in $M. */
    bonuses: z.strictObject({ perPoint: moneySchema, perPodium: moneySchema, title: moneySchema }),
    buyoutM: moneySchema,
    /** Contractual number-one status. */
    numberOne: z.boolean(),
  })
  .refine((c) => c.fromSeason <= c.untilSeason, 'contract must end no earlier than it starts');

export const driverSchema = z.strictObject({
  id: idSchema,
  name: textSchema,
  nationality: countrySchema,
  birthDate: dateSchema,
  attributes: z.strictObject({
    pace: ratingSchema,
    consistency: ratingSchema,
    racecraft: ratingSchema,
    tyreManagement: ratingSchema,
    wetSkill: ratingSchema,
    qualifying: ratingSchema,
    starts: ratingSchema,
    feedback: ratingSchema,
    adaptability: ratingSchema,
    stamina: ratingSchema,
  }),
  personality: z.strictObject({
    ego: ratingSchema,
    loyalty: ratingSchema,
    marketability: ratingSchema,
    mediaSkill: ratingSchema,
    risk: ratingSchema,
  }),
  state: z.strictObject({
    form: ratingSchema,
    morale: ratingSchema,
    fitness: ratingSchema,
    fatigue: z.number().int().min(0).max(100),
  }),
  /** Ranges the seed draws hidden values from (plan section 10). */
  hiddenRanges: z.strictObject({
    potential: rangeSchema(1, 100),
    /** Development speed multiplier; 1 is average. */
    growthRate: rangeSchema(0.3, 2),
    injuryProneness: rangeSchema(0, 1),
  }),
  /** Personal sponsorship a pay driver brings, $M per season. */
  paymentM: moneySchema,
  contract: driverContractSchema.nullable(),
});

export const staffSchema = z.strictObject({
  id: idSchema,
  name: textSchema,
  nationality: countrySchema,
  birthDate: dateSchema,
  role: z.enum(STAFF_ROLES),
  attributes: z.strictObject({ skill: ratingSchema, consistency: ratingSchema }),
  reputation: ratingSchema,
  ambition: ratingSchema,
  /** Race engineers only: the driver they run. */
  assignedDriverId: idSchema.nullable(),
  contract: z
    .strictObject({ teamId: idSchema, ...contractTermsSchema })
    .refine((c) => c.fromSeason <= c.untilSeason, 'contract must end no earlier than it starts')
    .nullable(),
});

const departmentSchema = z.strictObject({
  headcount: z.number().int().min(0).max(1500),
  quality: ratingSchema,
});
const partRatingsSchema = exhaustive(CHASSIS_PARTS, ratingSchema);

export const sponsorDealSchema = z.strictObject({
  id: idSchema,
  brand: textSchema,
  slot: z.enum(SPONSOR_SLOTS),
  annualValueM: moneySchema,
  untilSeason: seasonSchema,
  /** Performance targets (plan 5.7); each met target pays `bonusM`. */
  kpis: z.array(
    z.strictObject({
      kind: z.enum(['top-n-finishes', 'constructors-position', 'followers', 'press-mentions']),
      target: z.number().positive(),
      /** For top-n-finishes: the position that counts. */
      position: z.number().int().min(1).max(24).nullable(),
      bonusM: moneySchema,
    }),
  ),
});

export const teamSchema = z.strictObject({
  id: idSchema,
  name: textSchema,
  shortName: z.string().trim().min(2).max(12),
  colours: z.strictObject({ primary: colourSchema, secondary: colourSchema }),
  base: z.strictObject({ country: countrySchema, city: textSchema }),
  founded: z.number().int().min(1900).max(2200),
  history: z.strictObject({
    seasons: z.number().int().min(0),
    constructorsTitles: z.number().int().min(0),
    driversTitles: z.number().int().min(0),
    wins: z.number().int().min(0),
    podiums: z.number().int().min(0),
    /** Constructors' positions of the last three seasons, oldest first; null if absent. */
    lastSeasons: z.tuple([
      z.number().int().min(1).nullable(),
      z.number().int().min(1).nullable(),
      z.number().int().min(1).nullable(),
    ]),
  }),
  engine: z.strictObject({ supplierId: idSchema, untilSeason: seasonSchema }),
  chassis: partRatingsSchema,
  /** Building levels, 0 (none) to 5. */
  facilities: exhaustive(FACILITIES, z.number().int().min(0).max(5)),
  departments: exhaustive(DEPARTMENTS, departmentSchema),
  finances: z.strictObject({
    cashM: z.number(),
    debtM: moneySchema,
    /** Historic ("heritage") payment per season. */
    heritageBonusM: moneySchema,
  }),
  sponsors: z.array(sponsorDealSchema),
  reputation: exhaustive(REPUTATION_AXES, ratingSchema),
  /** Career mode A: what the owners want, and how long they wait for it (plan 5.11). */
  ownerExpectations: z.strictObject({
    targetPosition: z.number().int().min(1).max(12),
    patienceSeasons: z.number().int().min(1).max(10),
  }),
  /** Rival AI character (plan 5.10): the intent this team's staff decide under. */
  character: z.strictObject({
    developmentAggression: unitSchema,
    riskAppetite: unitSchema,
    youthFocus: unitSchema,
    spendingEfficiency: unitSchema,
    sandbagging: unitSchema,
  }),
  hiddenRanges: z.strictObject({
    /** Wind-tunnel correlation: realised ÷ predicted part gain, minus 1. Negative = optimistic tunnel. */
    correlationBias: rangeSchema(-0.5, 0.5),
  }),
});

export const regulationSchema = z.strictObject({
  season: seasonSchema,
  points: z.strictObject({
    race: z.array(z.number().int().min(0)).min(1),
    sprint: z.array(z.number().int().min(0)).min(1),
  }),
  costCapM: moneySchema,
  /** Best-paid people outside the cap (plan 5.7). */
  costCapExemptTopEarners: z.number().int().min(0),
  /** Aero testing allowance by last season's constructors' position, % of the base. */
  aeroTestingAllowancePct: z.array(z.number().positive()).min(1),
  componentLimits: exhaustive(POWER_UNIT_COMPONENTS, z.number().int().min(1)),
  minWeightKg: z.number().positive(),
  tyreSetsPerWeekend: z.strictObject({ standard: z.number().int().min(1), sprint: z.number().int().min(1) }),
  rookieFp1SessionsPerTeam: z.number().int().min(0),
  /** A retired car is classified — and can score — if it covered this share of the race distance. */
  classifiedShareOfLaps: z.number().min(0).max(1),
});

export const calendarSchema = z.strictObject({
  season: seasonSchema,
  preseasonTest: z.strictObject({
    trackId: idSchema,
    startDate: dateSchema,
    days: z.number().int().min(1).max(6),
  }),
  rounds: z
    .array(
      z.strictObject({
        round: z.number().int().min(1),
        trackId: idSchema,
        raceDate: dateSchema,
        sprint: z.boolean(),
      }),
    )
    .min(1),
});

export const newTeamSchema = z.strictObject({
  entryFeeM: moneySchema,
  depositM: moneySchema,
  chassis: partRatingsSchema,
  facilities: exhaustive(FACILITIES, z.number().int().min(0).max(5)),
  departments: exhaustive(DEPARTMENTS, departmentSchema),
  /** Free-agent staff who join at founding, on these terms; every other role starts empty. */
  startingStaff: z.array(
    z.strictObject({ staffId: idSchema, salaryM: moneySchema, untilSeason: seasonSchema }),
  ),
  character: teamSchema.shape.character,
  hiddenRanges: teamSchema.shape.hiddenRanges,
});

// ── The whole pack ─────────────────────────────────────────────────────────────────────────────

const packShape = z.strictObject({
  manifest: manifestSchema,
  tracks: z.array(trackSchema).min(1),
  geometry: z.array(geometrySchema),
  engineSuppliers: z.array(engineSupplierSchema).min(1),
  teams: z.array(teamSchema).min(2),
  drivers: z.array(driverSchema),
  staff: z.array(staffSchema),
  regulations: z.array(regulationSchema).min(1),
  calendars: z.array(calendarSchema).min(1),
  newTeam: newTeamSchema,
});

export const packSchema = packShape.superRefine((pack, ctx) => {
  for (const issue of crossCheck(pack))
    ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path });
});

export type Pack = z.output<typeof packSchema>;
export type PackTrack = Pack['tracks'][number];
export type PackGeometry = Pack['geometry'][number];
export type PackTeam = Pack['teams'][number];
export type PackDriver = Pack['drivers'][number];
export type PackStaff = Pack['staff'][number];
export type PackEngineSupplier = Pack['engineSuppliers'][number];
export type PackRegulation = Pack['regulations'][number];
export type PackCalendar = Pack['calendars'][number];
export type DriverContract = z.output<typeof driverContractSchema>;
export type SponsorDeal = z.output<typeof sponsorDealSchema>;
export type Setup = z.output<typeof setupSchema>;

type Issue = { path: (string | number)[]; message: string };

/** Everything a single-field schema cannot see: references, uniqueness, team make-up, ordering. */
function crossCheck(pack: z.output<typeof packShape>): Issue[] {
  const issues: Issue[] = [];
  const fail = (path: Issue['path'], message: string) => issues.push({ path, message });

  const unique = (collection: string, ids: string[]) => {
    const seen = new Set<string>();
    ids.forEach((id, i) => {
      if (seen.has(id)) fail([collection, i, 'id'], `duplicate id "${id}"`);
      seen.add(id);
    });
    return seen;
  };

  const trackIds = unique(
    'tracks',
    pack.tracks.map((t) => t.id),
  );
  const teamIds = unique(
    'teams',
    pack.teams.map((t) => t.id),
  );
  const supplierIds = unique(
    'engineSuppliers',
    pack.engineSuppliers.map((e) => e.id),
  );
  // People share one id space, so a contract or assignment can never point at the wrong kind.
  unique('people', [...pack.drivers.map((d) => d.id), ...pack.staff.map((s) => s.id)]);
  unique(
    'sponsors',
    pack.teams.flatMap((t) => t.sponsors.map((s) => s.id)),
  );

  // Geometry: one per track, DRS zones matching the track's count.
  const geometryByTrack = new Map(pack.geometry.map((g) => [g.trackId, g]));
  pack.geometry.forEach((g, i) => {
    if (!trackIds.has(g.trackId))
      fail(['geometry', i, 'trackId'], `geometry for unknown track "${g.trackId}"`);
  });
  pack.tracks.forEach((t, i) => {
    const g = geometryByTrack.get(t.id);
    if (!g) fail(['tracks', i], `track "${t.id}" has no geometry`);
    else if (g.drsZones.length !== t.drsZones) {
      fail(
        ['tracks', i, 'drsZones'],
        `track "${t.id}" declares ${t.drsZones} DRS zones, geometry has ${g.drsZones.length}`,
      );
    }
  });

  // Engines.
  pack.engineSuppliers.forEach((e, i) => {
    if (e.worksTeamId === null) return;
    const works = pack.teams.find((t) => t.id === e.worksTeamId);
    if (!works) fail(['engineSuppliers', i, 'worksTeamId'], `unknown works team "${e.worksTeamId}"`);
    else if (works.engine.supplierId !== e.id) {
      fail(['engineSuppliers', i, 'worksTeamId'], `works team "${works.id}" does not use "${e.id}"`);
    }
  });
  pack.teams.forEach((t, i) => {
    if (!supplierIds.has(t.engine.supplierId)) {
      fail(['teams', i, 'engine', 'supplierId'], `unknown engine supplier "${t.engine.supplierId}"`);
    }
  });

  // Drivers: every contract points at a team; each team has exactly two race drivers and a reserve.
  pack.drivers.forEach((d, i) => {
    if (d.contract && !teamIds.has(d.contract.teamId)) {
      fail(['drivers', i, 'contract', 'teamId'], `unknown team "${d.contract.teamId}"`);
    }
  });
  pack.teams.forEach((t, i) => {
    const contracted = pack.drivers.filter((d) => d.contract?.teamId === t.id);
    const race = contracted.filter((d) => d.contract?.role === 'race').length;
    const reserve = contracted.filter((d) => d.contract?.role === 'reserve').length;
    if (race !== 2) fail(['teams', i], `team "${t.id}" has ${race} race drivers, needs exactly 2`);
    if (reserve < 1) fail(['teams', i], `team "${t.id}" has no reserve driver`);
  });

  // Staff: one of each role per team, two race engineers each running one of the team's drivers.
  const driverTeam = new Map(pack.drivers.map((d) => [d.id, d.contract]));
  pack.staff.forEach((s, i) => {
    if (s.contract && !teamIds.has(s.contract.teamId)) {
      fail(['staff', i, 'contract', 'teamId'], `unknown team "${s.contract.teamId}"`);
    }
    if (s.role === 'race-engineer' && s.contract) {
      const driver = s.assignedDriverId === null ? undefined : driverTeam.get(s.assignedDriverId);
      if (!driver || driver.teamId !== s.contract.teamId || driver.role !== 'race') {
        fail(
          ['staff', i, 'assignedDriverId'],
          `race engineer "${s.id}" must run a race driver of their own team`,
        );
      }
    } else if (s.role !== 'race-engineer' && s.assignedDriverId !== null) {
      fail(['staff', i, 'assignedDriverId'], `only race engineers are assigned to a driver`);
    }
  });
  pack.teams.forEach((t, i) => {
    const staff = pack.staff.filter((s) => s.contract?.teamId === t.id);
    for (const role of STAFF_ROLES) {
      const count = staff.filter((s) => s.role === role).length;
      const expected = role === 'race-engineer' ? RACE_ENGINEERS_PER_TEAM : 1;
      if (count !== expected) fail(['teams', i], `team "${t.id}" has ${count} × ${role}, needs ${expected}`);
    }
    const engineered = new Set(
      staff.filter((s) => s.role === 'race-engineer').map((s) => s.assignedDriverId),
    );
    if (engineered.size !== RACE_ENGINEERS_PER_TEAM) {
      fail(['teams', i], `team "${t.id}" race engineers must run different drivers`);
    }
  });

  // Seasons: every calendar has a regulation; rounds numbered 1..n, dates rising, tracks known.
  const regulationSeasons = new Set(pack.regulations.map((r) => r.season));
  pack.calendars.forEach((c, ci) => {
    if (!regulationSeasons.has(c.season))
      fail(['calendars', ci, 'season'], `no regulation for season ${c.season}`);
    if (!trackIds.has(c.preseasonTest.trackId)) {
      fail(['calendars', ci, 'preseasonTest', 'trackId'], `unknown track "${c.preseasonTest.trackId}"`);
    }
    let previous = c.preseasonTest.startDate;
    c.rounds.forEach((r, ri) => {
      if (r.round !== ri + 1)
        fail(['calendars', ci, 'rounds', ri, 'round'], `round ${r.round} out of sequence`);
      if (!trackIds.has(r.trackId))
        fail(['calendars', ci, 'rounds', ri, 'trackId'], `unknown track "${r.trackId}"`);
      if (r.raceDate <= previous)
        fail(['calendars', ci, 'rounds', ri, 'raceDate'], `round ${r.round} is not after the previous event`);
      previous = r.raceDate;
    });
  });
  const firstCalendar = [...pack.calendars].sort((a, b) => a.season - b.season)[0];
  if (firstCalendar && pack.manifest.startDate >= firstCalendar.preseasonTest.startDate) {
    fail(['manifest', 'startDate'], 'the career must start before the first pre-season test');
  }

  // Aero testing allowance must cover a founder team too.
  pack.regulations.forEach((r, i) => {
    if (r.aeroTestingAllowancePct.length < pack.teams.length + 1) {
      fail(
        ['regulations', i, 'aeroTestingAllowancePct'],
        `needs a value for ${pack.teams.length + 1} positions`,
      );
    }
  });

  // Founder mode: starting staff must be free agents, one per role at most.
  const staffById = new Map(pack.staff.map((s) => [s.id, s]));
  const startingRoles = new Set<string>();
  pack.newTeam.startingStaff.forEach(({ staffId: id }, i) => {
    const person = staffById.get(id);
    if (!person) return fail(['newTeam', 'startingStaff', i, 'staffId'], `unknown staff "${id}"`);
    if (person.contract)
      fail(['newTeam', 'startingStaff', i, 'staffId'], `"${id}" is under contract, not a free agent`);
    if (person.role !== 'race-engineer' && startingRoles.has(person.role)) {
      fail(['newTeam', 'startingStaff', i, 'staffId'], `two starting staff for role ${person.role}`);
    }
    startingRoles.add(person.role);
  });

  return issues;
}

export type ParsePackResult = { success: true; pack: Pack } | { success: false; issues: string[] };

/** Validates raw pack files. Issues read as "path: message", one per problem. */
export function parsePack(input: unknown): ParsePackResult {
  const result = packSchema.safeParse(input);
  if (result.success) return { success: true, pack: result.data };
  return {
    success: false,
    issues: result.error.issues.map((issue) => `${issue.path.join('.') || '(pack)'}: ${issue.message}`),
  };
}
