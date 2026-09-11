import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatGap, formatRaceTime } from '@/i18n/format';
import type { ClassifiedCar } from '@/sim/race/types';
import { type Column, Table } from '@/ui/design/Table';
import type { Roster } from './roster';

const REASONS = [
  'crash',
  'collision',
  'puncture',
  'debris',
  'power-unit failure',
  'chassis failure',
] as const;

/** The final classification, once the flag has fallen. */
export const RaceResults = memo(function RaceResults({
  classification,
  roster,
}: {
  classification: readonly ClassifiedCar[];
  roster: Roster;
}) {
  const { t, i18n } = useTranslation();
  const columns: Column<ClassifiedCar>[] = [
    { key: 'pos', header: '#', cell: (c) => c.position, numeric: true, width: '2.5rem' },
    {
      key: 'driver',
      header: t('race.board.driver'),
      cell: (c) => {
        const who = roster.get(c.driverId);
        return (
          <span className="flex items-center gap-2">
            <span aria-hidden className="h-3.5 w-1 rounded-sm" style={{ background: who?.colour }} />
            <span className={who?.isPlayer ? 'font-semibold' : undefined}>{who?.short ?? c.driverId}</span>
            <span className="text-lo">{who?.teamName}</span>
          </span>
        );
      },
    },
    {
      key: 'gap',
      header: t('race.results.gap'),
      numeric: true,
      cell: (c) =>
        c.status === 'retired'
          ? t('race.results.dnf', {
              reason: (REASONS as readonly string[]).includes(c.retireReason ?? '')
                ? t(`race.reason.${c.retireReason as (typeof REASONS)[number]}`)
                : (c.retireReason ?? ''),
            })
          : c.position === 1
            ? formatRaceTime(c.totalTimeS)
            : c.gapS !== null
              ? formatGap(c.gapS, i18n.language)
              : t('race.board.lapsDown', { count: c.lapsDown }),
    },
    { key: 'stops', header: t('race.board.stops'), cell: (c) => c.stops, numeric: true, width: '3rem' },
    {
      key: 'points',
      header: t('race.results.points'),
      cell: (c) => c.points || '',
      numeric: true,
      width: '3rem',
    },
  ];
  return (
    <Table
      caption={t('race.results.title')}
      columns={columns}
      rows={classification}
      rowKey={(c) => c.driverId}
    />
  );
});
