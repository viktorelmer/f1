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
import type {
  Department,
  DriverContract,
  Facility,
  PackDriver,
  PackStaff,
  PackTeam,
  Setup,
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

export type { ChassisPart, Department, DriverContract, Facility, Setup, SponsorDeal, StaffRole };

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

/** The rule set for a season is pack content; the world refers to it by season. */
export type Regulation = { season: number };

// ── Later systems (sketched; refined by their milestones) ────────────────────────────────────

export type RnDStage = 'concept' | 'research' | 'design' | 'production' | 'installed' | 'validated';

/** An R&D project (plan 5.1, M6). Its expected gain is an estimate; the true gain is hidden. */
export type RnDProject = {
  id: string;
  teamId: TeamId;
  part: ChassisPart;
  targetSeason: number;
  stage: RnDStage;
  startedOn: GameDate;
  spentM: number;
  expectedGain: Estimate;
};

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
  /** Seconds a lap the car is still away from where it should be: setup running takes this down. */
  setupLossS: number;
  /** Laps spent on setup work this weekend. */
  setupLaps: number;
  /** Laps of running behind these estimates, for the screen. */
  laps: number;
};

export type TeamKnowledge = {
  drivers: Record<DriverId, { potential: Estimate }>;
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
  hidden: { drivers: Record<DriverId, DriverHidden>; teams: Record<TeamId, TeamHidden> };
  knowledge: Record<TeamId, TeamKnowledge>;
  projects: RnDProject[];
  news: NewsItem[];
  social: SocialPost[];
};

/** A saved career (M12 adds versioning and migrations). `savedAt` is written by the app layer. */
export type SaveGame = { format: 1; label: string; savedAt: string; world: World };
