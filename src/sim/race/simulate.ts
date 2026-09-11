/**
 * simulateRace(input) → result (plan 5.4, docs/systems/race.md): a pure function — the same input
 * gives a byte-identical result.
 *
 * The race runs sector by sector as a discrete-event simulation: cars are processed in the order
 * they enter their next sector. The car physically ahead at a sector boundary is the one that
 * crossed it last, so traffic, dirty air, DRS and overtaking are resolved against it. Positions and
 * gaps are derived after the race from final line-crossing times, so a late adjustment (a defender
 * losing time to a pass) can never leave the lap chart inconsistent.
 */
import { balance } from '@/data/balance';
import type { Compound } from '@/data/schema/race-balance';
import type { Decision } from '../decide/decide';
import { type Rng, streams } from '../rng/rng';
import {
  backgroundIncidentChancePerLap,
  failureChancePerLap,
  type IncidentKind,
  mistakeChancePerLap,
  mistakeOutcome,
  pitLaneFactor,
  punctureChancePerLap,
  raceControlResponse,
  stationaryTimeS,
} from './incidents';
import {
  carPaceFraction,
  driverPaceFraction,
  fatigueSeconds,
  fatiguePerLap,
  fuelPerLap,
  lapNoiseSd,
  massSeconds,
} from './pace';
import { finishForecast, type ForecastCar, pitWindow } from './forecast';
import { obeyChance } from './orders';
import {
  aggressionEffects,
  aggressionFromRisk,
  decideRadio,
  ersEffects,
  NEUTRAL_RADIO,
  paceEffects,
  type RadioGoal,
} from './radio';
import {
  decidePitCall,
  decideRaceStrategy,
  type PitCallOption,
  type PitCallTrigger,
  type PlanOption,
  pitCallOptions,
  plannedPitLossS,
  planOptions,
  replan,
  type StintModel,
} from './strategy';
import { prepareTrack, type TrackModel } from './track';
import { dirtyAirLossS, drsGainS, hasDrsZone, overtakeProbability, slipstreamGainS } from './traffic';
import { bestCompoundFor, COMPARISON_WEAR, isDry, tyreLossS, warmupLossS, wearPerLap } from './tyres';
import type {
  ClassifiedCar,
  ConditionsRecord,
  LapRecord,
  PitAnswer,
  PitWall,
  PlanRevision,
  RaceCommand,
  RaceControl,
  RaceEntry,
  RaceEvent,
  RaceEventKind,
  RaceInput,
  RaceResult,
  ScheduledStint,
  RadioSettings,
  Stint,
  StrategyGoal,
  StrategyPlan,
  TeamOrder,
  TrackStatus,
} from './types';
import {
  advanceSurface,
  greenTrackFraction,
  initialSurface,
  powerLossFraction,
  sampleAt,
  type SurfaceState,
  wetSlowdownFraction,
  windSeconds,
} from './weather';

type CarState = {
  entry: RaceEntry;
  status: 'running' | 'finished' | 'retired';
  retireReason: string | null;
  retireTime: number;
  nextTime: number;
  version: number;
  lapsDone: number;
  segment: number;
  compound: Compound;
  wear: number;
  tyreAge: number;
  freshSet: boolean;
  compoundsUsed: Compound[];
  stops: number;
  fuelKg: number;
  battery: number;
  fatigue: number;
  /** Own pace in each sector as last driven (dirty air in, DRS and queueing out): for lap-level advantage. */
  recentPaceS: (number | null)[];
  damageS: number;
  partialFailureS: number;
  /** Remaining stints, the current one first; `stintLaps` counts laps done on the current one. */
  plan: Stint[];
  stintLaps: number;
  pitRequest: { compound: Compound; plan: Stint[] } | null;
  planHistory: PlanRevision[];
  reviewedWetness: number;
  reviewedNeutralisation: number;
  /** The damage the strategist last decided on: the same damage is not re-decided every lap. */
  reviewedDamageS: number;
  /** Seconds the stewards have added for causing a collision (plan 5.3). */
  penaltyS: number;
  /** Radio: what the car runs now, and what the player has taken over from a delegated engineer. */
  radio: RadioSettings;
  radioOverride: Partial<RadioSettings>;
  /** Whether the driver follows the team's current order; null when no order concerns them. */
  obeys: boolean | null;
  /** Per lap: segment times, line time, and what the lap looked like. */
  segments: number[][];
  lineTimes: number[];
  lapInfo: {
    compound: Compound;
    tyreAge: number;
    tyreWear: number;
    battery: number;
    pitted: boolean;
    pitLaneS: number;
    status: TrackStatus;
    fuelKg: number;
    clean: boolean;
    incident: boolean;
  }[];
  cleanThisLap: boolean;
  incidentThisLap: boolean;
  carFraction: number;
  fuelPerLapKg: number;
  pace: Rng;
  tyreRng: Rng;
  reliabilityRng: Rng;
};

/** A car passing a sector boundary. `off` = in the pit lane or spun off: it holds nobody up. */
type Crossing = {
  car: CarState;
  time: number;
  lap: number;
  segment: number;
  segmentS: number;
  /**
   * The car's own pace over the segment: its dirty air included, DRS and queueing behind others
   * not. An attacker is faster than the car it follows, not than the train that car is stuck in.
   */
  paceS: number;
  off: boolean;
};

/** Minimal binary heap of pending car segments, keyed by entry time (ties by grid index). */
class SegmentQueue {
  private items: { time: number; order: number; car: CarState; version: number }[] = [];
  push(time: number, order: number, car: CarState) {
    this.items.push({ time, order, car, version: car.version });
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      [this.items[i], this.items[parent]] = [this.items[parent]!, this.items[i]!];
      i = parent;
    }
  }
  pop() {
    const top = this.items[0];
    const last = this.items.pop();
    if (top && last && this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.less(l, m)) m = l;
        if (r < this.items.length && this.less(r, m)) m = r;
        if (m === i) break;
        [this.items[i], this.items[m]] = [this.items[m]!, this.items[i]!];
        i = m;
      }
    }
    return top;
  }
  private less(a: number, b: number) {
    const x = this.items[a]!;
    const y = this.items[b]!;
    return x.time < y.time || (x.time === y.time && x.order < y.order);
  }
}

/**
 * A team's pre-race plan options and its strategist's pick, exactly as the race will make it (same
 * model, same stream) — for the pre-race screen, where the player may choose a different one.
 */
export function raceStrategy(
  input: RaceInput,
  teamId: string,
): { options: PlanOption[]; decision: Decision<PlanOption> } {
  const track = input.track;
  const cars = input.entries.filter((e) => e.teamId === teamId);
  const lead = cars[0];
  if (!lead) throw new RangeError(`No team "${teamId}" in this race`);
  const start = sampleAt(input.weather, 0);
  const surface = initialSurface(input.weather);
  const stintModel: StintModel = {
    track,
    twoCompoundRule: input.format !== 'sprint',
    tyreDegFactor: lead.beliefs.tyreDegradation,
    carTyreManagement: lead.car.tyreManagement,
    driverTyreManagement: cars.reduce((sum, c) => sum + c.driver.tyreManagement, 0) / cars.length,
    trackTempC: start.trackTempC,
    wetness: Math.max(...surface.wetness),
    averageFuelKg: (fuelPerLap(track, lead.car.fuelEfficiency) * track.laps) / 2,
  };
  const options = planOptions(track.laps, stintModel);
  const control = input.control;
  const intent =
    control && control.teamId === teamId && control.strategy.mode === 'directed'
      ? { goal: control.strategy.goal, risk: control.strategy.risk, issuedBy: 'player' as const }
      : { goal: 'fastest' as StrategyGoal, risk: lead.riskAppetite, issuedBy: 'team-character' as const };
  const decision = decideRaceStrategy(
    options,
    lead.strategist,
    intent,
    streams(input.seed)(`race:${input.season}:r${input.round}:decisions:${teamId}:plan`),
  );
  return { options, decision };
}

