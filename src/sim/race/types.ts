/**
 * Race input and output (docs/systems/race.md). Everything is plain data, so a race can run in a
 * worker, a batch job or a test, and its input alone replays it.
 */
import type { Compound, DryCompound } from '@/data/schema/race-balance';
import type { PackGeometry, PackRegulation, PackTrack } from '@/data/schema/pack';
import type { DecisionMakerProfile } from '../decide/decide';
import type { DelegationMode } from '../decide/delegation';
import type { Estimate } from '../knowledge/estimate';
import type { GameDate } from '../types/game-date';
import type { CarPerformance, DriverId, TeamId, TyreAllocation } from '../types/world';

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
  /** Personality, for how a driver takes team orders. */
  ego: number;
  loyalty: number;
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
  /** The car's race engineer, who runs its radio (pace, ERS, aggression) through decide(). */
  raceEngineer: DecisionMakerProfile;
  /** Appetite for strategic risk from the team character, 0..1. */
  riskAppetite: number;
  /**
   * What the team believes about this weekend after its practice running (docs/systems/weekend.md).
   * The strategist plans on these; the race itself runs on the truth. A team that skipped practice
   * believes its prior, and plans worse.
   */
  beliefs: {
    tyreDegradation: number;
    fuelPerLapKg: number;
    /** How sure the team is of that fuel figure: the less sure, the more it carries just in case. */
    fuelSdKg: number;
  };
  /** Seconds a lap the car is off its optimum setup: practice running takes this down (plan 5.3). */
  setupLossS: number;
  /**
   * Fresh sets left of each dry compound when the race starts, out of the weekend's entry
   * (docs/systems/weekend-play.md). Absent means the race is run without an allocation behind it —
   * the batch runner's shortcut and the tests'.
   */
  tyreSets?: TyreAllocation;
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
  /** The day of the race, for the estimates the race produces. */
  raceDate: GameDate;
  /**
   * A sprint is the same race over a third of the distance, on its own points, and without the rule
   * that a dry race must use two compounds (plan 5.3).
   */
  format: 'race' | 'sprint';
  /** Laps of this event: the track's distance for a race, a share of it for a sprint. */
  distanceLaps: number;
  /** The player's team and how it is run; null in a race without a player (batch runs). */
  control: RaceControl | null;
  /** What the player said and when, in race time (docs/systems/race-control.md). */
  commands: RaceCommand[];
};

// ── Control: radio, team orders, delegation, commands (docs/systems/race-control.md) ─────────

export type PaceMode = 'push' | 'neutral' | 'save-tyres' | 'save-fuel';
export type ErsMode = 'attack' | 'balanced' | 'harvest';
export type Aggression = 'calm' | 'normal' | 'aggressive';
export type RadioSettings = { pace: PaceMode; ers: ErsMode; aggression: Aggression };
export type TeamOrder = 'free' | 'hold' | 'swap';

/** What the strategist should aim for: the fastest race, or winning places, or keeping one. */
export type StrategyGoal = 'fastest' | 'gain-places' | 'hold-position';

export type RaceControl = {
  teamId: TeamId;
  /** Race strategy: the player, or the strategist under the player's instruction or on their own. */
  strategy: { mode: DelegationMode; risk: number; goal: StrategyGoal };
  /** Race radio: the player, or the race engineers. Aggression and saving are the instruction. */
  radio: { mode: DelegationMode; aggression: Aggression; saving: 'none' | 'tyres' | 'fuel' };
  /** Plans the player chose before the start (manual strategy), by driver. */
  plans: Record<DriverId, StrategyPlan>;
};

export type PitAnswer = { call: 'stay' } | { call: 'pit'; compound: Compound };

/** A player command, effective from the car's first sector entry at or after `timeS`. */
export type RaceCommand =
  | { timeS: number; kind: 'radio'; driverId: DriverId; radio: Partial<RadioSettings> }
  | { timeS: number; kind: 'pit'; driverId: DriverId; compound: Compound }
  /** A new plan with this many more stops, the strategist laying out the stints from here. */
  | { timeS: number; kind: 'plan'; driverId: DriverId; stops: number }
  /** The answer to the strategist's decision taken at `timeS` (a pause-and-suggest or manual call). */
  | { timeS: number; kind: 'call'; driverId: DriverId; answer: PitAnswer }
  | { timeS: number; kind: 'team-order'; teamId: TeamId; order: TeamOrder }
  | { timeS: number; kind: 'control'; strategy?: RaceControl['strategy']; radio?: RaceControl['radio'] };

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
  /** A radio call to one of the player's cars: `detail` holds what changed and `by` player/engineer. */
  | 'radio'
  /** A team order given to the player's team. */
  | 'team-order'
  /** A driver ignoring a team order. */
  | 'order-refused'
  /** A teammate let through on orders: `driverId` passes, `otherId` yields. */
  | 'let-by'
  /** The stewards adding seconds to a driver's race for causing a collision. */
  | 'penalty'
  | 'chequered-flag';

export type RaceEvent = {
  timeS: number;
  lap: number;
  /** Which segment of the lap it happened in (docs/systems/lap-segments.md); null for race-wide events. */
  segment: number | null;
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
  /** Time in each segment of the lap; the three timing sectors are sums of these. */
  segmentsS: number[];
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
  /** Race time including any penalty the stewards added at the flag. */
  totalTimeS: number;
  /** Seconds the stewards added, 0 for a clean race. */
  penaltyS: number;
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
  /** The player's team, as the pit wall saw it: forecasts, decisions and radio (null without a player). */
  pitWall: PitWall | null;
  /**
   * Fresh sets each car has left after the race (docs/systems/weekend-play.md). Empty when the race
   * was run without an allocation behind it; on a sprint weekend this is what Sunday is left with.
   */
  tyreSets: Record<DriverId, TyreAllocation>;
};

/** One of the strategist's decisions for the player's team, with everything considered. */
export type StrategyDecision = {
  timeS: number;
  lap: number;
  driverId: DriverId;
  trigger: 'safety-car' | 'weather' | 'damage' | 'puncture';
  options: {
    answer: PitAnswer;
    /** Expected seconds to the flag in the strategist's model. */
    expectedS: number;
  }[];
  /** Index of the strategist's pick, and of what was done. */
  recommended: number;
  applied: number;
  /** Who settled it: the strategist, the player, or nobody yet (manual mode: stay out until answered). */
  by: 'strategist' | 'player' | 'unanswered';
};

export type PitWall = {
  teamId: TeamId;
  /** The strategist's finish forecast and pit window at each of the car's line crossings. */
  forecasts: Record<
    DriverId,
    { lap: number; timeS: number; position: Estimate; window: [number, number] | null }[]
  >;
  decisions: StrategyDecision[];
  /** Radio settings over the race: what the car ran from each time on. */
  radio: Record<DriverId, { timeS: number; settings: RadioSettings }[]>;
};
