/**
 * A race weekend as state, not as a function call (docs/systems/weekend-play.md).
 *
 * A weekend is opened, moved on one session at a time, and closed. That is what lets a player stop
 * between FP2 and FP3, walk into a session and drive it, and pick the weekend up again after a
 * reload — and it is the only weekend code path there is: `runWeekend()` below is the same loop
 * with nobody watching, so "play it" and "simulate it" cannot drift apart.
 *
 * Pure, like everything in `sim`: the same world, round and seed give the same weekend, whether it
 * is run session by session or in one go (a test pins that).
 */
import type { Pack } from '@/data/schema/pack';
import { buildRaceInput, type RaceControlInput } from '../race/build-input';
import { simulateRace } from '../race/simulate';
import type { RaceCommand, RaceControl, RaceInput, RaceResult } from '../race/types';
import type {
  DriverId,
  PracticePlan,
  RaceWeekend,
  SessionKind,
  SessionResult,
  TeamId,
  TyreAllocation,
  WeekendProgress,
  World,
} from '../types/world';
import { defaultPlan, type PracticeCommand, type PracticeResult, runPractice } from '../weekend/practice';
import { type QualifyingCommand, type QualifyingResult, runQualifying } from '../weekend/qualifying';
import { declareTyres } from '../weekend/tyres';
import { isPractice, WEEKEND_SESSIONS } from '../weekend/format';
import { standings } from './standings';

export { isPractice, PRACTICE_SESSIONS, WEEKEND_SESSIONS } from '../weekend/format';

/** What a session leaves behind besides its classification — what a screen needs to show it. */
export type SessionDetail =
  | { kind: 'practice'; practice: PracticeResult }
  | { kind: 'qualifying'; qualifying: QualifyingResult }
  | { kind: 'race'; input: RaceInput; result: RaceResult };

export type SessionOutcome = {
  /** The world with the session filed, the knowledge it taught, and the stage moved on. */
  world: World;
  stage: SessionKind;
  session: SessionResult;
  detail: SessionDetail;
};

export type SessionOptions = {
  /** The player's side of a race or sprint (docs/systems/race-control.md). */
  control?: RaceControl | null;
  commands?: readonly RaceCommand[];
  /** The programmes for this practice session, over what the weekend already carries. */
  plans?: PracticePlan;
  /** What the player changed mid-session, in session time (docs/systems/weekend-play.md). */
  practiceCommands?: readonly PracticeCommand[];
  /** When the player sent a car out in qualifying, in session time. */
  qualifyingCommands?: readonly QualifyingCommand[];
};

export type WeekendOptions = RaceControlInput & {
  plans?: Partial<Record<SessionKind, PracticePlan>>;
};

export type WeekendOutcome = {
  /** The world after the weekend: results filed, standings updated, the date moved to race day. */
  world: World;
  sessions: SessionResult[];
  /** The race itself, for the screen and for anyone who wants the detail. */
  input: RaceInput;
  result: RaceResult;
  sprint: { input: RaceInput; result: RaceResult } | null;
};

// ── The state machine ─────────────────────────────────────────────────────────────────────────

/**
 * Opens the weekend of `round`: nothing has been run, the first session of the format is next, and
 * every car has declared its tyres — blind to the weather, as the rules require (plan 5.3).
 */
export function openWeekend(world: World, pack: Pack, round: number, seed: string = world.seed): World {
  const open = world.weekend;
  if (open) {
    if (open.round === round) return world;
    throw new Error(`The weekend of round ${open.round} is still open`);
  }
  const weekend = roundOf(world, round);
  const sessions = WEEKEND_SESSIONS[weekend.format];
  const regulation = pack.regulations.find((r) => r.season === world.season.year) ?? pack.regulations[0]!;
  const tyres = declareTyres(
    buildRaceInput(world, pack, round, seed),
    sessions,
    regulation.tyreSetsPerWeekend[weekend.format],
  );
  return {
    ...world,
    weekend: {
      round,
      seed,
      stage: sessions[0]!,
      tyres,
      sets: Object.fromEntries(Object.entries(tyres).map(([id, sets]) => [id, { ...sets }])),
      plans: {},
      grid: null,
      sprintGrid: null,
    },
  };
}

/**
 * The player's own declaration, over what their strategist would have taken. Only before the
 * weekend has run: once a session is on the board the sets are spent, not declared.
 */
