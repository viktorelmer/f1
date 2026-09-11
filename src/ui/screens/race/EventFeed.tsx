import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { RaceEvent } from '@/sim/race/types';
import { cn } from '@/ui/design/cn';
import { describeEvent } from './describe-event';
import type { Roster } from './roster';

const LOUD = new Set<RaceEvent['kind']>([
  'safety-car',
  'vsc',
  'crash',
  'retirement',
  'chequered-flag',
  'rain-start',
]);
/** Background colour of a race: shown, but not competing with passes, stops and incidents. */
const QUIET = new Set<RaceEvent['kind']>(['defence']);

/** The race feed: every event that has happened, newest first. */
export const EventFeed = memo(function EventFeed({
  events,
  roster,
}: {
  events: readonly RaceEvent[];
  roster: Roster;
}) {
  const { t } = useTranslation();
  if (events.length === 0) return <p className="p-3 text-sm text-lo">{t('race.feed.empty')}</p>;
  const newestFirst = [...events].reverse();
  return (
    <ol role="log" aria-label={t('race.tabs.events')} className="flex flex-col text-sm">
      {newestFirst.map((event, i) => {
        const mine = roster.get(event.driverId ?? '')?.isPlayer || roster.get(event.otherId ?? '')?.isPlayer;
        return (
          <li
            key={`${events.length - i}`}
            className={cn('flex gap-3 border-b border-line/50 px-3 py-1', mine && 'bg-raised')}
          >
            <span className="w-8 shrink-0 font-mono text-xs text-lo tabular-nums">
              {t('race.feed.lap', { lap: event.lap })}
            </span>
            <span
              className={cn(
                LOUD.has(event.kind)
                  ? 'font-semibold text-hi'
                  : QUIET.has(event.kind)
                    ? 'text-lo'
                    : 'text-hi/90',
              )}
            >
              {describeEvent(event, roster, t)}
            </span>
          </li>
        );
      })}
    </ol>
  );
});
