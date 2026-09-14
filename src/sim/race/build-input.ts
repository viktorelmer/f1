/**
 * From a career world to a race input (docs/systems/race.md). Weather is rolled here, not in the
 * race: it is part of the input, so a race replays from its input alone — and in M5 the same
 * timeline will stretch across the whole weekend.
 */
import { balance } from '@/data/balance';
import type { Pack, Setup } from '@/data/schema/pack';
import { carPerformance } from '../car/performance';
import { idealSetup, setupConditions, setupLossS } from '../car/setup';
import { profileFromAttributes } from '../decide/decide';
import { type Rng, streams } from '../rng/rng';
import type { WeekendKnowledge, World } from '../types/world';
import { carPaceFraction, driverPaceFraction, fuelPerLap, lapNoiseSd } from './pace';
import { tyreLossS } from './tyres';
import type { RaceCommand, RaceControl, RaceEntry, RaceInput } from './types';
import { generateWeather } from './weather';
import { priorKnowledge } from '../weekend/knowledge';

/**
 * A provisional grid until qualifying exists (M5): each car's single-lap pace on fresh softs — the
 * driver's qualifying attribute standing in for race pace — with one lap's worth of scatter.
 */
export function provisionalGrid(
  entries: readonly RaceEntry[],
  input: Pick<RaceInput, 'track' | 'weather'>,
  rng: Rng,
): string[] {
  const { track } = input;
  const first = input.weather.samples[0]!;
  const laps = entries.map((e) => {
    const driver = { ...e.driver, pace: e.driver.qualifying };
    const lap =
      track.baseLapTime * (1 + carPaceFraction(e.car, track)) * (1 + driverPaceFraction(driver, 0)) +
      tyreLossS('soft', 0, first.trackTempC, 0) +
      rng.normal(0, lapNoiseSd(e.driver.consistency));
    return { id: e.driverId, lap };
  });
  return laps.sort((a, b) => a.lap - b.lap).map((l) => l.id);
}

/** The player's side of a race: how the team is run and what was said on the radio. */
export type RaceControlInput = {
  control?: RaceControl | null;
  commands?: readonly RaceCommand[];
  /** The grid from qualifying, pole first; without one the provisional shootout stands in. */
  grid?: readonly string[];
  /** A sprint runs the same race over a share of the distance, on the sprint points. */
  format?: 'race' | 'sprint';
};

/**
 * What every team believes about a weekend before anyone has run: the prior each of them arrives
 * with. The weekend files this into the world when it opens, drawn from the same streams the race
 * would have drawn it from, so storing it changes nothing about what anybody knows.
 */
export function weekendPriors(
  world: World,
  pack: Pack,
  round: number,
  seed: string = world.seed,
): Record<string, WeekendKnowledge> {
  const season = world.season;
  const weekend = season.calendar.find((r) => r.round === round);
  if (!weekend) throw new RangeError(`No round ${round} in the ${season.year} calendar`);
  const track = pack.tracks.find((t) => t.id === weekend.trackId)!;
  const rng = streams(seed);
  return Object.fromEntries(
    Object.values(world.teams).map((team) => [
      team.id,
      priorKnowledge(
        round,
        {
          tyreDegradation: track.profile.tyreDegFactor,
          fuelPerLapKg: fuelPerLap(track, carPerformance(team.chassis, team.engine.spec).fuelEfficiency),
        },
        weekend.raceDate,
        rng(`race:${season.year}:r${round}:prior:${team.id}`),
      ),
    ]),
  );
}

