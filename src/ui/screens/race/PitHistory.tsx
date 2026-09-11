import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Compound, RaceEvent } from '@/sim/race/types';
import { type Column, Table } from '@/ui/design/Table';
import { CompoundBadge } from './CompoundBadge';
import type { Roster } from './roster';

type PitRow = {
  key: string;
  lap: number;
  driverId: string;
  from: Compound;
  to: Compound;
  stationaryS: number;
  slow: boolean;
};

/** Every stop so far: lap, driver, tyre change and stationary time, slow stops marked. */
export const PitHistory = memo(function PitHistory({
  events,
  roster,
}: {
  events: readonly RaceEvent[];
  roster: Roster;
}) {
  const { t } = useTranslation();
  const rows: PitRow[] = events
    .filter((e) => e.kind === 'pit')
    .map((e, i) => ({
      key: `${i}`,
      lap: e.lap,
      driverId: e.driverId ?? '',
      from: e.detail.from as Compound,
      to: e.detail.to as Compound,
      stationaryS: Number(e.detail.stationaryS),
      slow: e.detail.slow === 1,
    }))
    .reverse();
  if (rows.length === 0) return <p className="p-3 text-sm text-lo">{t('race.pits.empty')}</p>;

  const columns: Column<PitRow>[] = [
    { key: 'lap', header: t('race.pits.lap'), cell: (r) => r.lap, numeric: true, width: '3rem' },
    {
      key: 'driver',
      header: t('race.pits.driver'),
      cell: (r) => {
        const who = roster.get(r.driverId);
        return (
          <span className="flex items-center gap-2">
            <span aria-hidden className="h-3.5 w-1 rounded-sm" style={{ background: who?.colour }} />
            <span className={who?.isPlayer ? 'font-semibold' : undefined}>{who?.short ?? r.driverId}</span>
          </span>
        );
      },
    },
    {
      key: 'change',
      header: t('race.pits.change'),
      cell: (r) => (
        <span className="inline-flex items-center gap-1">
          <CompoundBadge compound={r.from} />→<CompoundBadge compound={r.to} />
        </span>
      ),
    },
    {
      key: 'stationary',
      header: t('race.pits.stationary'),
      numeric: true,
      cell: (r) => (
        <span className={r.slow ? 'text-negative' : undefined}>
          {r.stationaryS.toFixed(1)} s{r.slow ? ` · ${t('race.pits.slow')}` : ''}
        </span>
      ),
    },
  ];
  return <Table columns={columns} rows={rows} rowKey={(r) => r.key} />;
});
