import type { World } from '@/sim/types/world';
import { visibleTeamColour } from '@/ui/design/accent';

/** What the race screen needs to name and colour a car. */
export type RosterEntry = {
  driverId: string;
  name: string;
  /** Surname in capitals, the timing-screen convention ("HART" in plan 6.3). */
  short: string;
  teamId: string;
  teamName: string;
  /** The livery colour that stays visible on the dark interface. */
  colour: string;
  isPlayer: boolean;
};

export type Roster = ReadonlyMap<string, RosterEntry>;

export function surname(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts.length > 1 ? parts.slice(1).join(' ') : parts[0]!).toUpperCase();
}

export function buildRoster(world: World): Roster {
  const player = world.career.playerTeamId;
  const entries = Object.values(world.teams).flatMap((team) =>
    team.drivers.race.map((driverId): [string, RosterEntry] => {
      const name = world.drivers[driverId]?.name ?? driverId;
      return [
        driverId,
        {
          driverId,
          name,
          short: surname(name),
          teamId: team.id,
          teamName: team.shortName,
          colour: visibleTeamColour(team.colours),
          isPlayer: team.id === player,
        },
      ];
    }),
  );
  return new Map(entries);
}

export function rosterEntry(roster: Roster, driverId: string | null): RosterEntry | undefined {
  return driverId === null ? undefined : roster.get(driverId);
}