export function setTyreEntry(world: World, driverId: DriverId, entry: TyreAllocation): World {
  const open = mustBeOpen(world);
  const weekend = roundOf(world, open.round);
  if (weekend.sessions.length > 0)
    throw new Error(`Round ${open.round} has already run a session: the entry stands`);
  return {
    ...world,
    weekend: {
      ...open,
      tyres: { ...open.tyres, [driverId]: entry },
      sets: { ...open.sets, [driverId]: { ...entry } },
    },
  };
}

/** The programme a car runs in a practice session, kept until that session is run. */
export function planPractice(world: World, session: SessionKind, plan: PracticePlan): World {
  const open = mustBeOpen(world);
  return { ...world, weekend: { ...open, plans: { ...open.plans, [session]: plan } } };
}

/**
 * Runs the session the weekend is waiting on and hands back the world it leaves behind: the result
 * filed into its round on the calendar, whatever the session taught in `knowledge`, and the stage
 * moved to the next session of the format.
 */
export function runSession(world: World, pack: Pack, options: SessionOptions = {}): SessionOutcome {
  const open = mustBeOpen(world);
  const stage = open.stage;
  if (stage === 'done') throw new Error(`The weekend of round ${open.round} has no session left to run`);

  const ran =
    stage === 'qualifying' || stage === 'sprint-qualifying'
      ? qualifyingStage(world, pack, open, stage, options)
      : stage === 'race' || stage === 'sprint'
        ? raceStage(world, pack, open, stage, options)
        : practiceStage(world, pack, open, stage, options);

  const after = fileSession(ran.world, open.round, ran.session);
  return {
    world: { ...after, weekend: { ...ran.progress, stage: nextStage(world, open.round, stage) } },
    stage,
    session: ran.session,
    detail: ran.detail,
  };
}

/** Closes a weekend whose sessions have all been run: the round is completed, the date is race day. */
export function closeWeekend(world: World): World {
  const open = mustBeOpen(world);
  if (open.stage !== 'done') throw new Error(`The weekend of round ${open.round} still has ${open.stage}`);
  const weekend = roundOf(world, open.round);
  const calendar = world.season.calendar.map((r) =>
    r.round === open.round ? { ...r, status: 'completed' as const } : r,
  );
  const season = { ...world.season, calendar };
  return {
    ...world,
    weekend: null,
    // The clock never goes backwards: a weekend closed late leaves the later date standing.
    date: world.date > weekend.raceDate ? world.date : weekend.raceDate,
    season: { ...season, standings: standings(season) },
  };
}

/**
 * The race (or sprint) the weekend is waiting on, built but not run — what the pit wall plans on
 * before the lights and what the screen replays.
 */
export function sessionRaceInput(world: World, pack: Pack, options: SessionOptions = {}): RaceInput {
  const open = mustBeOpen(world);
  if (open.stage !== 'race' && open.stage !== 'sprint')
    throw new Error(`Round ${open.round} is at ${open.stage}, which is not a race`);
  return raceInput(world, pack, open, open.stage, options);
}

// ── The weekend run whole ─────────────────────────────────────────────────────────────────────

/**
 * A whole weekend in one call: the same state machine with nobody watching. Used by the season
 * loop, the batch runner and anyone who wants Sunday without Friday.
 */
export function runWeekend(
  world: World,
  pack: Pack,
  round: number,
  seed: string = world.seed,
  options: WeekendOptions = {},
): WeekendOutcome {
  const { plans = {}, ...control } = options;
  let open = withPlans(openWeekend(world, pack, round, seed), plans);
  const sessions: SessionResult[] = [];
  let race: { input: RaceInput; result: RaceResult } | null = null;
  let sprint: { input: RaceInput; result: RaceResult } | null = null;
  while (open.weekend!.stage !== 'done') {
    const outcome = runSession(open, pack, control);
    sessions.push(outcome.session);
    if (outcome.detail.kind === 'race') {
      const run = { input: outcome.detail.input, result: outcome.detail.result };
      if (outcome.stage === 'sprint') sprint = run;
      else race = run;
    }
    open = outcome.world;
  }
  return { world: closeWeekend(open), sessions, input: race!.input, result: race!.result, sprint };
}

// ── One session at a time ─────────────────────────────────────────────────────────────────────

type StageRun = { world: World; progress: WeekendProgress; session: SessionResult; detail: SessionDetail };

/**
 * A practice session: the programmes are run, and what each team learns from them goes into its
 * knowledge. A team's weekend knowledge is per round — what it worked out at the last track says
 * nothing about this one, so anything left over from another round is not built on.
 */