export function buildRaceInput(
  world: World,
  pack: Pack,
  round: number,
  seed: string = world.seed,
  { control = null, commands = [], grid, format = 'race' }: RaceControlInput = {},
): RaceInput {
  const season = world.season;
  const weekend = season.calendar.find((r) => r.round === round);
  if (!weekend) throw new RangeError(`No round ${round} in the ${season.year} calendar`);
  const track = pack.tracks.find((t) => t.id === weekend.trackId)!;
  const geometry = pack.geometry.find((g) => g.trackId === track.id)!;
  const regulation = pack.regulations.find((r) => r.season === season.year) ?? pack.regulations[0]!;
  const rng = streams(seed);
  const stream = (name: string) => rng(`race:${season.year}:r${round}:${name}`);

  // The weather is the weekend's, not the entries': it is drawn first so the setup can be judged
  // against the optimum for these conditions (docs/systems/setup.md).
  const weather = generateWeather(track, stream('weather'));
  const ideal = idealSetup(track, setupConditions(weather), world.hidden.tracks[track.id]?.setupOffset);
  /** What is on this car: the weekend's own setup, or the factory preset when no weekend is open. */
  const setupOf = (driverId: string): Setup =>
    (world.weekend?.round === round ? world.weekend.setups[driverId] : undefined) ?? track.factorySetup;

  /**
   * What a team believes about this weekend: what it learned in practice, or — when it has not run
   * here yet — the prior it arrives with (docs/systems/weekend.md). The prior is drawn from the
   * seed, so a team that skips practice is not handed the truth for free.
   */
  const weekendOf = (teamId: string) => {
    const known = world.knowledge[teamId]?.weekend;
    if (known && known.round === round) return known;
    const team = world.teams[teamId];
    const truth = {
      tyreDegradation: track.profile.tyreDegFactor,
      fuelPerLapKg: fuelPerLap(track, carPerformance(team!.chassis, team!.engine.spec).fuelEfficiency),
    };
    return priorKnowledge(round, truth, weekend.raceDate, stream(`prior:${teamId}`));
  };
  const beliefsOf = (teamId: string): RaceEntry['beliefs'] => {
    const known = weekendOf(teamId);
    return {
      tyreDegradation: known.tyreDegradation.value,
      fuelPerLapKg: known.fuelPerLapKg.value,
      fuelSdKg: known.fuelPerLapKg.basis.sd,
    };
  };

  const entries: RaceEntry[] = Object.values(world.teams).flatMap((team) => {
    const staff = team.staffIds.map((id) => world.staff[id]!);
    const strategist = staff.find((s) => s.role === 'strategist');
    const chiefMechanic = staff.find((s) => s.role === 'chief-mechanic');
    // Pit-crew quality: the chief mechanic and the race team department together.
    const pitCrew =
      ((chiefMechanic?.attributes.skill ?? balance.race.pit.crewWithoutChiefMechanic) +
        team.departments.raceTeam.quality) /
      2;
    const car = carPerformance(team.chassis, team.engine.spec);
    return team.drivers.race.map((driverId): RaceEntry => {
      const d = world.drivers[driverId]!;
      const engineer = staff.find((s) => s.role === 'race-engineer' && s.assignedDriverId === driverId);
      return {
        driverId,
        teamId: team.id,
        driver: {
          pace: d.attributes.pace,
          consistency: d.attributes.consistency,
          racecraft: d.attributes.racecraft,
          tyreManagement: d.attributes.tyreManagement,
          wetSkill: d.attributes.wetSkill,
          starts: d.attributes.starts,
          qualifying: d.attributes.qualifying,
          stamina: d.attributes.stamina,
          form: d.state.form,
          morale: d.state.morale,
          fatigue: d.state.fatigue,
          ego: d.personality.ego,
          loyalty: d.personality.loyalty,
        },
        car,
        pitCrew,
        strategist: strategist
          ? profileFromAttributes(strategist.attributes)
          : { skill: 0, consistency: 0, rapport: 0 },
        raceEngineer: engineer
          ? profileFromAttributes(engineer.attributes)
          : { skill: 0, consistency: 0, rapport: 0 },
        riskAppetite: team.character.riskAppetite,
        beliefs: beliefsOf(team.id),
        setupLossS: setupLossS(setupOf(driverId), ideal),
        // What the car has left of its entry, when there is a weekend open around this race.
        tyreSets: world.weekend?.round === round ? world.weekend.sets[driverId] : undefined,
      };
    });
  });

  return {
    seed,
    season: season.year,
    round,
    track,
    geometry,
    regulation,
    weather,
    grid: grid ? [...grid] : provisionalGrid(entries, { track, weather }, stream('grid')),
    entries,
    raceDate: weekend.raceDate,
    format,
    distanceLaps:
      format === 'sprint'
        ? Math.max(2, Math.round(track.laps * balance.race.sprint.distanceShare))
        : track.laps,
    control,
    commands: [...commands].sort((a, b) => a.timeS - b.timeS),
  };
}
