import { motion } from 'motion/react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/ui/design/cn';
import { CompoundBadge } from './CompoundBadge';
import type { Roster } from './roster';
import type { BoardRow } from './view-model';

const GRID = 'grid grid-cols-[1.75rem_minmax(0,1fr)_4.5rem_4rem_2.75rem_1.25rem] items-center gap-x-1.5 px-2';

export const TimingBoard = memo(function TimingBoard({
  rows,
  roster,
}: {
  rows: readonly BoardRow[];
  roster: Roster;
}) {
  const { t } = useTranslation();
  return (
    <div role="table" aria-label={t('race.board.title')} className="flex min-h-0 flex-col text-sm">
      <div role="rowgroup">
        <div role="row" className={cn(GRID, 'h-row border-b border-line text-xs text-lo')}>
          <span role="columnheader" className="text-right">
            {t('race.board.position')}
          </span>
          <span role="columnheader">{t('race.board.driver')}</span>
          <span role="columnheader" className="text-right">
            {t('race.board.gap')}
          </span>
          <span role="columnheader" className="text-right">
            {t('race.board.interval')}
          </span>
          <span role="columnheader">{t('race.board.tyre')}</span>
          <span role="columnheader" className="text-right">
            {t('race.board.stops')}
          </span>
        </div>
      </div>
      <div role="rowgroup">
        {rows.map((row) => {
          const who = roster.get(row.driverId);
          const out = row.status === 'retired';
          return (
            <motion.div
              key={row.driverId}
              layout="position"
              transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
              role="row"
              aria-current={who?.isPlayer ? 'true' : undefined}
              className={cn(
                GRID,
                'h-row border-b border-line/50',
                who?.isPlayer && 'bg-raised',
                out && 'text-lo',
              )}
            >
              <span role="cell" className="text-right font-mono tabular-nums">
                {row.position}
              </span>
              <span role="cell" className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className="h-4 w-1 shrink-0 rounded-sm"
                  style={{ background: who?.colour }}
                />
                <span className={cn('truncate', who?.isPlayer && 'font-semibold text-hi')}>
                  {who?.short ?? row.driverId}
                </span>
              </span>
              <span role="cell" className="text-right font-mono tabular-nums">
                {row.gap}
              </span>
              <span
                role="cell"
                className={cn(
                  'text-right font-mono tabular-nums',
                  row.status === 'pit' && 'bg-accent px-1 text-accent-fg',
                )}
              >
                {row.interval}
              </span>
              <span role="cell" className="flex items-center gap-1.5">
                {!out && <CompoundBadge compound={row.compound} />}
                {!out && <span className="font-mono text-xs text-lo tabular-nums">{row.tyreAge}</span>}
              </span>
              <span role="cell" className="text-right font-mono tabular-nums">
                {row.stops}
              </span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
});