function practiceStage(
  world: World,
  pack: Pack,
  open: WeekendProgress,
  stage: SessionKind,
  options: SessionOptions,
): StageRun {
  const weekend = roundOf(world, open.round);
  const race = buildRaceInput(world, pack, open.round, open.seed, controlOf(options));
  const knownOf = (teamId: TeamId) => {
    const known = world.knowledge[teamId]?.weekend;
    return known && known.round === open.round ? known : null;
  };
  const result = runPractice({
    race,
    session: stage,
    at: weekend.raceDate,
    // A plan says what the cars in it do; every other car runs what a team would normally run, so
    // choosing a programme for two cars never parks the other twenty.
    plans: { ...defaultPlan(race.entries, stage), ...(options.plans ?? open.plans[stage] ?? {}) },
    commands: options.practiceCommands,
    dataAnalysis: Object.fromEntries(
      Object.values(world.teams).map((t) => [t.id, t.departments.dataAnalysis.quality]),
    ),
    known: Object.fromEntries(Object.keys(world.knowledge).map((id) => [id, knownOf(id)])),
    rivals: Object.fromEntries(Object.entries(world.knowledge).map(([id, k]) => [id, k.rivals])),
    // What a car has found so far this weekend shows in how quick it looks to everyone else.
    setupLossS: Object.fromEntries(
      race.entries.map((e) => [e.driverId, knownOf(e.teamId)?.setupLossS ?? e.setupLossS]),
    ),
    sets: open.sets,
  });

  const knowledge = { ...world.knowledge };
  for (const [teamId, learned] of Object.entries(result.learned)) {
    const team = knowledge[teamId];
    if (team) knowledge[teamId] = { ...team, weekend: learned, rivals: result.rivals[teamId] ?? team.rivals };
  }
  return {
    world: { ...world, knowledge },
    progress: { ...open, sets: result.setsLeft },
    session: result.session,
    detail: { kind: 'practice', practice: result },
  };
}

/** Qualifying, or a sprint weekend's own: the order it leaves is the grid of the race it settles. */
function qualifyingStage(
  world: World,
  pack: Pack,
  open: WeekendProgress,
  stage: 'qualifying' | 'sprint-qualifying',
  options: SessionOptions,
): StageRun {
  const race = buildRaceInput(world, pack, open.round, open.seed, controlOf(options));
  const result = runQualifying({
    race,
    session: stage,
    setupLossS: Object.fromEntries(race.entries.map((e) => [e.driverId, e.setupLossS])),
    sets: open.sets,
    commands: options.qualifyingCommands,
  });
  const spent = { ...open, sets: result.setsLeft };
  const progress: WeekendProgress =
    stage === 'qualifying' ? { ...spent, grid: result.order } : { ...spent, sprintGrid: result.order };
  return { world, progress, session: result.session, detail: { kind: 'qualifying', qualifying: result } };
}

/** The race, or the sprint: the existing race simulation, started from the grid that was earned. */
function raceStage(
  world: World,
  pack: Pack,
  open: WeekendProgress,
  stage: 'race' | 'sprint',
  options: SessionOptions,
): StageRun {
  const input = raceInput(world, pack, open, stage, options);
  const result = simulateRace(input);
  return {
    world,
    // A sprint gives Sunday back what it did not use; the race itself gives back to nobody.
    progress: { ...open, sets: { ...open.sets, ...result.tyreSets } },
    session: { session: stage, classification: result.classification.map(toEntry) },
    detail: { kind: 'race', input, result },
  };
}

/** A sprint runs on its own seed and its own grid, so it is a different race, not a shorter one. */
function raceInput(
  world: World,
  pack: Pack,
  open: WeekendProgress,
  stage: 'race' | 'sprint',
  options: SessionOptions,
): RaceInput {
  const grid = (stage === 'sprint' ? open.sprintGrid : open.grid) ?? undefined;
  const seed = stage === 'sprint' ? `${open.seed}-sprint` : open.seed;
  return buildRaceInput(world, pack, open.round, seed, {
    ...controlOf(options),
    grid,
    format: stage === 'sprint' ? 'sprint' : 'race',
  });
}

// ── Plumbing ──────────────────────────────────────────────────────────────────────────────────

const controlOf = (options: SessionOptions): RaceControlInput => ({
  control: options.control ?? null,
  commands: options.commands ?? [],
});

function mustBeOpen(world: World): WeekendProgress {
  if (!world.weekend) throw new Error('No weekend is open');
  return world.weekend;
}