export function simulateRace(input: RaceInput): RaceResult {
  const b = balance.race;
  const model: TrackModel = prepareTrack(input.track, input.geometry);
  /** How many segments this track's lap is cut into, and the last one — the one that ends on the line. */
  const SEGMENTS = model.segments.length;
  const LAST = SEGMENTS - 1;
  const track = input.track;
  const totalLaps = input.distanceLaps;
  const base = track.baseLapTime;
  const rng = streams(input.seed);
  const stream = (name: string) => rng(`race:${input.season}:r${input.round}:${name}`);
  const traffic = stream('traffic');
  const control = stream('race-control');
  const startRng = stream('start');
  const events: RaceEvent[] = [];
  const emit = (
    timeS: number,
    lap: number,
    segment: number | null,
    kind: RaceEventKind,
    driverId: string | null = null,
    otherId: string | null = null,
    detail: Record<string, string | number> = {},
  ) => events.push({ timeS: round3(timeS), lap, segment, kind, driverId, otherId, detail });

  const entriesById = new Map(input.entries.map((e) => [e.driverId, e]));
  // The player's team and how it is run — changed by 'control' commands during the race.
  const ctl: RaceControl | null = input.control
    ? { ...input.control, strategy: { ...input.control.strategy }, radio: { ...input.control.radio } }
    : null;
  const isPlayerTeam = (teamId: string) => ctl !== null && teamId === ctl.teamId;
  /** Whose instruction a team's strategist follows: the player's when directed, the team character's otherwise. */
  const strategyIntent = (entry: RaceEntry) =>
    isPlayerTeam(entry.teamId) && ctl!.strategy.mode === 'directed'
      ? { goal: ctl!.strategy.goal, risk: ctl!.strategy.risk, issuedBy: 'player' as const }
      : { goal: 'fastest' as StrategyGoal, risk: entry.riskAppetite, issuedBy: 'team-character' as const };
  const gridOrder = input.grid.filter((id) => entriesById.has(id));
  let surface: SurfaceState = initialSurface(input.weather);

  /** How hard a car races: the player's instruction or radio call for the player's team, the team character otherwise. */
  const aggressionFor = (entry: RaceEntry) =>
    isPlayerTeam(entry.teamId) && ctl!.radio.mode !== 'delegated'
      ? ctl!.radio.aggression
      : aggressionFromRisk(entry.riskAppetite);

  // ── Pre-race: each team's strategist picks a plan through decide() ─────────────────────────
  const plans = new Map<string, StrategyPlan>();
  /** Stops in each team's best plan for this race: what its strategist expects of a typical rival. */
  const expectedStops = new Map<string, number>();
  const teams = [...new Set(input.entries.map((e) => e.teamId))];
  for (const teamId of teams) {
    const cars = input.entries.filter((e) => e.teamId === teamId);
    const { options, decision } = raceStrategy(input, teamId);
    expectedStops.set(teamId, options.reduce((best, o) => (o.timeS < best.timeS ? o : best)).stops);
    // In manual strategy the player's own plans run; the strategist still decided, for the record.
    for (const car of cars) {
      const own =
        isPlayerTeam(teamId) && ctl!.strategy.mode === 'manual' ? ctl!.plans[car.driverId] : undefined;
      plans.set(car.driverId, own ?? decision.choice.plan);
    }
  }

  // ── Grid and launch ──────────────────────────────────────────────────────────────────────
  // The launch decides the order into the first corner: the grid slot, the driver's starts and the
  // luck of the day, now and then a car bogging down. A car that gets away better than the one in
  // front is ahead of it from there on — no overtaking move needed, it happened off the line.
  const s = b.start;
  const launches = new Map(
    gridOrder.map((id, gridIndex) => {
      const skill = -s.skillSPerPoint * (entriesById.get(id)!.driver.starts - s.skillRef);
      const spread = startRng.normal(0, s.spreadSd);
      const bogged = startRng.chance(s.badLaunchChance);
      const lossS = bogged ? s.badLaunchLossS * (0.5 + startRng.next()) : 0;
      // Even slots stand on the dirty side, off the racing line: less grip when the lights go out.
      const dirtySide = gridIndex % 2 === 1 ? s.dirtySideS : 0;
      return [
        id,
        { timeS: Math.max(0, gridIndex * s.gridSlotS + dirtySide + skill + spread + lossS), bogged },
      ] as const;
    }),
  );
  const cars: CarState[] = gridOrder.map((id) => {
    const entry = entriesById.get(id)!;
    const plan = plans.get(id)!;
    const perLap = fuelPerLap(track, entry.car.fuelEfficiency);
    return {
      entry,
      status: 'running',
      retireReason: null,
      retireTime: 0,
      nextTime: launches.get(id)!.timeS,
      version: 0,
      lapsDone: 0,
      segment: 0,
      compound: plan.stints[0]!.compound,
      wear: 0,
      tyreAge: 0,
      freshSet: true,
      compoundsUsed: [plan.stints[0]!.compound],
      stops: 0,
      // Fuelled on what the team believes it burns here, plus a margin for how unsure it is: a team
      // that never calibrated its fuel carries the doubt as weight, and a team that got it wrong
      // anyway lifts and coasts to the flag (plan 5.3, docs/systems/weekend.md).
      fuelKg:
        entry.beliefs.fuelPerLapKg * totalLaps +
        b.fuel.marginKg +
        b.fuel.safetyZ * entry.beliefs.fuelSdKg * totalLaps,
      battery: 1,
      fatigue: entry.driver.fatigue,
      recentPaceS: model.segments.map(() => null),
      damageS: 0,
      partialFailureS: 0,
      plan: plan.stints.map((st) => ({ ...st })),
      stintLaps: 0,
      pitRequest: null,
      planHistory: [{ timeS: 0, stints: schedule(plan.stints, 1) }],
      reviewedWetness: Math.max(...surface.wetness),
      reviewedNeutralisation: 0,
      reviewedDamageS: 0,
      penaltyS: 0,
      radio: { ...NEUTRAL_RADIO, aggression: aggressionFor(entry) },
      radioOverride: {},
      obeys: null,
      segments: [],
      // The race clock starts at the signal for everyone: lap 1 includes the run from the grid slot.
      lineTimes: [0],
      lapInfo: [],
      cleanThisLap: true,
      incidentThisLap: false,
      carFraction: carPaceFraction(entry.car, track),
      fuelPerLapKg: perLap,
      pace: stream(`pace:${id}`),
      tyreRng: stream(`tyres:${id}`),
      reliabilityRng: stream(`reliability:${id}`),
    };
  });
  const orderOf = new Map(cars.map((c, i) => [c, i]));
  const radioRngs = new Map(teams.map((t) => [t, stream(`decisions:${t}:radio`)]));
  const orderRngs = new Map(cars.map((c) => [c.entry.driverId, stream(`radio:${c.entry.driverId}`)]));
  const teamOrders = new Map<string, TeamOrder>();
  const commands: readonly RaceCommand[] = input.commands;
  const appliedCommands = new Set<number>();
  const pitWall: PitWall | null = ctl
    ? {
        teamId: ctl.teamId,
        forecasts: Object.fromEntries(
          cars.filter((c) => isPlayerTeam(c.entry.teamId)).map((c) => [c.entry.driverId, []]),
        ),
        decisions: [],
        radio: Object.fromEntries(
          cars
            .filter((c) => isPlayerTeam(c.entry.teamId))
            .map((c) => [c.entry.driverId, [{ timeS: 0, settings: { ...c.radio } }]]),
        ),
      }
    : null;
  const pitRngs = new Map(teams.map((t) => [t, stream(`pit:${t}`)]));
  const stewardsRng = stream('stewards');
  const callRngs = new Map(teams.map((t) => [t, stream(`decisions:${t}:calls`)]));

  const queue = new SegmentQueue();
  for (const car of cars) queue.push(car.nextTime, orderOf.get(car)!, car);
  // The grid itself: at the start, the car ahead of each car is the one on the slot in front.
  const crossings: Crossing[][] = [
    cars.map((car) => ({
      car,
      time: car.nextTime,
      lap: 0,
      segment: LAST,
      segmentS: 0,
      paceS: 0,
      off: false,
    })),
    ...Array.from({ length: LAST }, (): Crossing[] => []),
  ];
  emit(0, 1, 0, 'start', null, null, { cars: cars.length });
  // Places won and lost off the line: each gain reported, and each car that bogged down.
  const launchOrder = [...cars].sort((a, c) => a.nextTime - c.nextTime || orderOf.get(a)! - orderOf.get(c)!);
  launchOrder.forEach((car, i) => {
    const places = orderOf.get(car)! - i;
    const { bogged } = launches.get(car.entry.driverId)!;
    if (places > 0 || bogged) {
      emit(car.nextTime, 1, 0, 'launch', car.entry.driverId, null, {
        places,
        grid: orderOf.get(car)! + 1,
        bad: bogged ? 1 : 0,
      });
    }
  });

  // ── Race control state ───────────────────────────────────────────────────────────────────
  // Changed inside closures (deploy), so it must not narrow to its initial value.
  let status = 'green' as TrackStatus;
  let neutralisedUntilLap = 0;
  let neutralisation = 0;
  // Race control decides as events are processed, but a car only learns of a flag from the moment it
  // is shown: cars are processed by sector entry time, and one entering before the flag must not
  // see it. Changes are kept by time; `neutralisation` numbers each period for strategy reviews.
  const flagChanges: { time: number; status: TrackStatus; neutralisation: number }[] = [
    { time: 0, status: 'green', neutralisation: 0 },
  ];
  const setFlag = (time: number, next: TrackStatus) => {
    status = next;
    let i = flagChanges.length;
    while (i > 0 && flagChanges[i - 1]!.time > time) i--;
    flagChanges.splice(i, 0, { time, status: next, neutralisation });
  };
  const flagAt = (time: number) => {
    let i = flagChanges.length - 1;
    while (i > 0 && flagChanges[i]!.time > time) i--;
    return flagChanges[i]!;
  };
  /** The next change of flag strictly after `time`, for a car that is mid-sector when it is shown. */
  const nextFlagAfter = (time: number) => flagChanges.find((f) => f.time > time);
  let drsFromLap = b.drs.enabledFromLap;
  let leaderLaps = 0;
  let flagTime: number | null = null;
  let carLapsSinceSurface = 0;
  const conditions: ConditionsRecord[] = [];
  /** The lap each attacker → defender duel last made the feed. */
  const lastDefenceReport = new Map<string, number>();
  const rainingAt = (timeS: number) => sampleAt(input.weather, timeS).rain.some((r) => r > 0);
  let wasRaining = rainingAt(0);

  /**
   * Race control sees the incident, decides and shows the flag — never in the same instant (ADR 005,
   * п. 15). Until then the field races on towards it, as it does in life.
   */
  const deploy = (response: 'sc' | 'vsc' | null, timeS: number, lap: number, cause: string) => {
    if (!response) return;
    if (status === 'sc' || (status === 'vsc' && response === 'vsc')) return;
    const rc = b.raceControl;
    const [lo, hi] = response === 'sc' ? rc.safetyCarLaps : rc.virtualSafetyCarLaps;
    const shownAt = timeS + control.range(rc.reactionS[0], rc.reactionS[1]);
    neutralisation++;
    setFlag(shownAt, response);
    neutraliseInFlight(shownAt, response);
    neutralisedUntilLap = leaderLaps + control.int(lo, hi) + 1;
    emit(shownAt, lap, null, response === 'sc' ? 'safety-car' : 'vsc', null, null, { cause });
  };

  /**
   * A flag shown at a moment, not at a sector boundary: cars already on their way through a sector
   * lose the rest of it to the neutralisation too. Sectors are computed whole at their entry, so a
   * car that entered before the flag has its crossing pushed back here instead (ADR 005, п. 16).
   */
  function neutraliseInFlight(shownAt: number, response: 'sc' | 'vsc') {
    const factor =
      response === 'sc' ? b.raceControl.safetyCarLapFactor : b.raceControl.virtualSafetyCarLapFactor;
    for (const car of cars) {
      if (car.status !== 'running' || car.nextTime <= shownAt) continue;
      const crossing = crossings[car.segment]!.find((c) => c.car === car && c.time === car.nextTime);
      if (!crossing || crossing.time - crossing.segmentS > shownAt) continue;
      delay(crossing, (crossing.time - shownAt) * (factor - 1));
    }
  }

  const incident = (kind: IncidentKind, timeS: number, lap: number, cause: string) =>
    deploy(raceControlResponse(kind, track.profile.safetyCarProbability, control), timeS, lap, cause);

  const retire = (car: CarState, timeS: number, lap: number, reason: string, kind: IncidentKind) => {
    car.status = 'retired';
    car.retireReason = reason;
    car.retireTime = timeS;
    car.version++;
    emit(timeS, lap, car.segment, 'retirement', car.entry.driverId, null, { reason });
    incident(kind, timeS, lap, reason);
  };

  /** Contact damage: most often a front wing, sometimes a puncture, now and then the end. */
  const contactDamage = (car: CarState, timeS: number, lap: number) => {
    const d = b.damage;
    car.incidentThisLap = true;
    const roll = traffic.next();
    if (roll < d.retireShare) {
      retire(car, timeS, lap, 'collision', 'crash');
      return 0;
    }
    if (roll < d.retireShare + d.punctureShare) {
      requestPit(car, 'puncture', timeS, lap);
      return balance.tyres.puncture.lossS;
    }
    car.damageS = Math.max(car.damageS, d.contactLossS);
    incident('debris', timeS, lap, 'debris');
    return 0;
  };

  const stintModelFor = (car: CarState, timeS: number): StintModel => {
    const sample = sampleAt(input.weather, timeS);
    return {
      track,
      twoCompoundRule: input.format !== 'sprint',
      tyreDegFactor: car.entry.beliefs.tyreDegradation,
      carTyreManagement: car.entry.car.tyreManagement,
      driverTyreManagement: car.entry.driver.tyreManagement,
      trackTempC: sample.trackTempC,
      wetness: (surface.wetness[0] + surface.wetness[1] + surface.wetness[2]) / 3,
      averageFuelKg: car.fuelKg / 2,
    };
  };

  const optionsFor = (car: CarState, trigger: PitCallTrigger, timeS: number, lap: number) =>
    pitCallOptions({
      trigger,
      remainingLaps: Math.max(0, totalLaps - lap),
      current: { compound: car.compound, wear: car.wear },
      compoundsUsed: car.compoundsUsed,
      status: flagAt(timeS).status,
      model: stintModelFor(car, timeS),
      damageS: car.damageS,
    });

  /** The player's answer to the decision taken at `timeS` for a driver, if there is one. */
  const answerFor = (driverId: string, timeS: number): PitAnswer | undefined =>
    commands.find(
      (c): c is Extract<RaceCommand, { kind: 'call' }> =>
        c.kind === 'call' && c.driverId === driverId && Math.abs(c.timeS - round3(timeS)) < 1e-3,
    )?.answer;

  const matches = (o: PitCallOption, a: PitAnswer) =>
    o.call === a.call && (a.call === 'stay' || o.compound === a.compound);

  /**
   * The strategist's pit call through decide(); a puncture forces a stop, only the tyre is chosen.
   * The strategist always decides — for the record, and so the stream never depends on the player.
   * For the player's team the answer, or in manual mode the lack of one, can replace the choice.
   */
  function requestPit(car: CarState, trigger: PitCallTrigger, timeS: number, lap: number) {
    const remaining = totalLaps - lap;
    if (remaining <= 0 && trigger !== 'puncture') return;
    const options = optionsFor(car, trigger, timeS, lap);
    const decision = decidePitCall(
      options,
      car.entry.strategist,
      strategyIntent(car.entry),
      callRngs.get(car.entry.teamId)!,
    );
    const recommended = options.indexOf(decision.choice);
    let applied = recommended;
    if (isPlayerTeam(car.entry.teamId)) {
      const answer = answerFor(car.entry.driverId, timeS);
      const answered = answer ? options.findIndex((o) => matches(o, answer)) : -1;
      const stay = options.findIndex((o) => o.call === 'stay');
      let by: 'strategist' | 'player' | 'unanswered' = 'strategist';
      if (answered >= 0) [applied, by] = [answered, 'player'];
      else if (ctl!.strategy.mode === 'manual') {
        // Nobody has decided yet: stay out (a puncture boxes on the strategist's tyre) until told.
        by = 'unanswered';
        if (stay >= 0) applied = stay;
      }
      pitWall!.decisions.push({
        timeS: round3(timeS),
        lap,
        driverId: car.entry.driverId,
        trigger,
        options: options.map((o) => ({
          answer: o.call === 'stay' ? { call: 'stay' } : { call: 'pit', compound: o.compound },
          expectedS: round3(o.timeS),
        })),
        recommended,
        applied,
        by,
      });
    }
    const choice = options[applied]!;
    emit(timeS, lap, car.segment, 'strategy-call', car.entry.driverId, null, {
      trigger,
      call: choice.call,
      compound: choice.compound,
    });
    if (choice.call === 'pit') car.pitRequest = { compound: choice.compound, plan: choice.stints };
    else if (choice.stints.length > 0) {
      car.plan = choice.stints.map((st, i) =>
        i === 0 ? { ...st, laps: st.laps + car.stintLaps } : { ...st },
      );
      car.planHistory.push({ timeS: round3(timeS), stints: schedule(car.plan, lap - car.stintLaps) });
    }
  }

  /** "Box this lap" from the player: the strategist fills in the rest of the race on that tyre. */
  function playerPit(car: CarState, compound: Compound, timeS: number, lap: number) {
    if (totalLaps - lap <= 0) return;
    const option = optionsFor(car, 'damage', timeS, lap).find(
      (o) => o.call === 'pit' && o.compound === compound,
    );
    if (!option) return;
    car.pitRequest = { compound, plan: option.stints };
    emit(timeS, lap, car.segment, 'strategy-call', car.entry.driverId, null, {
      trigger: 'player',
      call: 'pit',
      compound,
    });
  }

  /** A new plan for the rest of the race from the player: this many more stops, from the tyres on the car. */
  function playerPlan(car: CarState, stops: number, timeS: number, lap: number) {
    const stints = replan(
      {
        remainingLaps: totalLaps - lap + 1,
        current: { compound: car.compound, wear: car.wear },
        compoundsUsed: car.compoundsUsed,
        model: stintModelFor(car, timeS),
      },
      stops,
    );
    if (!stints || stints.length === 0) return;
    car.pitRequest = null;
    car.plan = stints.map((st, i) => (i === 0 ? { ...st, laps: st.laps + car.stintLaps } : { ...st }));
    car.planHistory.push({ timeS: round3(timeS), stints: schedule(car.plan, lap - car.stintLaps) });
    emit(timeS, lap, car.segment, 'strategy-call', car.entry.driverId, null, {
      trigger: 'player',
      call: 'plan',
      stops: stints.length - 1,
    });
  }

  /** Radio history for the pit wall; the feed hears the player's calls and changes of pace or aggression. */
  function recordRadio(
    car: CarState,
    timeS: number,
    lap: number,
    by: 'player' | 'engineer' | 'fuel',
    before: RadioSettings,
  ) {
    pitWall?.radio[car.entry.driverId]?.push({ timeS: round3(timeS), settings: { ...car.radio } });
    if (by === 'player' || car.radio.pace !== before.pace || car.radio.aggression !== before.aggression) {
      emit(timeS, lap, car.segment, 'radio', car.entry.driverId, null, { ...car.radio, by });
    }
  }

  /** How far round the race a car is, for team orders: laps and sectors done, earlier entry first. */
  const progressOf = (c: CarState) => c.lapsDone * SEGMENTS + c.segment - c.nextTime * 1e-6;

  /** A team order: who it asks to give way or stay put, and whether they will. */
  function applyTeamOrder(teamId: string, order: TeamOrder, timeS: number, lap: number) {
    teamOrders.set(teamId, order);
    const mates = cars.filter((c) => c.entry.teamId === teamId && c.status === 'running');
    for (const m of mates) m.obeys = null;
    emit(timeS, lap, null, 'team-order', mates[0]?.entry.driverId ?? null, mates[1]?.entry.driverId ?? null, {
      order,
    });
    if (order === 'free' || mates.length < 2) return;
    const [front, back] = [...mates].sort((a, c) => progressOf(c) - progressOf(a)) as [CarState, CarState];
    // A swap asks the car ahead to give way; holding asks the car behind to stay behind.
    const [asked, other] = order === 'swap' ? [front, back] : [back, front];
    const pace = (c: CarState) => c.recentPaceS.reduce<number>((sum, x) => sum + (x ?? 0), 0);
    const position =
      1 + cars.filter((c) => c.status === 'running' && progressOf(c) > progressOf(asked)).length;
    const d = asked.entry.driver;
    const obeys =
      orderRngs.get(asked.entry.driverId)!.next() <
      obeyChance(
        { loyalty: d.loyalty, ego: d.ego, morale: d.morale },
        {
          faster: pace(asked) < pace(other),
          pointsAtStake:
            order === 'swap' &&
            position <=
              (input.format === 'sprint' ? input.regulation.points.sprint : input.regulation.points.race)
                .length,
        },
      );
    asked.obeys = obeys;
    other.obeys = true;
    if (!obeys)
      emit(timeS, lap, null, 'order-refused', asked.entry.driverId, other.entry.driverId, { order });
  }

  /** Commands that are due for this car (or for everyone) when it enters a sector at `t`. */
  function applyCommands(car: CarState, t: number, lap: number) {
    commands.forEach((c, i) => {
      if (appliedCommands.has(i) || c.timeS > t || c.kind === 'call') return;
      if (c.kind === 'team-order') {
        appliedCommands.add(i);
        if (isPlayerTeam(c.teamId)) applyTeamOrder(c.teamId, c.order, t, lap);
        return;
      }
      if (c.kind === 'control') {
        appliedCommands.add(i);
        if (!ctl) return;
        if (c.strategy) ctl.strategy = { ...c.strategy };
        if (c.radio) {
          ctl.radio = { ...c.radio };
          for (const p of cars) {
            if (!isPlayerTeam(p.entry.teamId)) continue;
            p.radioOverride = {};
            p.radio = { ...p.radio, aggression: aggressionFor(p.entry) };
          }
        }
        return;
      }
      if (c.driverId !== car.entry.driverId || !isPlayerTeam(car.entry.teamId)) return;
      appliedCommands.add(i);
      if (c.kind === 'radio') {
        const before = car.radio;
        car.radio = { ...car.radio, ...c.radio };
        if (ctl!.radio.mode !== 'manual') Object.assign(car.radioOverride, c.radio);
        recordRadio(car, t, lap, 'player', before);
      } else if (c.kind === 'pit') playerPit(car, c.compound, t, lap);
      else playerPlan(car, c.stops, t, lap);
    });
  }

  /**
   * The engineer's radio call at the line, through decide() for every car; in manual radio the
   * player's settings stay. Short of fuel, any car drops to lift-and-coast.
   */
  function updateRadio(car: CarState, timeS: number, lap: number) {
    const lapsLeft = totalLaps - lap;
    if (lapsLeft <= 0) return;
    const player = isPlayerTeam(car.entry.teamId);
    const mode = player ? ctl!.radio.mode : 'delegated';
    const ahead = aheadAt(crossings[0]!, car, timeS);
    const previous = car.lineTimes[lap - 1] ?? 0;
    const behind = crossings[0]!
      .filter((c) => c.car !== car && c.lap === lap - 1 && !c.off && c.time > previous)
      .reduce<number>((min, c) => Math.min(min, c.time - previous), Infinity);
    const goal: RadioGoal = player && mode === 'directed' ? ctl!.radio.saving : 'none';
    const decision = decideRadio(
      {
        stintLapsLeft: car.plan.length > 1 ? Math.max(1, car.plan[0]!.laps - car.stintLaps) : lapsLeft,
        compound: car.compound,
        wear: car.wear,
        model: stintModelFor(car, timeS),
        gapAheadS: ahead && ahead.lap === lap ? timeS - ahead.time : Infinity,
        gapBehindS: behind,
        battery: car.battery,
        aggression: aggressionFor(car.entry),
        neutralised: flagAt(timeS).status !== 'green',
      },
      car.entry.raceEngineer,
      {
        goal,
        risk: car.entry.riskAppetite,
        issuedBy: player && mode === 'directed' ? 'player' : 'team-character',
      },
      radioRngs.get(car.entry.teamId)!,
    );
    const next: RadioSettings =
      mode === 'manual' ? { ...car.radio } : { ...decision.choice, ...car.radioOverride };
    if (goal === 'fuel' && !car.radioOverride.pace) next.pace = 'save-fuel';
    const shortS = car.fuelPerLapKg * lapsLeft - car.fuelKg;
    const shortOfFuel = shortS > b.radio.fuelShortfallKg;
    if (shortOfFuel) next.pace = 'save-fuel';
    if (
      next.pace !== car.radio.pace ||
      next.ers !== car.radio.ers ||
      next.aggression !== car.radio.aggression
    ) {
      const before = car.radio;
      car.radio = next;
      if (player) recordRadio(car, timeS, lap, shortOfFuel ? 'fuel' : 'engineer', before);
    }
  }

  /** The strategist's forecast and pit window for one of the player's cars, at its line crossing. */
  function recordForecast(car: CarState, timeS: number, lap: number) {
    if (!pitWall || lap >= totalLaps) return;
    const recentLaps = b.strategy.forecast.recentLaps;
    const view = (c: CarState): ForecastCar => {
      const recent: number[] = [];
      // Only clean green laps say anything about pace: a lap behind the queue is the queue's time.
      for (let l = c.lapsDone; l > 1 && recent.length < recentLaps; l--) {
        if (!c.lapInfo[l - 1]?.pitted && !c.lapInfo[l - 2]?.pitted && c.lapInfo[l - 1]?.status === 'green')
          recent.push(c.lineTimes[l]! - c.lineTimes[l - 1]!);
      }
      return {
        driverId: c.entry.driverId,
        lapsDone: c.lapsDone,
        lineTimeS: c.lineTimes[c.lapsDone] ?? 0,
        recentLapS: recent.length > 0 ? recent.reduce((sum, x) => sum + x, 0) / recent.length : base,
        compound: c.compound,
        tyreAge: c.tyreAge,
        compoundsUsed: c.compoundsUsed,
        stops: c.stops,
      };
    };
    const model = stintModelFor(car, timeS);
    const position = finishForecast(
      { ...view(car), stopsLeft: car.pitRequest ? car.pitRequest.plan.length : car.plan.length - 1 },
      cars.filter((c) => c !== car && c.status === 'running' && c.lapsDone > 0).map(view),
      {
        totalLaps,
        pitLossS: plannedPitLossS(track),
        expectedStops: expectedStops.get(car.entry.teamId)!,
        skill: car.entry.strategist.skill,
        field: cars.length,
        at: input.raceDate,
      },
    );
    const window = car.pitRequest
      ? null
      : pitWindow(car.plan, car.stintLaps, car.wear, lap, totalLaps, model);
    pitWall.forecasts[car.entry.driverId]!.push({ lap, timeS: round3(timeS), position, window });
  }

  // ── The main loop ────────────────────────────────────────────────────────────────────────
  // One car at a time, in the order they enter their next segment. The next car is taken at the top
  // of the iteration, never before the body runs: the body queues the car it just moved, and a car
  // taken out early is a car that can be left in the queue when the last one round finishes.
  for (;;) {
    const popped = queue.pop();
    if (!popped) break;
    const { car, version, time: t } = popped;
    if (car.status !== 'running' || version !== car.version) continue;

    const k = car.segment;
    const lap = car.lapsDone + 1;
    const shape = model.segments[k]!;
    if (carLapsSinceSurface > 0 || t / 60 >= surface.minute + 1) {
      surface = advanceSurface(surface, input.weather, t, carLapsSinceSurface);
      carLapsSinceSurface = 0;
    }
    const sample = sampleAt(input.weather, t);
    const wet = surface.wetness[shape.sector];
    const d = car.entry.driver;
    // The flag this car sees on entering the sector.
    const shown = flagAt(t);
    const flag = shown.status;
    applyCommands(car, t, lap);

    // Strategy triggers are reviewed in the last segment: a stop happens at the end of the lap.
    if (k === LAST && lap < totalLaps && !car.pitRequest && flagTime === null) {
      const avgWet = (surface.wetness[0] + surface.wetness[1] + surface.wetness[2]) / 3;
      const planned = car.plan.length > 1 && car.stintLaps + 1 >= car.plan[0]!.laps;
      if (car.damageS > 0 && car.damageS !== car.reviewedDamageS) {
        car.reviewedDamageS = car.damageS;
        requestPit(car, 'damage', t, lap);
      } else if (flag !== 'green' && car.reviewedNeutralisation !== shown.neutralisation) {
        car.reviewedNeutralisation = shown.neutralisation;
        const stopSoon =
          car.plan.length > 1 && car.plan[0]!.laps - car.stintLaps <= b.strategy.safetyCarWindowLaps;
        const wrongTyres = isDry(car.compound) === avgWet >= b.strategy.dryBelowWetness;
        if (stopSoon || wrongTyres) requestPit(car, 'safety-car', t, lap);
      } else if (Math.abs(avgWet - car.reviewedWetness) >= b.strategy.wetnessReviewStep) {
        car.reviewedWetness = avgWet;
        requestPit(car, 'weather', t, lap);
      } else if (planned) {
        const next = car.plan[1]!;
        car.pitRequest = { compound: next.compound, plan: car.plan.slice(1) };
      }
    }

    // ── Free-air sector time ──
    const weatherFraction =
      powerLossFraction(sample, track.profile.powerSensitivity) + wetSlowdownFraction(wet);
    const lapTime =
      base *
      (1 + car.carFraction) *
      (1 + driverPaceFraction(d, wet)) *
      (1 + weatherFraction) *
      (1 + greenTrackFraction(model, surface.grip));
    const perLapExtras =
      tyreLossS(car.compound, car.wear, sample.trackTempC, wet) +
      massSeconds(car.fuelKg + car.entry.car.weight, base) +
      fatigueSeconds(car.fatigue) +
      car.entry.setupLossS +
      car.damageS +
      car.partialFailureS +
      (car.freshSet ? warmupLossS(car.compound) : 0);
    let segment =
      (lapTime + perLapExtras) * shape.share +
      windSeconds(shape, sample) +
      car.pace.normal(0, lapNoiseSd(d.consistency) * Math.sqrt(shape.share));
    if (lap === 1 && k === 0) segment += s.standingStartLossS;
    // Radio: the pace mode and ERS deployment (an empty battery has nothing to deploy).
    const paceMode = paceEffects(car.radio.pace);
    const ersMode = ersEffects(car.radio.ers === 'attack' && car.battery <= 0 ? 'balanced' : car.radio.ers);
    segment += (paceMode.lapS + ersMode.lapS) * shape.share;

    // ── Things going wrong ──
    // A spun car, or one crawling to the pits on a punctured tyre, is driven around, not overtaken.
    let offLine = false;
    if (flag === 'green') {
      const ideal = bestCompoundFor(wet, sample.trackTempC);
      const gripDeficitS = Math.max(
        0,
        tyreLossS(car.compound, COMPARISON_WEAR, sample.trackTempC, wet) -
          tyreLossS(ideal, COMPARISON_WEAR, sample.trackTempC, wet),
      );
      const mistakeRoll = car.pace.next();
      const outcome = mistakeOutcome(car.pace, track.profile.safetyCarProbability);
      if (
        mistakeRoll <
        mistakeChancePerLap({
          consistency: d.consistency,
          wetness: wet,
          gripDeficitS,
          fatigue: car.fatigue,
        }) *
          paceMode.mistakes *
          shape.share
      ) {
        if (outcome.kind === 'crash') {
          emit(t, lap, k, 'crash', car.entry.driverId);
          retire(car, t, lap, 'crash', 'crash');
          continue;
        }
        segment += outcome.lossS;
        car.incidentThisLap = true;
        if (outcome.kind === 'spin') offLine = true;
        emit(t, lap, k, outcome.kind === 'spin' ? 'spin' : 'mistake', car.entry.driverId, null, {
          lossS: round3(outcome.lossS),
        });
      }
    }
    const failureRoll = car.reliabilityRng.next();
    const partial = car.reliabilityRng.chance(b.reliability.partialShare);
    const component = car.reliabilityRng.chance(b.reliability.powerUnitShare) ? 'power-unit' : 'chassis';
    if (
      car.partialFailureS === 0 &&
      failureRoll < failureChancePerLap(car.entry.car.reliability, totalLaps) * shape.share
    ) {
      if (partial) {
        car.partialFailureS = b.reliability.partialLossS;
        car.incidentThisLap = true;
        emit(t, lap, k, 'failure', car.entry.driverId, null, { component, severity: 'partial' });
      } else {
        emit(t, lap, k, 'failure', car.entry.driverId, null, { component, severity: 'terminal' });
        retire(car, t, lap, `${component} failure`, 'stopped-car');
        continue;
      }
    }
    const punctureRoll = car.tyreRng.next();
    const punctureRetires = car.tyreRng.chance(balance.tyres.puncture.retireShare);
    if (
      punctureRoll <
      punctureChancePerLap(car.wear, balance.tyres.compounds[car.compound].cliffWear) * shape.share
    ) {
      emit(t, lap, k, 'puncture', car.entry.driverId);
      if (punctureRetires) {
        retire(car, t, lap, 'puncture', 'stopped-car');
        continue;
      }
      segment += balance.tyres.puncture.lossS * (1 - shape.share);
      car.incidentThisLap = true;
      offLine = true;
      requestPit(car, 'puncture', t, lap);
    }
    if (lap === 1 && k === 0 && traffic.chance(s.lap1ContactChance)) {
      emit(t, lap, k, 'contact', car.entry.driverId, null, { phase: 'start' });
      const lossS = contactDamage(car, t, lap);
      segment += lossS;
      if (lossS > 0) offLine = true; // a puncture: crawling to the pits
      if (car.status !== 'running') continue;
    }

    // ── Traffic: the car ahead at the sector's entry and exit ──
    const rc = b.raceControl;
    const exit = (k + 1) % SEGMENTS;
    const aheadAtEntry = aheadAt(crossings[k]!, car, t);
    const gapAtEntry = aheadAtEntry ? t - aheadAtEntry.time : Infinity;
    const isLeader = !aheadAtEntry || aheadAtEntry.lap < (k === 0 ? lap - 1 : lap);

    // ── Neutralisation ──
    // A flag thrown while the car is mid-sector neutralises only the rest of it (ADR 005, п. 16):
    // the driver keeps racing up to the moment it is shown, then slows. Without this a car that
    // entered the sector a tenth of a second earlier races all of it and the field tears in two.
    const catchingUp = !isLeader && gapAtEntry > rc.bunchGapS * rc.catchUpBeyondGaps;
    const neutralFloor = base * shape.share;
    const floorFor = (shown: TrackStatus) =>
      shown === 'sc'
        ? (neutralFloor * rc.safetyCarLapFactor) / (catchingUp ? rc.catchUpFactor : 1)
        : shown === 'vsc'
          ? neutralFloor * rc.virtualSafetyCarLapFactor
          : 0;
    for (let done = 0, from = t, left = 1; ;) {
      // The sector's remaining share at racing pace, or slower if a flag is out for it.
      const take = Math.max(segment * left, floorFor(flagAt(from).status) * left);
      const change = nextFlagAfter(from);
      if (!change || change.time >= from + take) {
        segment = done + take;
        break;
      }
      const ran = change.time - from;
      done += ran;
      left -= (ran / take) * left;
      from = change.time;
    }
    const drsOpen =
      flag === 'green' &&
      lap >= drsFromLap &&
      hasDrsZone(model, k) &&
      gapAtEntry < b.drs.windowS &&
      !isLeader;
    /**
     * What the car could do in clean air: the pace an overtake is judged on (ADR 005, п. 17). Dirty
     * air and DRS are what the fight is about and enter the odds as their own terms — measuring the
     * attacker while it sits in the wake of the car it is trying to pass says only that the wake is
     * working, and no queue would ever break up.
     */
    const ownPaceS = segment;
    if (flag === 'green' && aheadAtEntry && gapAtEntry < b.traffic.dirtyAirWindowS && !aheadAtEntry.off) {
      segment +=
        dirtyAirLossS(gapAtEntry, car.entry.car.dirtyAirTolerance, track.profile.aeroSensitivity) -
        slipstreamGainS(gapAtEntry, shape, track.profile.powerSensitivity);
      car.cleanThisLap = false;
    }
    if (drsOpen) segment -= drsGainS(model, k);

    let arrival = t + segment;
    const ahead = lastRunning(crossings[exit]!, car);
    /** The car passed in this sector, if any: the one pass a sector allows. */
    let passed: Crossing | undefined;
    const order = teamOrders.get(car.entry.teamId) ?? 'free';
    const teammateAhead =
      ahead !== undefined && ahead.lap === lap && ahead.car.entry.teamId === car.entry.teamId;
    if (
      teammateAhead &&
      flag === 'green' &&
      order === 'swap' &&
      ahead.car.obeys === true &&
      car.obeys === true &&
      arrival < ahead.time + b.teamOrders.swapWindowS
    ) {
      // On orders: the teammate ahead lets this car by, both losing a little; then they hold.
      arrival = Math.min(arrival + b.teamOrders.yieldLossS, ahead.time - b.overtaking.successMarginS);
      passed = ahead;
      delay(ahead, Math.max(b.teamOrders.yieldLossS, arrival + b.traffic.minGapS - ahead.time));
      emit(arrival, lap, k, 'let-by', car.entry.driverId, ahead.car.entry.driverId);
      teamOrders.set(car.entry.teamId, 'hold');
    } else if (
      teammateAhead &&
      order === 'hold' &&
      car.obeys !== false &&
      arrival < ahead.time + b.traffic.minGapS
    ) {
      // Holding position: no attack on the teammate.
      arrival = ahead.time + b.traffic.minGapS;
    } else if (ahead && arrival < ahead.time + b.traffic.minGapS) {
      // A crossing from an earlier lap at this boundary means the car ahead is a lap down.
      if (ahead.lap < lap) {
        // Blue flags: the backmarker lets the leader through, both lose a little.
        arrival += b.traffic.lapperLossS;
        delay(ahead, Math.max(0, arrival + b.traffic.minGapS - ahead.time) + b.traffic.lappedLossS);
      } else if (
        flag === 'green' &&
        ahead.car.status === 'running' &&
        (hasDrsZone(model, k) || ahead.paceS - ownPaceS >= b.overtaking.outsideDrsMinAdvantageS)
      ) {
        // Being right behind into the braking zone is the chance: a car held at the minimum gap is
        // close enough to have a go (ADR 005, п. 17). Away from a DRS zone it must be clearly
        // faster. Whether the move is on at all is then the odds' business, not this gate's.
        const o = b.overtaking;
        const defender = ahead.car;
        const attackerPushes = car.battery >= b.ers.attackCost;
        const defenderPushes = defender.battery >= b.ers.attackCost;
        const p = overtakeProbability({
          paceAdvantageS: lapAdvantageS(car, ownPaceS, defender, ahead.paceS, k, model),
          drsOpen,
          drsZone: hasDrsZone(model, k),
          attackerRacecraft: d.racecraft,
          defenderRacecraft: defender.entry.driver.racecraft,
          wearAdvantage: defender.wear - car.wear,
          overtakingDifficulty: track.profile.overtakingDifficulty,
          lap1: lap === 1,
          attackerPushes,
          defenderPushes,
          aggression:
            aggressionEffects(car.radio.aggression).attack -
            aggressionEffects(defender.radio.aggression).defence,
        });
        // A driver lunges only when the move is on; otherwise follows and keeps the battery for later.
        if (p < o.minAttackChance) {
          arrival = ahead.time + b.traffic.minGapS;
        } else {
          const passRoll = traffic.next();
          const contact = traffic.chance(o.contactChance * aggressionEffects(car.radio.aggression).contact);
          if (attackerPushes) car.battery -= b.ers.attackCost;
          if (defenderPushes) defender.battery -= b.ers.attackCost;
          if (passRoll < p) {
            arrival = Math.min(arrival, ahead.time - o.successMarginS);
            passed = ahead;
            delay(ahead, Math.max(o.defenseLossS, arrival + b.traffic.minGapS - ahead.time));
            emit(arrival, lap, k, 'overtake', car.entry.driverId, defender.entry.driverId, {
              drs: drsOpen ? 1 : 0,
            });
          } else {
            arrival = ahead.time + b.traffic.minGapS + o.failedAttackerLossS;
            delay(ahead, o.failedDefenderLossS);
            // Once per duel: a train of repelled attacks would bury the rest of the feed.
            const duel = `${car.entry.driverId}>${defender.entry.driverId}`;
            const reported = lastDefenceReport.get(duel);
            if (reported === undefined || lap - reported >= o.defenceReportLaps) {
              lastDefenceReport.set(duel, lap);
              emit(arrival, lap, k, 'defence', defender.entry.driverId, car.entry.driverId, {
                drs: drsOpen ? 1 : 0,
              });
            }
          }
          if (contact) {
            emit(arrival, lap, k, 'contact', car.entry.driverId, defender.entry.driverId, {
              phase: 'battle',
            });
            // The stewards look at it, and about one in three is the attacker's fault.
            if (stewardsRng.chance(b.stewards.penaltyChance)) {
              car.penaltyS += b.stewards.penaltyS;
              emit(arrival, lap, k, 'penalty', car.entry.driverId, defender.entry.driverId, {
                seconds: b.stewards.penaltyS,
                reason: 'collision',
              });
            }
            const lossS = contactDamage(car, arrival, lap);
            arrival += lossS;
            if (lossS > 0) offLine = true; // a puncture: crawling to the pits
            if (car.status !== 'running') continue;
          }
        }
      } else {
        arrival = ahead.time + (flag === 'sc' ? rc.bunchGapS : b.traffic.minGapS);
      }
    }

    // Every other car on this lap that went through the sector ahead stays ahead: one pass a sector,
    // and none without a fight. Checked by crossing time — a defender pushed back behind its attacker
    // is not the car the next one in the queue follows, but it is still in the way.
    for (const c of crossings[exit]!) {
      if (c === passed || c.car === car || c.lap !== lap || c.off || c.car.status !== 'running') continue;
      if (arrival < c.time + b.traffic.minGapS) arrival = c.time + b.traffic.minGapS;
    }

    // ── Wear, fuel, battery over the sector ──
    const neutral = flag !== 'green';
    car.wear +=
      wearPerLap(car.compound, {
        trackDegFactor: track.profile.tyreDegFactor,
        carTyreManagement: car.entry.car.tyreManagement,
        driverTyreManagement: d.tyreManagement,
        fuelKg: car.fuelKg,
        trackTempC: sample.trackTempC,
        wetness: wet,
      }) *
      shape.share *
      paceMode.wear *
      (neutral ? rc.neutralisedWearFactor : 1);
    car.fuelKg = Math.max(
      0,
      car.fuelKg - car.fuelPerLapKg * shape.share * paceMode.fuel * (neutral ? rc.neutralisedFuelFactor : 1),
    );
    carLapsSinceSurface += shape.share;

    const segmentS = arrival - t;
    const lapSegments = (car.segments[lap - 1] ??= model.segments.map(() => 0));
    // Lap 1 sector 1 runs from the start signal, like the lap itself (grid slots start later).
    lapSegments[k] = lap === 1 && k === 0 ? arrival : segmentS;

    // ── Line crossing: lap complete, pit stop, flags ──
    let off = offLine;
    let exitTime = arrival;
    if (exit === 0) {
      const pitted = car.pitRequest !== null;
      // What the lap was driven on — recorded before a stop swaps the tyres.
      const driven = { compound: car.compound, tyreAge: car.tyreAge, wear: car.wear };
      if (car.pitRequest) {
        const stop = stationaryTimeS(car.entry.pitCrew, pitRngs.get(car.entry.teamId)!);
        exitTime = arrival + track.pitLoss * pitLaneFactor(flagAt(arrival).status) + stop.seconds;
        lapSegments[LAST]! += exitTime - arrival;
        off = true;
        emit(arrival, lap, LAST, 'pit', car.entry.driverId, null, {
          from: car.compound,
          to: car.pitRequest.compound,
          stationaryS: round3(stop.seconds),
          slow: stop.slow ? 1 : 0,
        });
        car.compound = car.pitRequest.compound;
        car.wear = 0;
        car.tyreAge = 0;
        car.damageS = 0;
        car.reviewedDamageS = 0;
        car.stops++;
        if (!car.compoundsUsed.includes(car.compound)) car.compoundsUsed.push(car.compound);
        car.plan = car.pitRequest.plan.map((st) => ({ ...st }));
        car.planHistory.push({ timeS: round3(exitTime), stints: schedule(car.plan, lap + 1) });
        car.stintLaps = 0;
        car.pitRequest = null;
      }
      car.lapsDone = lap;
      car.lineTimes[lap] = exitTime;
      car.lapInfo[lap - 1] = {
        compound: driven.compound,
        tyreAge: driven.tyreAge,
        tyreWear: driven.wear,
        battery: car.battery,
        pitted,
        pitLaneS: exitTime - arrival,
        status: flag,
        fuelKg: car.fuelKg,
        clean:
          car.cleanThisLap && !car.incidentThisLap && flag === 'green' && !pitted && !car.freshSet && lap > 1,
        incident: car.incidentThisLap,
      };
      if (!pitted) {
        car.tyreAge++;
        car.stintLaps++;
        car.freshSet = false;
      } else {
        car.freshSet = true;
      }
      car.cleanThisLap = true;
      car.incidentThisLap = false;
      car.battery = Math.min(1, Math.max(0, car.battery + b.ers.harvestPerLap + ersMode.batteryPerLap));
      car.fatigue = Math.min(100, car.fatigue + fatiguePerLap(d, sample.airTempC, track));

      if (lap > leaderLaps) {
        // The race leader starts a new lap: race control, weather, conditions log.
        leaderLaps = lap;
        if (status !== 'green' && leaderLaps >= neutralisedUntilLap) {
          emit(arrival, lap, null, status === 'sc' ? 'safety-car-in' : 'vsc-end');
          if (status === 'sc') drsFromLap = Math.max(drsFromLap, lap + 1 + b.drs.disabledLapsAfterRestart);
          setFlag(arrival, 'green');
        }
        if (lap + 1 === b.drs.enabledFromLap) emit(arrival, lap, null, 'drs-enabled');
        const raining = rainingAt(arrival);
        if (raining !== wasRaining) emit(arrival, lap, null, raining ? 'rain-start' : 'rain-stop');
        wasRaining = raining;
        if (
          status === 'green' &&
          control.chance(backgroundIncidentChancePerLap(track.profile.safetyCarProbability, totalLaps))
        ) {
          incident('crash', arrival, lap, 'debris');
        }
        conditions.push({
          lap,
          airTempC: sample.airTempC,
          trackTempC: sample.trackTempC,
          humidity: sample.humidity,
          windKph: sample.windKph,
          windFromDeg: sample.windFromDeg,
          wetness: surface.wetness.map(round3) as [number, number, number],
          grip: round3(surface.grip),
          status,
        });
        if (lap === totalLaps && flagTime === null) {
          flagTime = arrival;
          emit(arrival, lap, null, 'chequered-flag', car.entry.driverId);
        }
      }
      if (flagTime !== null && arrival >= flagTime) {
        car.status = 'finished';
      }
    }

    crossings[exit]!.push({ car, time: exitTime, lap, segment: k, segmentS, paceS: ownPaceS, off });
    // Typical pace in this sector, not the last lap of it: one lap carries the driver's own scatter,
    // and a duel judged on a single sample is decided by noise (ADR 005, п. 17).
    const remembered = car.recentPaceS[k];
    car.recentPaceS[k] =
      remembered === null || remembered === undefined
        ? ownPaceS
        : remembered + b.overtaking.paceMemory * (ownPaceS - remembered);
    if (crossings[exit]!.length > 64) crossings[exit]!.splice(0, crossings[exit]!.length - 64);
    car.segment = exit;
    car.nextTime = exitTime;
    if (exit === 0 && car.status === 'running') {
      updateRadio(car, exitTime, lap);
      if (isPlayerTeam(car.entry.teamId)) recordForecast(car, exitTime, lap);
    }
    if (car.status === 'running') queue.push(exitTime, orderOf.get(car)!, car);
  }

  /** Pushes a car's latest crossing back in time (a defender losing out, a backmarker yielding). */
  function delay(crossing: Crossing, seconds: number) {
    if (seconds <= 0) return;
    const car = crossing.car;
    // Only the car's latest crossing drives when it starts its next sector.
    const isLatest = car.nextTime === crossing.time;
    crossing.time += seconds;
    crossing.segmentS += seconds;
    const lapSegments = car.segments[crossing.lap - 1];
    if (lapSegments) lapSegments[crossing.segment]! += seconds;
    if (crossing.segment === LAST && car.lineTimes[crossing.lap] !== undefined)
      car.lineTimes[crossing.lap]! += seconds;
    if (car.status === 'running' && isLatest) {
      car.nextTime = crossing.time;
      car.version++;
      queue.push(car.nextTime, orderOf.get(car)!, car);
    }
  }

  const launchS = Object.fromEntries([...launches].map(([id, l]) => [id, round3(l.timeS)]));
  return { ...buildResult(input, cars, events, conditions, plans, totalLaps), launchS, pitWall };
}

