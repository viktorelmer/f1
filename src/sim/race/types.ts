/**
 * Race input and output (docs/systems/race.md). Everything is plain data, so a race can run in a
 * worker, a batch job or a test, and its input alone replays it.
 */
import type { Compound, DryCompound } from '@/data/schema/race-balance';
import type { PackGeometry, PackRegulation, PackTrack } from '@/data/schema/pack';
import type { DecisionMakerProfile } from '../decide/decide';
import type { CarPerformance, DriverId, TeamId } from '../types/world';

export type { Compound, DryCompound };
export type SectorIndex = 0 | 1 | 2;
export const SECTORS: readonly SectorIndex[] = [0, 1, 2];

// ── Weather (docs/systems/weather.md) ────────────────────────────────────────────────────────

/** Conditions at one minute of the timeline. Rain intensity is per sector: fronts arrive by sector. */
export type WeatherSample = {
  minute: number;
  airTempC: number;
  trackTempC: number;
  humidity: number;
  windKph: number;
  /** Meteorological direction the wind blows from, degrees clockwise from north. */
  windFromDeg: number;
  cloud: number;
  rain: [number, number, number];
};

/** The true weather of a race, minute by minute. An input: the race does not roll weather itself. */
export type WeatherTimeline = { samples: WeatherSample[] };

// ── Entries ──────────────────────────────────────────────────────────────────────────────────

export type RaceDriver = {
  pace: number;
  consistency: number;
  racecraft: number;
  tyreManagement: number;
  wetSkill: number;
  starts: number;
  qualifying: number;
  stamina: number;
  form: number;
  morale: number;
  fatigue: number;
};

export type RaceEntry = {
  driverId: DriverId;
  teamId: TeamId;
  driver: RaceDriver;
  car: CarPerformance;
  /** Pit-crew quality 1..100. */
  pitCrew: number;
  /** The team's strategist, who makes this car's strategy calls through decide(). */
  strategist: DecisionMakerProfile;
  /** Appetite for strategic risk from the team character, 0..1. */
  riskAppetite: number;
};

export type RaceInput = {
  seed: string;
  season: number;
  round: number;
  track: PackTrack;
  geometry: PackGeometry;
  regulation: PackRegulation;
  weather: WeatherTimeline;
  /** Starting order, pole first. */
  grid: DriverId[];
  entries: RaceEntry[];
};

// ── Strategy (docs/systems/race-strategy.md) ────────────────────────────────────────────────

export type Stint = { compound: Compound; laps: number };
/** Planned stints in order; a stop falls at the end of each stint but the last. */
export type StrategyPlan = { stints: Stint[] };
/** A stint on the race's own laps: `fromLap`..`toLap`, both inclusive. */
export type ScheduledStint = { compound: Compound; fromLap: number; toLap: number };
/** The strategist's plan from `timeS` on: the stint being driven and the ones after it. */
export type PlanRevision = { timeS: number; stints: ScheduledStint[] };

// ── Result ───────────────────────────────────────────────────────────────────────────────────

export type TrackStatus = 'green' | 'sc' | 'vsc';

export type RaceEventKind =
  | 'start'
  | 'overtake'
  /** Off the line: `detail.places` won (or lost, when `detail.bad` = 1: a car that bogged down). */
  | 'launch'
  /** An attack that did not come off: `driverId` kept `otherId` behind. */
  | 'defence'
  | 'pit'
  | 'safety-car'
  | 'safety-car-in'
  | 'vsc'
  | 'vsc-end'
  | 'drs-enabled'
  | 'mistake'
  | 'spin'
  | 'crash'
  | 'contact'
  | 'failure'
  | 'puncture'
  | 'retirement'
  | 'rain-start'
  | 'rain-stop'
  | 'strategy-call'
  | 'chequered-flag';

export type RaceEvent = {
  timeS: number;
  lap: number;
  sector: SectorIndex | null;
  kind: RaceEventKind;
  driverId: DriverId | null;
  otherId: DriverId | null;
  detail: Record<string, string | number>;
};

export type LapRecord = {
  lap: number;
  lapTimeS: number;
  /** Race time at the line that ends this lap: exact, where summing lap times drifts by rounding. */
  lineTimeS: number;
  sectorsS: [number, number, number];
  position: number;
  /** Time behind the leader's crossing of the same lap. */
  gapToLeaderS: number;
  /** The tyre the lap was driven on (on an in-lap, the set that comes off). */
  compound: Compound;
  tyreAge: number;
  /** Wear of that tyre at the end of the lap, 0..1 — the team's own telemetry, exact. */
  tyreWear: number;
  /** ERS battery at the line, 0..1. */
  battery: number;
  pitted: boolean;
  /** Seconds of the lap spent in the pit lane and box (0 without a stop). */
  pitLaneS: number;
  status: TrackStatus;
  /** Diagnostics for calibration: fuel at the end of the lap; clean air (no car close, no incident); any incident. */
  fuelKg: number;
  cleanAir: boolean;
  incident: boolean;
};

export type ClassifiedCar = {
  position: number;
  driverId: DriverId;
  teamId: TeamId;
  status: 'finished' | 'retired';
  retireReason: string | null;
  laps: number;
  totalTimeS: number;
  /** Behind the winner, in seconds; null when lapped or retired. */
  gapS: number | null;
  lapsDown: number;
  bestLapS: number | null;
  stops: number;
  compounds: Compound[];
  points: number;
};

export type ConditionsRecord = {
  lap: number;
  airTempC: number;
  trackTempC: number;
  humidity: number;
  windKph: number;
  windFromDeg: number;
  wetness: [number, number, number];
  grip: number;
  status: TrackStatus;
};

export type RaceResult = {
  classification: ClassifiedCar[];
  laps: Record<DriverId, LapRecord[]>;
  events: RaceEvent[];
  conditions: ConditionsRecord[];
  /** The plans chosen before the start. */
  plans: Record<DriverId, StrategyPlan>;
  /** Each car's plan as the race went: the starting plan at t = 0, then every revision. */
  planHistory: Record<DriverId, PlanRevision[]>;
  /** When each car got across the start line after the signal: its grid slot plus its launch. */
  launchS: Record<DriverId, number>;
};
