import { formatGap } from '@/i18n/format';
import type { CarFrame } from '@/sim/race/replay';
import type { RaceEvent, ScheduledStint } from '@/sim/race/types';

// View models for the race screen: plain functions from sim output to what the widgets show.

export type BoardRow = {
  driverId: string;
  position: number;
  status: CarFrame['status'];
  gap: string;
  interval: string;
  compound: CarFrame['compound'];
  tyreAge: number;
  stops: number;
};

/** Board rows for a frame: what each row shows, as text, so the board redraws only when it changes. */
export function boardRows(
  cars: readonly CarFrame[],
  language: string,
  t: (key: 'race.board.leader' | 'race.board.pit' | 'race.board.out' | 'race.board.finished') => string,
  lapsDown: (n: number) => string,
): BoardRow[] {
  return cars.map((car) => {
    const gap =
      car.status === 'retired'
        ? t('race.board.out')
        : car.position === 1
          ? car.status === 'finished'
            ? t('race.board.finished')
            : t('race.board.leader')
          : car.lapsDown > 0
            ? lapsDown(car.lapsDown)
            : car.gapS === null
              ? ''
              : formatGap(car.gapS, language);
    const interval =
      car.status === 'pit'
        ? t('race.board.pit')
        : car.status === 'retired' || car.intervalS === null
          ? ''
          : formatGap(car.intervalS, language);
    return {
      driverId: car.driverId,
      position: car.position,
      status: car.status,
      gap,
      interval,
      compound: car.compound,
      tyreAge: car.tyreAge,
      stops: car.stops,
    };
  });
}

export const boardSignature = (rows: readonly BoardRow[]) =>
  rows
    .map((r) => `${r.driverId}:${r.status}:${r.gap}:${r.interval}:${r.compound}${r.tyreAge}:${r.stops}`)
    .join('|');

export type Band = { from: number; to: number; kind: 'sc' | 'vsc' };

/** Laps under the safety car or VSC, from the race's events. */
export function neutralisedBands(events: readonly RaceEvent[], lastLap: number): Band[] {
  const bands: Band[] = [];
  let open: Band | null = null;
  for (const e of events) {
    if ((e.kind === 'safety-car' || e.kind === 'vsc') && !open)
      open = { from: e.lap, to: lastLap, kind: e.kind === 'vsc' ? 'vsc' : 'sc' };
    else if ((e.kind === 'safety-car-in' || e.kind === 'vsc-end') && open) {
      bands.push({ ...open, to: e.lap });
      open = null;
    }
  }
  if (open) bands.push(open);
  return bands;
}

/** The lap at whose end the plan calls the next stop; null when no stop is left. */
export function nextPlannedStop(plan: readonly ScheduledStint[], lapsDone: number): number | null {
  const current = plan.findIndex((st) => st.toLap > lapsDone);
  return current >= 0 && current < plan.length - 1 ? plan[current]!.toLap : null;
}
