/**
 * Domain model of a running career (plan 4.2, docs/systems/world.md).
 *
 * `World` is the dynamic state — what a save holds. Static content (tracks, geometry, regulations
 * by year) stays in the pack; the world names the pack it was built from. Everything that depends
 * on the seed lives in exactly two subtrees: `hidden` (truth) and `knowledge` (each team's
 * estimates of it). The player's view of the world is the world without `hidden`.
 *
 * Types of systems that arrive later (R&D, sessions, media) are sketched here with the fields the
 * plan already fixes; their milestones refine them.
 */
import type { ChassisPart } from '@/data/schema/balance';
import type { RnDStage } from '@/data/schema/development-balance';
import type { Compound, DryCompound } from '@/data/schema/race-balance';
import type { ProgrammeKind } from '@/data/schema/weekend-balance';
import type {
  Department,
  DriverContract,
  Facility,
  PackDriver,
  PackStaff,
  PackTeam,
  Setup,
  SetupParameter,
  SponsorDeal,
  StaffRole,
} from '@/data/schema/pack';
import type { DelegationSettings } from '../decide/delegation';
import type { Estimate } from '../knowledge/estimate';
import type { GameDate } from './game-date';

export type TeamId = string;
export type DriverId = string;
export type StaffId = string;
export type TrackId = string;
export type EngineSupplierId = string;

export type {
  ChassisPart,
  Department,
  DriverContract,
  Facility,
  Setup,
  SetupParameter,
  SponsorDeal,
  StaffRole,
};

// ── Car ───────────────────────────────────────────────────────────────────────────────────────

/** Car characteristics (plan 4.2). Ratings 0..100 unless noted; derived from parts, never stored. */
export type CarPerformance = {
  downforceLow: number;
  downforceHigh: number;
  /** Higher means more drag. */
  drag: number;
  aeroEfficiency: number;
  dirtyAirTolerance: number;
  mechanicalGrip: number;
  brakingStability: number;
  /** Higher means more prone to porpoising. */
  rideHeightSensitivity: number;
  /** Kilograms over the minimum weight. */
  weight: number;
  power: number;
  ersDeployment: number;
  fuelEfficiency: number;
  tyreManagement: number;
  /** 0..1 base reliability. */
  reliability: number;
};

export type PowerUnitSpec = {
  power: number;
  ersDeployment: number;
  fuelEfficiency: number;
  reliability: number;
};

/** One of the car's components (plan 5.1): its rating drives the characteristics. */
export type CarPart = { readonly part: ChassisPart; rating: number };

export type EngineDeal = {
  supplierId: EngineSupplierId;
  works: boolean;
  untilSeason: number;
  /** The spec this team actually gets: a founder's customer unit trails the works one. */
  spec: PowerUnitSpec;
};

// ── Team ──────────────────────────────────────────────────────────────────────────────────────

export type DepartmentState = { headcount: number; quality: number; morale: number; workload: number };

export type Finances = {
  cashM: number;
  debtM: number;
  heritageBonusM: number;
  /** A founder team earns no heritage payment before this season (plan 5.11). */
  heritageFromSeason: number;
};

export type OwnerExpectations =
  | { kind: 'results'; targetPosition: number; patienceSeasons: number }
  /** Founder mode (plan 5.11): seasons by which the team must score, and reach the top five. */
  | { kind: 'survival'; pointsBySeason: number; topFiveBySeason: number };

export type TeamCharacter = PackTeam['character'];
export type Reputation = PackTeam['reputation'];

export type Team = {
  id: TeamId;
  name: string;
  shortName: string;
  colours: PackTeam['colours'];
  base: PackTeam['base'];
  founded: number;
  history: PackTeam['history'];
  controller: 'player' | 'ai';
  engine: EngineDeal;
  chassis: Record<ChassisPart, number>;
  /**
   * How new each part is, 1 for one fitted today and 0 for one that has bedded in. A green part is
   * quick and fragile (docs/systems/car-development.md).
   */
  freshness: Record<ChassisPart, number>;
  /** The direction this team is developing in this season (plan 5.1). */
  philosophy: Philosophy;
  facilities: Record<Facility, number>;
  departments: Record<Department, DepartmentState>;
  finances: Finances;
  sponsors: SponsorDeal[];
  reputation: Reputation;
  ownerExpectations: OwnerExpectations;
  /** The intent this team's staff decide under when the AI runs it (plan 5.10). */
  character: TeamCharacter;
  drivers: { race: [DriverId, DriverId]; reserves: DriverId[] };
  staffIds: StaffId[];
};

/** A team run by the AI (plan 5.10): same systems, same `decide()`, the character as intent. */
export type Rival = Team & { controller: 'ai' };

