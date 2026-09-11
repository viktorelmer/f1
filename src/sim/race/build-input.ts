/**
 * From a career world to a race input (docs/systems/race.md). Weather is rolled here, not in the
 * race: it is part of the input, so a race replays from its input alone — and in M5 the same
 * timeline will stretch across the whole weekend.
 */
import { balance } from '@/data/balance';
import type { Pack } from '@/data/schema/pack';
import { carPerformance } from '../car/performance';
import { profileFromAttributes } from '../decide/decide';
import { type Rng, streams } from '../rng/rng';
import type { World } from '../types/world';
import { carPaceFraction, driverPaceFraction, lapNoiseSd } from './pace';
import { tyreLossS } from './tyres';
import type { RaceCommand, RaceControl, RaceEntry, RaceInput } from './types';
import { generateWeather } from './weather';

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
export type RaceControlInput = { control?: RaceControl | null; commands?: readonly RaceCommand[] };

export function buildRaceInput(
  world: World,
  pack: Pack,
  round: number,
  seed: string = world.seed,
  { control = null, commands = [] }: RaceControlInput = {},
): RaceInput {
  const season = world.season;
  const weekend = season.calendar.find((r) => r.round === round);
  if (!weekend) throw new RangeError(`No round ${round} in the ${season.year} calendar`);
  const track = pack.tracks.find((t) => t.id === weekend.trackId)!;
  const geometry = pack.geometry.find((g) => g.trackId === track.id)!;
  const regulation = pack.regulations.find((r) => r.season === season.year) ?? pack.regulations[0]!;
  const rng = streams(seed);
  const stream = (name: string) => rng(`race:${season.year}:r${round}:${name}`);

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
      };
    });
  });

  const weather = generateWeather(track, stream('weather'));
  return {
    seed,
    season: season.year,
    round,
    track,
    geometry,
    regulation,
    weather,
    grid: provisionalGrid(entries, { track, weather }, stream('grid')),
    entries,
    raceDate: weekend.raceDate,
    control,
    commands: [...commands].sort((a, b) => a.timeS - b.timeS),
  };
}
