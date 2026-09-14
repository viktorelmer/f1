/**
 * The season on screen (docs/systems/season.md): where the clock stands and what the next event is.
 * The world itself lives in the career slice, and a weekend in the weekend slice — this one only
 * moves the calendar's clock and says which round is waiting.
 */
import { create } from 'zustand';
import { advanceTo } from '@/sim/season/advance';
import { nextEvent, type SeasonEvent, upcoming } from '@/sim/season/events';
import type { World } from '@/sim/types/world';
import { useCareer } from './career';

export type SeasonStore = {
  /** "Continue": the clock to the day of the next event. */
  advance: () => void;
};

/** The round the season is waiting on, or null when the calendar is done. */
export function pendingRound(world: World): number | null {
  const event = upcoming(world).find(
    (e): e is Extract<SeasonEvent, { kind: 'weekend' }> => e.kind === 'weekend',
  );
  return event ? event.round : null;
}

export const useSeason = create<SeasonStore>()(() => ({
  advance: () => {
    const { world, pack } = useCareer.getState();
    const next = nextEvent(world);
    // The clock does not move alone: the factory works through those weeks (car-development.md).
    if (next && next.date > world.date) useCareer.setState({ world: advanceTo(world, pack, next.date) });
  },
}));
