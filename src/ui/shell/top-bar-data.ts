import type { Pack } from '@/data/schema/pack';
import { type GameDate, daysBetween } from '@/sim/types/game-date';
import type { World } from '@/sim/types/world';

export type TopBarData = {
  date: GameDate;
  /** The next thing on the calendar: the pre-season test, then each race in turn. */
  nextEvent: { kind: 'test' | 'race'; round: number; track: string; daysAway: number } | null;
  cashM: number;
  /** Null until anyone has scored: a championship position before the first race means nothing. */
  constructorsPosition: number | null;
};

/** What the top bar shows for the player's team in this world. */
export function topBarData(world: World, pack: Pack): TopBarData {
  const trackName = (id: string) => pack.tracks.find((t) => t.id === id)?.name ?? id;
  const { preseasonTest, calendar, standings } = world.season;
  const nextRace = calendar.find((r) => r.status === 'upcoming');
  const nextEvent =
    world.date <= preseasonTest.startDate
      ? {
          kind: 'test' as const,
          round: 0,
          track: trackName(preseasonTest.trackId),
          daysAway: daysBetween(world.date, preseasonTest.startDate),
        }
      : nextRace
        ? {
            kind: 'race' as const,
            round: nextRace.round,
            track: trackName(nextRace.trackId),
            daysAway: daysBetween(world.date, nextRace.raceDate),
          }
        : null;

  const player = world.career.playerTeamId;
  const points = standings.constructors;
  const scored = Object.values(points).some((p) => p > 0);
  const constructorsPosition = scored
    ? 1 + Object.entries(points).filter(([id, p]) => id !== player && p > (points[player] ?? 0)).length
    : null;

  return {
    date: world.date,
    nextEvent,
    cashM: world.teams[player]?.finances.cashM ?? 0,
    constructorsPosition,
  };
}