// ── People ────────────────────────────────────────────────────────────────────────────────────

export type Driver = Omit<PackDriver, 'hiddenRanges'>;
export type StaffContract = NonNullable<PackStaff['contract']>;
export type Staff = PackStaff;
export type Contract = DriverContract | StaffContract;

export type DriverHidden = { potential: number; growthRate: number; injuryProneness: number };
export type TeamHidden = { correlationBias: number };

/** What a track hides: the setup the pack's preset is aiming at, and misses by this much. */
export type TrackHidden = { setupOffset: Setup };

// ── Season ────────────────────────────────────────────────────────────────────────────────────

export type SessionKind = 'fp1' | 'fp2' | 'fp3' | 'sprint-qualifying' | 'sprint' | 'qualifying' | 'race';

export type SessionResult = {
  session: SessionKind;
  classification: {
    driverId: DriverId;
    teamId: TeamId;
    position: number;
    laps: number;
    bestLapS: number | null;
    status: 'finished' | 'dnf' | 'dsq' | 'dns';
    points: number;
  }[];
};

export type RaceWeekend = {
  round: number;
  trackId: TrackId;
  raceDate: GameDate;
  format: 'standard' | 'sprint';
  status: 'upcoming' | 'completed';
  sessions: SessionResult[];
};

export type Season = {
  year: number;
  preseasonTest: { trackId: TrackId; startDate: GameDate; days: number };
  calendar: RaceWeekend[];
  standings: { drivers: Record<DriverId, number>; constructors: Record<TeamId, number> };
};

/**
 * The tyres a car has for a weekend: sets of each dry compound. Declared before the weekend, blind
 * to the weather (plan 5.3), and spent for real — practice, qualifying and the race all take sets
 * out of it. Intermediates and wets are not declared: the supplier brings them.
 */
export type TyreAllocation = Record<DryCompound, number>;

/** One run in practice: a programme and the tyre it goes out on (docs/systems/weekend.md). */
export type PracticeRun = { programme: ProgrammeKind; compound: Compound };

/** What a team is doing in a practice session, per car. A driver without a queue does not run. */
export type PracticePlan = Record<DriverId, readonly PracticeRun[]>;

/**
 * The weekend being played right now (docs/systems/weekend-play.md), or null between rounds.
 *
 * A weekend is not a function call but a state: it is opened, then moved on one session at a time,
 * then closed. That is the only reason a player can stop between FP2 and FP3 — and the reason an
 * interrupted weekend survives a save.
 */
export type WeekendProgress = {
  round: number;
  /** Fixed when the weekend opens: every session of it draws from this seed. */
  seed: string;
  /** The session waiting to be run; 'done' once the race is over and the weekend can be closed. */
  stage: SessionKind | 'done';
  /** What each car declared before the weekend, and what it has left right now. */
  tyres: Record<DriverId, TyreAllocation>;
  sets: Record<DriverId, TyreAllocation>;
  /** The practice programmes chosen so far; a session without one runs the default. */
  plans: Partial<Record<SessionKind, PracticePlan>>;
  /** What is on each car right now (docs/systems/setup.md): chosen before FP1, changed between sessions. */
  setups: Record<DriverId, Setup>;
  /** What each driver said about the car after the last session he ran. */
  notes: Record<DriverId, SetupNote[]>;
  /*
   * Results are not kept here: a session that has been run goes straight into its round on the
   * calendar, so the tables are the sum of the sessions at every moment, not only after Sunday.
   */
  /** The grid the race starts from, pole first — null until qualifying has run. */
  grid: DriverId[] | null;
  /** The grid the sprint starts from, on a sprint weekend. */
  sprintGrid: DriverId[] | null;
};

/** The rule set for a season is pack content; the world refers to it by season. */
export type Regulation = { season: number };

// ── Later systems (sketched; refined by their milestones) ────────────────────────────────────

export type { RnDStage };

/**
 * An R&D project (plan 5.1, docs/systems/car-development.md): one part, one target season, and a
 * gain nobody is sure of. `expectedGain` is what the team believes; the truth lives in
 * `world.hidden.projects` and is only learned by running the part.
 */
export type RnDProject = {
  id: string;
  teamId: TeamId;
  part: ChassisPart;
  /** The season the part is built for: this one, or next year's car. */
  targetSeason: number;
  stage: RnDStage;
  startedOn: GameDate;
  spentM: number;
  expectedGain: Estimate;
  /** How much of the current stage is done, 0..1. */
  progress: number;
  /** Share of the team's aero allowance this project is given, 0..1. */
  atrShare: number;
  /** The direction the team was running when the project started (plan 5.1). */
  philosophy: Philosophy;
};

