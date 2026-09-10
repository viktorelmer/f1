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
import {
  decidePitCall,
  decideRaceStrategy,
  type PitCallTrigger,
  pitCallOptions,
  planOptions,
  type StintModel,
} from './strategy';
import { prepareTrack, type TrackModel } from './track';
import { dirtyAirLossS, drsGainS, hasDrsZone, overtakeProbability, slipstreamGainS } from './traffic';
import { bestCompoundFor, COMPARISON_WEAR, isDry, tyreLossS, warmupLossS, wearPerLap } from './tyres';
import type {
  ClassifiedCar,
  ConditionsRecord,
  LapRecord,
  RaceEntry,
  RaceEvent,
  RaceEventKind,
  RaceInput,
  RaceResult,
  SectorIndex,
  Stint,
  StrategyPlan,
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
  sector: SectorIndex;
  compound: Compound;
  wear: number;
  tyreAge: number;
  freshSet: boolean;
  compoundsUsed: Compound[];
  stops: number;
  fuelKg: number;
  battery: number;
  fatigue: number;
  damageS: number;
  partialFailureS: number;
  /** Remaining stints, the current one first; `stintLaps` counts laps done on the current one. */
  plan: Stint[];
  stintLaps: number;
  pitRequest: { compound: Compound; plan: Stint[] } | null;
  reviewedWetness: number;
  reviewedNeutralisation: number;
  /** Per lap: sector times, line time, and what the lap looked like. */
  sectors: [number, number, number][];
  lineTimes: number[];
  lapInfo: {
    compound: Compound;
    tyreAge: number;
    pitted: boolean;
    status: TrackStatus;
    fuelKg: number;
    clean: boolean;
    incident: boolean;
  }[];
  cleanThisLap: boolean;
  incidentThisLap: boolean;
  startBonusS: number;
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
  sector: SectorIndex;
  segmentS: number;
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

export function simulateRace(input: RaceInput): RaceResult {
  const b = balance.race;
  const model: TrackModel = prepareTrack(input.track, input.geometry);
  const track = input.track;
  const totalLaps = track.laps;
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
    sector: SectorIndex | null,
    kind: RaceEventKind,
    driverId: string | null = null,
    otherId: string | null = null,
    detail: Record<string, string | number> = {},
  ) => events.push({ timeS: round3(timeS), lap, sector, kind, driverId, otherId, detail });

  const entriesById = new Map(input.entries.map((e) => [e.driverId, e]));
  const gridOrder = input.grid.filter((id) => entriesById.has(id));
  let surface: SurfaceState = initialSurface(input.weather);
  const start = sampleAt(input.weather, 0);

  // ── Pre-race: each team's strategist picks a plan through decide() ─────────────────────────
  const plans = new Map<string, StrategyPlan>();
  const teams = [...new Set(input.entries.map((e) => e.teamId))];
  for (const teamId of teams) {
    const cars = input.entries.filter((e) => e.teamId === teamId);
    const lead = cars[0]!;
    const fuelKg = fuelPerLap(track, lead.car.fuelEfficiency) * totalLaps;
    const stintModel: StintModel = {
      track,
      carTyreManagement: lead.car.tyreManagement,
      driverTyreManagement: cars.reduce((s, c) => s + c.driver.tyreManagement, 0) / cars.length,
      trackTempC: start.trackTempC,
      wetness: Math.max(...surface.wetness),
      averageFuelKg: fuelKg / 2,
    };
    const decision = decideRaceStrategy(
      planOptions(totalLaps, stintModel),
      lead.strategist,
      { goal: 'fastest', risk: lead.riskAppetite, issuedBy: 'team-character' },
      stream(`decisions:${teamId}:plan`),
    );
    for (const car of cars) plans.set(car.driverId, decision.choice.plan);
  }

  // ── Grid ─────────────────────────────────────────────────────────────────────────────────
  const s = b.start;
  const cars: CarState[] = gridOrder.map((id, gridIndex) => {
    const entry = entriesById.get(id)!;
    const plan = plans.get(id)!;
    const perLap = fuelPerLap(track, entry.car.fuelEfficiency);
    return {
      entry,
      status: 'running',
      retireReason: null,
      retireTime: 0,
      nextTime: gridIndex * s.gridSlotS,
      version: 0,
      lapsDone: 0,
      sector: 0,
      compound: plan.stints[0]!.compound,
      wear: 0,
      tyreAge: 0,
      freshSet: true,
      compoundsUsed: [plan.stints[0]!.compound],
      stops: 0,
      fuelKg: perLap * totalLaps + b.fuel.marginKg,
      battery: 1,
      fatigue: entry.driver.fatigue,
      damageS: 0,
      partialFailureS: 0,
      plan: plan.stints.map((st) => ({ ...st })),
      stintLaps: 0,
      pitRequest: null,
      reviewedWetness: Math.max(...surface.wetness),
      reviewedNeutralisation: 0,
      sectors: [],
      // The race clock starts at the signal for everyone: lap 1 includes the run from the grid slot.
      lineTimes: [0],
      lapInfo: [],
      cleanThisLap: true,
      incidentThisLap: false,
      startBonusS: -s.skillSPerPoint * (entry.driver.starts - s.skillRef) + startRng.normal(0, s.spreadSd),
      carFraction: carPaceFraction(entry.car, track),
      fuelPerLapKg: perLap,
      pace: stream(`pace:${id}`),
      tyreRng: stream(`tyres:${id}`),
      reliabilityRng: stream(`reliability:${id}`),
    };
  });
  const orderOf = new Map(cars.map((c, i) => [c, i]));
  const pitRngs = new Map(teams.map((t) => [t, stream(`pit:${t}`)]));
  const callRngs = new Map(teams.map((t) => [t, stream(`decisions:${t}:calls`)]));

  const queue = new SegmentQueue();
  for (const car of cars) queue.push(car.nextTime, orderOf.get(car)!, car);
  // The grid itself: at the start, the car ahead of each car is the one on the slot in front.
  const crossings: [Crossing[], Crossing[], Crossing[]] = [
    cars.map((car) => ({ car, time: car.nextTime, lap: 0, sector: 2, segmentS: 0, off: false })),
    [],
    [],
  ];
  emit(0, 1, 0, 'start', null, null, { cars: cars.length });

  // ── Race control state ───────────────────────────────────────────────────────────────────
  // Changed inside closures (deploy), so it must not narrow to its initial value.
  let status = 'green' as TrackStatus;
  let neutralisedUntilLap = 0;
  let neutralisation = 0;
  let drsFromLap = b.drs.enabledFromLap;
  let leaderLaps = 0;
  let flagTime: number | null = null;
  let carLapsSinceSurface = 0;
  const conditions: ConditionsRecord[] = [];
  const rainingAt = (timeS: number) => sampleAt(input.weather, timeS).rain.some((r) => r > 0);
  let wasRaining = rainingAt(0);

  const deploy = (response: 'sc' | 'vsc' | null, timeS: number, lap: number, cause: string) => {
    if (!response) return;
    if (status === 'sc' || (status === 'vsc' && response === 'vsc')) return;
    const rc = b.raceControl;
    const [lo, hi] = response === 'sc' ? rc.safetyCarLaps : rc.virtualSafetyCarLaps;
    status = response;
    neutralisation++;
    neutralisedUntilLap = leaderLaps + control.int(lo, hi) + 1;
    emit(timeS, lap, null, response === 'sc' ? 'safety-car' : 'vsc', null, null, { cause });
  };

  const incident = (kind: IncidentKind, timeS: number, lap: number, cause: string) =>
    deploy(raceControlResponse(kind, track.profile.safetyCarProbability, control), timeS, lap, cause);

  const retire = (car: CarState, timeS: number, lap: number, reason: string, kind: IncidentKind) => {
    car.status = 'retired';
    car.retireReason = reason;
    car.retireTime = timeS;
    car.version++;
    emit(timeS, lap, car.sector, 'retirement', car.entry.driverId, null, { reason });
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
      carTyreManagement: car.entry.car.tyreManagement,
      driverTyreManagement: car.entry.driver.tyreManagement,
      trackTempC: sample.trackTempC,
      wetness: (surface.wetness[0] + surface.wetness[1] + surface.wetness[2]) / 3,
      averageFuelKg: car.fuelKg / 2,
    };
  };

  /** The strategist's pit call through decide(); a puncture forces a stop, only the tyre is chosen. */
  function requestPit(car: CarState, trigger: PitCallTrigger, timeS: number, lap: number) {
    const remaining = totalLaps - lap;
    if (remaining <= 0 && trigger !== 'puncture') return;
    const options = pitCallOptions({
      trigger,
      remainingLaps: Math.max(0, remaining),
      current: { compound: car.compound, wear: car.wear },
      compoundsUsed: car.compoundsUsed,
      status,
      model: stintModelFor(car, timeS),
    });
    const decision = decidePitCall(
      options,
      car.entry.strategist,
      { goal: 'fastest', risk: car.entry.riskAppetite, issuedBy: 'team-character' },
      callRngs.get(car.entry.teamId)!,
    );
    const choice = decision.choice;
    emit(timeS, lap, car.sector, 'strategy-call', car.entry.driverId, null, {
      trigger,
      call: choice.call,
      compound: choice.compound,
    });
    if (choice.call === 'pit') car.pitRequest = { compound: choice.compound, plan: choice.stints };
    else if (choice.stints.length > 0) {
      car.plan = choice.stints.map((st, i) =>
        i === 0 ? { ...st, laps: st.laps + car.stintLaps } : { ...st },
      );
    }
  }

  // ── The main loop ────────────────────────────────────────────────────────────────────────
  let popped = queue.pop();
  while (popped) {
    const { car, version, time: t } = popped;
    popped = queue.pop();
    if (car.status !== 'running' || version !== car.version) continue;

    const k = car.sector;
    const lap = car.lapsDone + 1;
    const shape = model.sectors[k];
    if (carLapsSinceSurface > 0 || t / 60 >= surface.minute + 1) {
      surface = advanceSurface(surface, input.weather, t, carLapsSinceSurface);
      carLapsSinceSurface = 0;
    }
    const sample = sampleAt(input.weather, t);
    const wet = surface.wetness[k];
    const d = car.entry.driver;

    // Strategy triggers are reviewed before the last sector: a stop happens at the end of the lap.
    if (k === 2 && lap < totalLaps && !car.pitRequest && flagTime === null) {
      const avgWet = (surface.wetness[0] + surface.wetness[1] + surface.wetness[2]) / 3;
      const planned = car.plan.length > 1 && car.stintLaps + 1 >= car.plan[0]!.laps;
      if (car.damageS > 0) requestPit(car, 'damage', t, lap);
      else if (status !== 'green' && car.reviewedNeutralisation !== neutralisation) {
        car.reviewedNeutralisation = neutralisation;
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
      car.damageS +
      car.partialFailureS +
      (car.freshSet ? warmupLossS(car.compound) : 0);
    let segment =
      (lapTime + perLapExtras) * shape.share +
      windSeconds(shape, sample) +
      car.pace.normal(0, lapNoiseSd(d.consistency) / Math.sqrt(3));
    if (lap === 1 && k === 0) segment += s.standingStartLossS + car.startBonusS;

    // ── Things going wrong ──
    let spunOff = false;
    if (status === 'green') {
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
        }) /
          3
      ) {
        if (outcome.kind === 'crash') {
          emit(t, lap, k, 'crash', car.entry.driverId);
          retire(car, t, lap, 'crash', 'crash');
          continue;
        }
        segment += outcome.lossS;
        car.incidentThisLap = true;
        // A spun car is driven around, not overtaken.
        if (outcome.kind === 'spin') spunOff = true;
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
      failureRoll < failureChancePerLap(car.entry.car.reliability, totalLaps) / 3
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
    if (punctureRoll < punctureChancePerLap(car.wear, balance.tyres.compounds[car.compound].cliffWear) / 3) {
      emit(t, lap, k, 'puncture', car.entry.driverId);
      if (punctureRetires) {
        retire(car, t, lap, 'puncture', 'stopped-car');
        continue;
      }
      segment += balance.tyres.puncture.lossS * (1 - shape.share);
      car.incidentThisLap = true;
      requestPit(car, 'puncture', t, lap);
    }
    if (lap === 1 && k === 0 && traffic.chance(s.lap1ContactChance)) {
      emit(t, lap, k, 'contact', car.entry.driverId, null, { phase: 'start' });
      segment += contactDamage(car, t, lap);
      if (car.status !== 'running') continue;
    }

    // ── Neutralisation ──
    const rc = b.raceControl;
    const neutralFloor = base * shape.share;
    if (status === 'vsc') segment = Math.max(segment, neutralFloor * rc.virtualSafetyCarLapFactor);

    // ── Traffic: the car ahead at the sector's entry and exit ──
    const exit = ((k + 1) % 3) as SectorIndex;
    const aheadAtEntry = lastRunning(crossings[k], car);
    const gapAtEntry = aheadAtEntry ? t - aheadAtEntry.time : Infinity;
    const isLeader = !aheadAtEntry || aheadAtEntry.lap < (k === 0 ? lap - 1 : lap);
    if (status === 'sc') {
      const catchingUp = !isLeader && gapAtEntry > rc.bunchGapS * rc.catchUpBeyondGaps;
      segment = Math.max(
        segment,
        (neutralFloor * rc.safetyCarLapFactor) / (catchingUp ? rc.catchUpFactor : 1),
      );
    }
    const drsOpen =
      status === 'green' &&
      lap >= drsFromLap &&
      hasDrsZone(model, k) &&
      gapAtEntry < b.drs.windowS &&
      !isLeader;
    if (status === 'green' && aheadAtEntry && gapAtEntry < b.traffic.dirtyAirWindowS && !aheadAtEntry.off) {
      segment +=
        dirtyAirLossS(gapAtEntry, car.entry.car.dirtyAirTolerance, track.profile.aeroSensitivity) -
        slipstreamGainS(gapAtEntry, shape, track.profile.powerSensitivity);
      car.cleanThisLap = false;
    }
    // Pace advantage for an overtake is judged before DRS: DRS enters the odds as its own term.
    const segmentBeforeDrs = segment;
    if (drsOpen) segment -= drsGainS(model, k);

    let arrival = t + segment;
    const ahead = lastRunning(crossings[exit], car);
    if (ahead && arrival < ahead.time + b.traffic.minGapS) {
      // A crossing from an earlier lap at this boundary means the car ahead is a lap down.
      if (ahead.lap < lap) {
        // Blue flags: the backmarker lets the leader through, both lose a little.
        arrival += b.traffic.lapperLossS;
        delay(ahead, Math.max(0, arrival + b.traffic.minGapS - ahead.time) + b.traffic.lappedLossS);
      } else if (
        status === 'green' &&
        ahead.car.status === 'running' &&
        arrival < ahead.time &&
        (hasDrsZone(model, k) || ahead.segmentS - segmentBeforeDrs >= b.overtaking.outsideDrsMinAdvantageS)
      ) {
        // An attempt only when the follower would have got there first — and, away from a DRS zone,
        // only when clearly faster. Otherwise it queues.
        const o = b.overtaking;
        const defender = ahead.car;
        const attackerPushes = car.battery >= b.ers.attackCost;
        const defenderPushes = defender.battery >= b.ers.attackCost;
        const p = overtakeProbability({
          paceAdvantageS: ahead.segmentS - segmentBeforeDrs,
          drsOpen,
          drsZone: hasDrsZone(model, k),
          attackerRacecraft: d.racecraft,
          defenderRacecraft: defender.entry.driver.racecraft,
          wearAdvantage: defender.wear - car.wear,
          overtakingDifficulty: track.profile.overtakingDifficulty,
          lap1: lap === 1,
          attackerPushes,
          defenderPushes,
        });
        const passRoll = traffic.next();
        const contact = traffic.chance(o.contactChance);
        if (attackerPushes) car.battery -= b.ers.attackCost;
        if (defenderPushes) defender.battery -= b.ers.attackCost;
        if (passRoll < p) {
          arrival = Math.min(arrival, ahead.time - o.successMarginS);
          delay(ahead, Math.max(o.defenseLossS, arrival + b.traffic.minGapS - ahead.time));
          emit(arrival, lap, k, 'overtake', car.entry.driverId, defender.entry.driverId, {
            drs: drsOpen ? 1 : 0,
          });
        } else {
          arrival = ahead.time + b.traffic.minGapS + o.failedAttackerLossS;
          delay(ahead, o.failedDefenderLossS);
        }
        if (contact) {
          emit(arrival, lap, k, 'contact', car.entry.driverId, defender.entry.driverId, { phase: 'battle' });
          arrival += contactDamage(car, arrival, lap);
          if (car.status !== 'running') continue;
        }
        // One pass per sector: behind the next car ahead, the attacker has to wait.
        const next = lastRunning(crossings[exit], car, ahead);
        if (next && arrival < next.time + b.traffic.minGapS && arrival > next.time - b.traffic.minGapS) {
          arrival = next.time + b.traffic.minGapS;
        }
      } else {
        arrival = ahead.time + (status === 'sc' ? rc.bunchGapS : b.traffic.minGapS);
      }
    }

    // ── Wear, fuel, battery over the sector ──
    const neutral = status !== 'green';
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
      (neutral ? rc.neutralisedWearFactor : 1);
    car.fuelKg = Math.max(
      0,
      car.fuelKg - car.fuelPerLapKg * shape.share * (neutral ? rc.neutralisedFuelFactor : 1),
    );
    carLapsSinceSurface += shape.share;

    const segmentS = arrival - t;
    const lapSectors = (car.sectors[lap - 1] ??= [0, 0, 0]);
    // Lap 1 sector 1 runs from the start signal, like the lap itself (grid slots start later).
    lapSectors[k] = lap === 1 && k === 0 ? arrival : segmentS;

    // ── Line crossing: lap complete, pit stop, flags ──
    let off = spunOff;
    let exitTime = arrival;
    if (exit === 0) {
      const pitted = car.pitRequest !== null;
      if (car.pitRequest) {
        const stop = stationaryTimeS(car.entry.pitCrew, pitRngs.get(car.entry.teamId)!);
        exitTime = arrival + track.pitLoss * pitLaneFactor(status) + stop.seconds;
        lapSectors[2] += exitTime - arrival;
        off = true;
        emit(arrival, lap, 2, 'pit', car.entry.driverId, null, {
          from: car.compound,
          to: car.pitRequest.compound,
          stationaryS: round3(stop.seconds),
          slow: stop.slow ? 1 : 0,
        });
        car.compound = car.pitRequest.compound;
        car.wear = 0;
        car.tyreAge = 0;
        car.damageS = 0;
        car.stops++;
        if (!car.compoundsUsed.includes(car.compound)) car.compoundsUsed.push(car.compound);
        car.plan = car.pitRequest.plan.map((st) => ({ ...st }));
        car.stintLaps = 0;
        car.pitRequest = null;
      }
      car.lapsDone = lap;
      car.lineTimes[lap] = exitTime;
      car.lapInfo[lap - 1] = {
        compound: pitted ? car.compoundsUsed[car.compoundsUsed.length - 1]! : car.compound,
        tyreAge: car.tyreAge,
        pitted,
        status,
        fuelKg: car.fuelKg,
        clean:
          car.cleanThisLap &&
          !car.incidentThisLap &&
          status === 'green' &&
          !pitted &&
          !car.freshSet &&
          lap > 1,
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
      car.battery = Math.min(1, car.battery + b.ers.harvestPerLap);
      car.fatigue = Math.min(100, car.fatigue + fatiguePerLap(d, sample.airTempC, track));

      if (lap > leaderLaps) {
        // The race leader starts a new lap: race control, weather, conditions log.
        leaderLaps = lap;
        if (status !== 'green' && leaderLaps >= neutralisedUntilLap) {
          emit(arrival, lap, null, status === 'sc' ? 'safety-car-in' : 'vsc-end');
          if (status === 'sc') drsFromLap = Math.max(drsFromLap, lap + 1 + b.drs.disabledLapsAfterRestart);
          status = 'green';
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

    crossings[exit].push({ car, time: exitTime, lap, sector: k, segmentS, off });
    if (crossings[exit].length > 64) crossings[exit].splice(0, crossings[exit].length - 64);
    car.sector = exit;
    car.nextTime = exitTime;
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
    const lapSectors = car.sectors[crossing.lap - 1];
    if (lapSectors) lapSectors[crossing.sector] += seconds;
    if (crossing.sector === 2 && car.lineTimes[crossing.lap] !== undefined)
      car.lineTimes[crossing.lap]! += seconds;
    if (car.status === 'running' && isLatest) {
      car.nextTime = crossing.time;
      car.version++;
      queue.push(car.nextTime, orderOf.get(car)!, car);
    }
  }

  return buildResult(input, cars, events, conditions, plans, totalLaps);
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

function buildResult(
  input: RaceInput,
  cars: CarState[],
  events: RaceEvent[],
  conditions: ConditionsRecord[],
  plans: Map<string, StrategyPlan>,
  totalLaps: number,
): RaceResult {
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
      const sectors = car.sectors[lap - 1] ?? [0, 0, 0];
      laps[car.entry.driverId]!.push({
        lap,
        lapTimeS: round3(car.lineTimes[lap]! - car.lineTimes[lap - 1]!),
        sectorsS: sectors.map(round3) as [number, number, number],
        position: i + 1,
        gapToLeaderS: round3(car.lineTimes[lap]! - leaderTime!),
        compound: info.compound,
        tyreAge: info.tyreAge,
        pitted: info.pitted,
        status: info.status,
        fuelKg: round3(info.fuelKg),
        cleanAir: info.clean,
        incident: info.incident,
      });
    });
  }

  const finishers = cars
    .filter((c) => c.status === 'finished')
    .sort((a, b) => b.lapsDone - a.lapsDone || a.lineTimes[a.lapsDone]! - b.lineTimes[b.lapsDone]!);
  const retired = cars
    .filter((c) => c.status !== 'finished')
    .sort((a, b) => b.lapsDone - a.lapsDone || b.retireTime - a.retireTime);
  const winner = finishers[0];
  const winnerTime = winner ? winner.lineTimes[winner.lapsDone]! : 0;
  const points = input.regulation.points.race;
  const classificationCutoff = Math.ceil(totalLaps * input.regulation.classifiedShareOfLaps);

  const classification: ClassifiedCar[] = [...finishers, ...retired].map((car, i) => {
    const finished = car.status === 'finished';
    const time = car.lineTimes[car.lapsDone] ?? 0;
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
  };
}