/**
 * The car ahead on the road at a boundary the car crossed at `time`: the latest crossing at or before
 * it by another car still racing on track. Chosen by time, not by list order: the list also holds
 * cars behind that have already been simulated up to this boundary, and a pass in the sector before
 * reorders crossings without reordering the list.
 */
function aheadAt(list: readonly Crossing[], self: CarState, time: number): Crossing | undefined {
  let best: Crossing | undefined;
  for (const c of list) {
    if (c.car === self || c.car.status === 'retired' || c.off || c.time > time) continue;
    if (!best || c.time > best.time) best = c;
  }
  return best;
}

/** The latest crossing at a boundary by a car still racing on track, other than `self`, before `after`. */
function lastRunning(list: readonly Crossing[], self: CarState, after?: Crossing): Crossing | undefined {
  let i = list.length - 1;
  if (after) {
    while (i >= 0 && list[i] !== after) i--;
    i--;
  }
  for (; i >= 0; i--) {
    const c = list[i]!;
    if (c.car !== self && c.car.status !== 'retired' && !c.off) return c;
  }
  return undefined;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * How much faster the attacker is over a lap in clean air (dirty air, DRS and queueing out), from
 * each car's remembered pace in every sector. A car faster all round the lap gets a better run at
 * the passing place, not just the sector where the pass happens. Sectors neither car has driven yet
 * (lap 1) fall back on how both are driving this one, and the rest is scaled up to a lap.
 */
function lapAdvantageS(
  attacker: CarState,
  attackerPaceS: number,
  defender: CarState,
  defenderPaceS: number,
  k: number,
  model: TrackModel,
): number {
  let advantage = 0;
  let share = 0;
  for (let j = 0; j < model.segments.length; j++) {
    const mine = attacker.recentPaceS[j] ?? (j === k ? attackerPaceS : null);
    const theirs = defender.recentPaceS[j] ?? (j === k ? defenderPaceS : null);
    if (mine === null || theirs === null) continue;
    advantage += theirs - mine;
    share += model.segments[j]!.share;
  }
  return share > 0 ? advantage / share : 0;
}

/** Stints laid out on the race's laps, the first starting at `fromLap`. */
function schedule(stints: readonly Stint[], fromLap: number): ScheduledStint[] {
  let lap = fromLap;
  return stints.map((st) => {
    const scheduled = { compound: st.compound, fromLap: lap, toLap: lap + st.laps - 1 };
    lap += st.laps;
    return scheduled;
  });
}

function buildResult(
  input: RaceInput,
  cars: CarState[],
  events: RaceEvent[],
  conditions: ConditionsRecord[],
  plans: Map<string, StrategyPlan>,
  totalLaps: number,
): Omit<RaceResult, 'launchS' | 'pitWall'> {
  // Positions and gaps at each line crossing, from the final crossing times.
  const laps: Record<string, LapRecord[]> = {};
  for (const car of cars) laps[car.entry.driverId] = [];
  for (let lap = 1; lap <= totalLaps; lap++) {
    const crossed = cars
      .filter((c) => c.lineTimes[lap] !== undefined && c.lapsDone >= lap)
      .sort((a, b) => a.lineTimes[lap]! - b.lineTimes[lap]!);
    const leaderTime = crossed[0]?.lineTimes[lap];
    crossed.forEach((car, i) => {
      const info = car.lapInfo[lap - 1]!;
      const segments = car.segments[lap - 1] ?? [];
      laps[car.entry.driverId]!.push({
        lap,
        lapTimeS: round3(car.lineTimes[lap]! - car.lineTimes[lap - 1]!),
        lineTimeS: round3(car.lineTimes[lap]!),
        segmentsS: segments.map(round3),
        position: i + 1,
        gapToLeaderS: round3(car.lineTimes[lap]! - leaderTime!),
        compound: info.compound,
        tyreAge: info.tyreAge,
        tyreWear: round3(info.tyreWear),
        battery: round3(info.battery),
        pitted: info.pitted,
        pitLaneS: round3(info.pitLaneS),
        status: info.status,
        fuelKg: round3(info.fuelKg),
        cleanAir: info.clean,
        incident: info.incident,
      });
    });
  }

  // A penalty is served at the flag: the lap chart is what happened on track, the classification is
  // what the stewards left standing (plan 5.3).
  const finalTime = (c: CarState) => (c.lineTimes[c.lapsDone] ?? 0) + c.penaltyS;
  const finishers = cars
    .filter((c) => c.status === 'finished')
    .sort((a, b) => b.lapsDone - a.lapsDone || finalTime(a) - finalTime(b));
  const retired = cars
    .filter((c) => c.status !== 'finished')
    .sort((a, b) => b.lapsDone - a.lapsDone || b.retireTime - a.retireTime);
  const winner = finishers[0];
  const winnerTime = winner ? finalTime(winner) : 0;
  const points = input.format === 'sprint' ? input.regulation.points.sprint : input.regulation.points.race;
  const classificationCutoff = Math.ceil(totalLaps * input.regulation.classifiedShareOfLaps);

  const classification: ClassifiedCar[] = [...finishers, ...retired].map((car, i) => {
    const finished = car.status === 'finished';
    const time = finalTime(car);
    const lapsDown = winner ? winner.lapsDone - car.lapsDone : 0;
    const classified = finished || car.lapsDone >= classificationCutoff;
    const bestLap = laps[car.entry.driverId]!.reduce<number | null>(
      (best, l) => (l.lap > 1 && !l.pitted && (best === null || l.lapTimeS < best) ? l.lapTimeS : best),
      null,
    );
    return {
      position: i + 1,
      driverId: car.entry.driverId,
      teamId: car.entry.teamId,
      status: finished ? 'finished' : 'retired',
      retireReason: car.retireReason,
      laps: car.lapsDone,
      totalTimeS: round3(time),
      penaltyS: car.penaltyS,
      gapS: finished && lapsDown === 0 ? round3(time - winnerTime) : null,
      lapsDown,
      bestLapS: bestLap,
      stops: car.stops,
      compounds: [...car.compoundsUsed],
      points: classified ? (points[i] ?? 0) : 0,
    };
  });

  return {
    classification,
    laps,
    events,
    conditions,
    plans: Object.fromEntries(cars.map((c) => [c.entry.driverId, plans.get(c.entry.driverId)!])),
    planHistory: Object.fromEntries(cars.map((c) => [c.entry.driverId, c.planHistory])),
  };
}