/** What a project is worth once it is on the car — the number the tunnel never quite predicts. */
export type ProjectHidden = { trueGain: number };

/** The season's direction (plan 5.1): a bonus to projects that fit it, a penalty to the rest. */
export const PHILOSOPHIES = ['balanced', 'low-drag', 'high-downforce', 'braking-stability'] as const;
export type Philosophy = (typeof PHILOSOPHIES)[number];

/** A generated news story (plan 5.8, M9). Rumours may be false. */
export type NewsItem = {
  id: string;
  date: GameDate;
  kind: 'result' | 'transfer-rumour' | 'rival-comment' | 'pace-analysis' | 'regulation' | 'announcement';
  /** i18n key and parameters: news text is generated, not stored. */
  headlineKey: string;
  params: Record<string, string | number>;
  subjectIds: string[];
  reliable: boolean;
};

export type SocialPost = {
  id: string;
  date: GameDate;
  teamId: TeamId;
  kind: 'technical' | 'meme' | 'behind-the-scenes' | 'sponsor' | 'reaction';
  engagement: number;
};

// ── Knowledge ─────────────────────────────────────────────────────────────────────────────────

/** What one team believes about hidden values — each team its own, the AI included (plan 5.10). */
/**
 * What a team has worked out about the weekend it is at (docs/systems/weekend.md): the truth is the
 * track's degradation factor and its own car's fuel use, and practice running narrows both.
 */
export type WeekendKnowledge = {
  round: number;
  tyreDegradation: Estimate;
  fuelPerLapKg: Estimate;
  /** What the engineer of each car makes of the optimum setup, and the laps behind that reading. */
  setup: Record<DriverId, SetupKnowledge>;
  /** Laps of running behind these estimates, for the screen. */
  laps: number;
};

/**
 * The engineer's reading of the hidden optimum for one car (docs/systems/setup.md, plan 5.2): a
 * range per parameter, never a number, and the setup laps that narrowed it.
 */
export type SetupKnowledge = { reading: SetupReading; laps: number };

/** The recommendation on the setup screen: one `Estimate` per slider. */
export type SetupReading = Record<SetupParameter, Estimate>;

/**
 * What a driver reported after a run: which way the car is wrong, never by how much. `trusted` is
 * false when he named the wrong cause — he cannot tell, and neither can the player.
 */
export type SetupNote = {
  parameter: SetupParameter;
  direction: 'more' | 'less';
  trusted: boolean;
};

export type TeamKnowledge = {
  drivers: Record<DriverId, { potential: Estimate }>;
  /** What this team makes of its own wind tunnel: realised gain over predicted, minus one. */
  correlation: Estimate;
  /** What this team makes of everyone else's pace at the weekend it is at (plan 5.13). */
  rivals: Record<TeamId, Estimate>;
  /** Null before the team has looked at the coming weekend at all. */
  weekend: WeekendKnowledge | null;
};

// ── Career and world ──────────────────────────────────────────────────────────────────────────

export type CareerMode = 'takeover' | 'founder';

export type CareerState = {
  mode: CareerMode;
  playerTeamId: TeamId;
  principal: { name: string; reputation: number };
  delegation: DelegationSettings;
  startSeason: number;
};

export type World = {
  schemaVersion: 1;
  seed: string;
  pack: { id: string; version: string };
  date: GameDate;
  season: Season;
  /** The weekend in progress, or null between rounds (docs/systems/weekend-play.md). */
  weekend: WeekendProgress | null;
  career: CareerState;
  teams: Record<TeamId, Team>;
  drivers: Record<DriverId, Driver>;
  staff: Record<StaffId, Staff>;
  engineSuppliers: Record<
    EngineSupplierId,
    {
      id: EngineSupplierId;
      name: string;
      worksTeamId: TeamId | null;
      spec: PowerUnitSpec;
      customerPriceM: number;
    }
  >;
  hidden: {
    drivers: Record<DriverId, DriverHidden>;
    teams: Record<TeamId, TeamHidden>;
    /** What every project is really worth (docs/systems/car-development.md). */
    projects: Record<string, ProjectHidden>;
    /** How far each track's factory preset sits from its true optimum (docs/systems/setup.md). */
    tracks: Record<string, TrackHidden>;
  };
  knowledge: Record<TeamId, TeamKnowledge>;
  projects: RnDProject[];
  news: NewsItem[];
  social: SocialPost[];
};

/** A saved career (M12 adds versioning and migrations). `savedAt` is written by the app layer. */
export type SaveGame = { format: 1; label: string; savedAt: string; world: World };
