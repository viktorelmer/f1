/**
 * Dialling the car in over a weekend (docs/systems/setup.md). Every car — the player's and every
 * rival's — goes through the same two moments: the engineer reads the optimum and the delegate
 * picks a setup before the first session, and after every session of setup running the reading
 * narrows, the driver says what the car did, and the setup is picked again.
 *
 * Nothing here touches the optimum except through `setup-knowledge.ts`: the readings are what the
 * teams have, and the truth stays where `idealSetup()` computes it.
 */
import type { Pack, Setup } from '@/data/schema/pack';
import {
  idealSetup,
  openParameters,
  setupConditions,
  type SetupCapability,
  withinAccess,
} from '../car/setup';
import { profileFromAttributes } from '../decide/decide';
import type { RaceInput } from '../race/types';
import { streams } from '../rng/rng';
import type { DriverId, SessionKind, SetupKnowledge, SetupNote, TeamId, World } from '../types/world';
import { decideSetup, type SetupGoal } from './setup-choice';
import { driverNotes, readSetup, refineSetup } from './setup-knowledge';

export type SetupWork = {
  /** What every car runs now. */
  setups: Record<DriverId, Setup>;
  /** What each team's engineers now make of the optimum, by car. */
  knowledge: Record<TeamId, Record<DriverId, SetupKnowledge>>;
  /** What each driver said about the car he has just run. */
  notes: Record<DriverId, SetupNote[]>;
};

/** What one car's crew can do with a setup: the engineer, the simulator and the driver. */
export function capabilityOf(world: World, teamId: TeamId, driverId: DriverId): SetupCapability {
  const team = world.teams[teamId]!;
  const engineer = team.staffIds
    .map((id) => world.staff[id]!)
    .find((s) => s.role === 'race-engineer' && s.assignedDriverId === driverId);
  return {
    engineerSkill: engineer?.attributes.skill ?? 0,
    simulatorLevel: team.facilities.simulator,
    feedback: world.drivers[driverId]?.attributes.feedback ?? 0,
  };
}

/**
 * Before the first session: the engineer reads where the optimum is and the car is set up on that
 * reading. Nobody has run here yet, so the reading is as wide as the crew's own quality allows.
 */
export function openSetups(world: World, pack: Pack, race: RaceInput, goal: SetupGoal = 'race'): SetupWork {
  return dialIn(world, pack, race, {}, {}, 'open', goal);
}

/**
 * After a session: the laps of setup work narrow each engineer's reading, the driver reports what
 * the car is still doing, and the setup is chosen again from the new reading.
 */
export function refineSetups(
  world: World,
  pack: Pack,
  race: RaceInput,
  setupLaps: Record<DriverId, number>,
  /** The session just run: every session reads the track afresh, so it draws its own numbers. */
  after: SessionKind,
  goal: SetupGoal = 'race',
): SetupWork {
  const known: Record<TeamId, Record<DriverId, SetupKnowledge>> = {};
  for (const [teamId, team] of Object.entries(world.knowledge))
    if (team.weekend?.round === race.round) known[teamId] = team.weekend.setup;
  return dialIn(world, pack, race, known, setupLaps, after, goal);
}

function dialIn(
  world: World,
  pack: Pack,
  race: RaceInput,
  known: Record<TeamId, Record<DriverId, SetupKnowledge>>,
  setupLaps: Record<DriverId, number>,
  phase: SessionKind | 'open',
  goal: SetupGoal,
): SetupWork {
  const track = pack.tracks.find((t) => t.id === race.track.id)!;
  const ideal = idealSetup(track, setupConditions(race.weather), world.hidden.tracks[track.id]?.setupOffset);
  const rng = streams(race.seed);
  // Every dial-in draws its own numbers: the same stream twice would read the track the same way
  // twice, and the recommendation would never move however long the car ran.
  const stream = (name: string) => rng(`race:${race.season}:r${race.round}:setup:${phase}:${name}`);

  const setups: Record<DriverId, Setup> = { ...(world.weekend?.setups ?? {}) };
  const knowledge: Record<TeamId, Record<DriverId, SetupKnowledge>> = {};
  const reported: Record<DriverId, SetupNote[]> = {};

  for (const entry of race.entries) {
    const { driverId, teamId } = entry;
    const team = world.teams[teamId]!;
    const capability = capabilityOf(world, teamId, driverId);
    const laps = setupLaps[driverId] ?? 0;
    const prior = known[teamId]?.[driverId];
    const behind = (prior?.laps ?? 0) + laps;

    const reading = prior
      ? refineSetup(prior.reading, ideal, capability, laps, race.raceDate, stream(`${driverId}:reading`))
      : readSetup(ideal, capability, race.raceDate, stream(`${driverId}:reading`), behind);

    const current = setups[driverId] ?? track.factorySetup;
    // What the driver felt in the session just run; before any running there is nothing to report.
    const notes =
      prior && laps > 0 ? driverNotes(current, ideal, capability, stream(`${driverId}:feedback`)) : [];
    const mate = team.drivers.race.find((id) => id !== driverId);

    const decision = decideSetup(
      {
        reading,
        factory: track.factorySetup,
        current,
        notes,
        teamMate: mate ? setups[mate] : undefined,
        capability,
      },
      profileFromAttributes(engineerAttributes(world, teamId, driverId)),
      {
        goal,
        risk: team.character.riskAppetite,
        issuedBy: teamId === world.career.playerTeamId ? 'player' : 'team-character',
      },
      stream(`${driverId}:choice`),
    );

    // The engineer decides either way — that keeps his stream stable (ADR 005) — but in manual
    // setup the player's own sliders are what the car runs.
    const manual =
      teamId === world.career.playerTeamId &&
      world.career.delegation.setup === 'manual' &&
      setups[driverId] !== undefined;
    setups[driverId] = manual
      ? setups[driverId]!
      : withinAccess(decision.choice.setup, track.factorySetup, openParameters(capability));
    knowledge[teamId] = { ...(knowledge[teamId] ?? {}), [driverId]: { reading, laps: behind } };
    reported[driverId] = notes;
  }
  return { setups, knowledge, notes: reported };
}

/** The engineer who dials this car in; without one, nobody does it well. */
function engineerAttributes(
  world: World,
  teamId: TeamId,
  driverId: DriverId,
): { skill: number; consistency: number } {
  const engineer = world.teams[teamId]!.staffIds.map((id) => world.staff[id]!).find(
    (s) => s.role === 'race-engineer' && s.assignedDriverId === driverId,
  );
  return engineer?.attributes ?? { skill: 0, consistency: 0 };
}
