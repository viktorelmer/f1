/**
 * The game's clock between races (plan 3.4, docs/systems/season.md). One tick is a day; "Continue"
 * runs it forward to the next thing that matters. The queue is computed, not stored: an event is
 * anything on the calendar that has not happened yet, so a new kind of event in M6–M9 is a new line
 * here and nothing else.
 */
import type { GameDate } from '../types/game-date';
import type { World } from '../types/world';

export type SeasonEvent =
  | { kind: 'preseason-test'; date: GameDate; trackId: string; days: number }
  | { kind: 'weekend'; date: GameDate; round: number; trackId: string; format: 'standard' | 'sprint' }
  | { kind: 'season-end'; date: GameDate };

/** Everything still to come, soonest first. */
export function upcoming(world: World): SeasonEvent[] {
  const events: SeasonEvent[] = [];
  const { preseasonTest, calendar } = world.season;
  if (preseasonTest.startDate >= world.date)
    events.push({
      kind: 'preseason-test',
      date: preseasonTest.startDate,
      trackId: preseasonTest.trackId,
      days: preseasonTest.days,
    });
  for (const weekend of calendar) {
    if (weekend.status === 'completed') continue;
    events.push({
      kind: 'weekend',
      date: weekend.raceDate,
      round: weekend.round,
      trackId: weekend.trackId,
      format: weekend.format,
    });
  }
  const last = calendar[calendar.length - 1];
  if (last && calendar.every((r) => r.status === 'completed'))
    events.push({ kind: 'season-end', date: last.raceDate });
  return events.sort((a, b) => a.date - b.date);
}

/** The next thing on the clock, or null when the season is over and nothing is left. */
export function nextEvent(world: World): SeasonEvent | null {
  return upcoming(world)[0] ?? null;
}

/** Moves the clock to a day, never backwards. */
export function advanceTo(world: World, date: GameDate): World {
  return date <= world.date ? world : { ...world, date };
}

/** "Continue": to the day of the next event, leaving the event itself to be run. */
export function advanceToNextEvent(world: World): World {
  const next = nextEvent(world);
  return next ? advanceTo(world, next.date) : world;
}
