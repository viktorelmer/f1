import { useTranslation } from 'react-i18next';
import { useCareer } from '@/app/store/career';
import { formatGameDate } from '@/i18n/format';
import type { RaceWeekend } from '@/sim/types/world';
import { Panel } from '@/ui/design/Panel';
import { ScreenRegion } from '../ScreenRegion';
import { Table } from '@/ui/design/Table';

/** Чемпионат → Календарь (plan 6.2): the season's rounds, their format, and who won the ones run. */
export function CalendarScreen() {
  const { t, i18n } = useTranslation();
  const world = useCareer((s) => s.world);
  const pack = useCareer((s) => s.pack);
  const trackName = (id: string) => pack.tracks.find((track) => track.id === id)?.name ?? id;

  const winnerOf = (weekend: RaceWeekend) => {
    const race = weekend.sessions.find((s) => s.session === 'race');
    const first = race?.classification.find((c) => c.position === 1);
    return first ? (world.drivers[first.driverId]?.name ?? first.driverId) : t('season.calendar.upcoming');
  };

  return (
    <ScreenRegion section="championship" tab="calendar">
      <div className="p-4">
        <Panel title={t('season.calendar.season', { year: world.season.year })} className="max-w-3xl">
          <Table
            rows={world.season.calendar}
            rowKey={(row) => row.round}
            columns={[
              {
                key: 'round',
                header: t('season.table.round'),
                numeric: true,
                width: '3.5rem',
                cell: (r) => r.round,
              },
              {
                key: 'date',
                header: t('season.schedule.date'),
                cell: (r) => formatGameDate(r.raceDate, i18n.language),
              },
              { key: 'track', header: t('season.table.track'), cell: (r) => trackName(r.trackId) },
              {
                key: 'format',
                header: t('season.table.format'),
                cell: (r) =>
                  r.format === 'sprint'
                    ? t('season.calendar.formatSprint')
                    : t('season.calendar.formatStandard'),
              },
              {
                key: 'winner',
                header: t('season.table.winner'),
                cell: (r) => (
                  <span className={r.status === 'completed' ? 'text-hi' : 'text-lo'}>{winnerOf(r)}</span>
                ),
              },
            ]}
          />
        </Panel>
      </div>
    </ScreenRegion>
  );
}