function roundOf(world: World, round: number): RaceWeekend {
  const weekend = world.season.calendar.find((r) => r.round === round);
  if (!weekend) throw new RangeError(`No round ${round} in the ${world.season.year} calendar`);
  return weekend;
}

/** The session after this one in the format, or 'done' when the race has been run. */
function nextStage(world: World, round: number, stage: SessionKind): SessionKind | 'done' {
  const order = WEEKEND_SESSIONS[roundOf(world, round).format];
  return order[order.indexOf(stage) + 1] ?? 'done';
}

/**
 * A session goes into its round on the calendar as soon as it is run — the round stays `upcoming`
 * until the weekend closes, but the points are already in the tables (docs/systems/season.md).
 */
function fileSession(world: World, round: number, session: SessionResult): World {
  const calendar = world.season.calendar.map((r) =>
    r.round === round
      ? { ...r, sessions: [...r.sessions.filter((s) => s.session !== session.session), session] }
      : r,
  );
  const season = { ...world.season, calendar };
  return { ...world, season: { ...season, standings: standings(season) } };
}

/** A race classification as the season records it: places, laps, points, nothing about the race. */
function toEntry(car: RaceResult['classification'][number]): SessionResult['classification'][number] {
  return {
    driverId: car.driverId,
    teamId: car.teamId,
    position: car.position,
    laps: car.laps,
    bestLapS: car.bestLapS,
    status: car.status === 'finished' ? 'finished' : 'dnf',
    points: car.points,
  };
}

/** What a weekend's practice leaves behind: the sessions, and what every team knows after them. */
export type PracticeWeekend = {
  world: World;
  sessions: PracticeResult[];
  knowledge: World['knowledge'];
};

/**
 * A weekend's practice on its own, without the calendar around it: the batch runner and the tests
 * use it to run a normal Friday and Saturday morning and stop there.
 */
export function runPracticeSessions(
  world: World,
  pack: Pack,
  round: number,
  seed: string = world.seed,
  plans: Partial<Record<SessionKind, PracticePlan>> = {},
): PracticeWeekend {
  let open = withPlans(openWeekend(world, pack, round, seed), plans);
  const sessions: PracticeResult[] = [];
  while (open.weekend!.stage !== 'done' && isPractice(open.weekend!.stage)) {
    const outcome = runSession(open, pack);
    if (outcome.detail.kind === 'practice') sessions.push(outcome.detail.practice);
    open = outcome.world;
  }
  return { world: open, sessions, knowledge: open.knowledge };
}

/**
 * A race weekend up to the lights: practice is run, every team learns what it learns and dials its
 * car in, qualifying sets the grid, and the race input is built so each strategist plans on what
 * its own team now believes and starts where it qualified. The race itself is left to the caller.
 */
export function weekendRaceInput(
  world: World,
  pack: Pack,
  round: number,
  seed: string = world.seed,
  options: WeekendOptions = {},
): {
  input: RaceInput;
  practice: PracticeWeekend;
  qualifying: QualifyingResult;
  /** A sprint weekend's Saturday: its own qualifying, its own short race (plan 5.3). */
  sprint: { qualifying: QualifyingResult; input: RaceInput; result: RaceResult } | null;
  world: World;
} {
  const { plans = {}, ...control } = options;
  let open = withPlans(openWeekend(world, pack, round, seed), plans);
  const sessions: PracticeResult[] = [];
  let qualifying: QualifyingResult | null = null;
  let sprintQualifying: QualifyingResult | null = null;
  let sprint: { qualifying: QualifyingResult; input: RaceInput; result: RaceResult } | null = null;

  while (open.weekend!.stage !== 'race') {
    const outcome = runSession(open, pack, control);
    const detail = outcome.detail;
    if (detail.kind === 'practice') sessions.push(detail.practice);
    else if (detail.kind === 'qualifying') {
      if (outcome.stage === 'qualifying') qualifying = detail.qualifying;
      else sprintQualifying = detail.qualifying;
    } else sprint = { qualifying: sprintQualifying!, input: detail.input, result: detail.result };
    open = outcome.world;
  }
  return {
    input: sessionRaceInput(open, pack, control),
    practice: { world: open, sessions, knowledge: open.knowledge },
    qualifying: qualifying!,
    sprint,
    world: open,
  };
}

/** Puts the programmes a caller brought into the open weekend, session by session. */
function withPlans(world: World, plans: Partial<Record<SessionKind, PracticePlan>>): World {
  let open = world;
  for (const [session, plan] of Object.entries(plans))
    if (plan) open = planPractice(open, session as SessionKind, plan);
  return open;
}
