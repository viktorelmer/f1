import { useTranslation } from 'react-i18next';
import { useCareer } from '@/app/store/career';
import { pendingRound, useSeason } from '@/app/store/season';
import { formatGameDate, formatLapTime } from '@/i18n/format';
import { nextEvent } from '@/sim/season/events';
import type { RaceWeekend, SessionKind, SessionResult } from '@/sim/types/world';
import { Button } from '@/ui/design/Button';
import { Panel } from '@/ui/design/Panel';
import { ScreenRegion } from '../ScreenRegion';
import { Table } from '@/ui/design/Table';

/**
 * Уик-энд → Расписание (plan 6.2): where the season stands. The round that is next, what its
 * sessions are, and the button that runs it. A round already run shows what happened in each session.
 */
export function WeekendScheduleScreen() {
  const { t, i18n } = useTranslation();
  const world = useCareer((s) => s.world);
  const pack = useCareer((s) => s.pack);
  const { busy, error, runNextWeekend, advance } = useSeason();

  const round = pendingRound(world);
  const next = world.season.calendar.find((r) => r.round === round);
  const last = [...world.season.calendar].reverse().find((r) => r.status === 'completed');
  // The weekend just run is the one worth reading; before the first one, the one that is coming.
  const shown = last ?? next;
  const event = nextEvent(world);
  const trackName = (id: string) => pack.tracks.find((t) => t.id === id)?.name ?? id;

  return (
    <ScreenRegion section="weekend" tab="schedule">
      <div className="flex flex-col gap-4 p-4">
        <Panel title={t('season.schedule.title')} className="max-w-3xl">
          <div className="flex flex-col gap-3 p-3">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
              <Field label={t('season.schedule.date')} value={formatGameDate(world.date, i18n.language)} />
              <Field
                label={t('season.schedule.next')}
                value={
                  event === null
                    ? t('season.schedule.seasonOver')
                    : event.kind === 'weekend'
                      ? t('season.schedule.round', { round: event.round, track: trackName(event.trackId) })
                      : t(`season.event.${event.kind}`)
                }
              />
              <Field
                label={t('season.schedule.done')}
                value={`${world.season.calendar.filter((r) => r.status === 'completed').length} / ${world.season.calendar.length}`}
              />
            </dl>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                disabled={busy || round === null}
                onClick={() => void runNextWeekend()}
              >
                {busy ? t('season.schedule.running') : t('season.schedule.run')}
              </Button>
              <Button variant="ghost" disabled={busy || event === null} onClick={advance}>
                {t('season.schedule.advance')}
              </Button>
            </div>
            {error !== null && (
              <p role="alert" className="text-sm text-caution">
                {error}
              </p>
            )}
          </div>
        </Panel>

        {shown && <WeekendPanel weekend={shown} trackName={trackName(shown.trackId)} />}
      </div>
    </ScreenRegion>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-2xs text-lo">{label}</dt>
      <dd className="text-hi">{value}</dd>
    </div>
  );
}

const SESSION_ORDER: readonly SessionKind[] = [
  'fp1',
  'fp2',
  'fp3',
  'sprint-qualifying',
  'sprint',
  'qualifying',
  'race',
];

function WeekendPanel({ weekend, trackName }: { weekend: RaceWeekend; trackName: string }) {
  const { t } = useTranslation();
  const world = useCareer((s) => s.world);
  const mine = new Set(world.teams[world.career.playerTeamId]?.drivers.race ?? []);
  const sessions = [...weekend.sessions].sort(
    (a, b) => SESSION_ORDER.indexOf(a.session) - SESSION_ORDER.indexOf(b.session),
  );

  return (
    <Panel
      title={t('season.schedule.round', { round: weekend.round, track: trackName })}
      className="max-w-3xl"
    >
      {sessions.length === 0 ? (
        <p className="p-3 text-sm text-lo">{t('season.schedule.notRunYet')}</p>
      ) : (
        <div className="flex flex-col gap-4 p-3">
          {sessions.map((session) => (
            <SessionPanel key={session.session} session={session} mine={mine} />
          ))}
        </div>
      )}
    </Panel>
  );
}

function SessionPanel({ session, mine }: { session: SessionResult; mine: ReadonlySet<string> }) {
  const { t } = useTranslation();
  const world = useCareer((s) => s.world);
  const name = (id: string) => world.drivers[id]?.name ?? id;
  const top = session.classification.slice(0, 5);
  const ours = session.classification.filter((c) => mine.has(c.driverId) && !top.includes(c));

  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-xs font-semibold text-lo uppercase">{t(`season.session.${session.session}`)}</h3>
      <Table
        caption={undefined}
        rows={[...top, ...ours]}
        rowKey={(row) => row.driverId}
        columns={[
          {
            key: 'pos',
            header: t('season.table.position'),
            numeric: true,
            width: '3rem',
            cell: (r) => r.position,
          },
          {
            key: 'driver',
            header: t('season.table.driver'),
            cell: (r) => (
              <span className={mine.has(r.driverId) ? 'font-semibold text-hi' : undefined}>
                {name(r.driverId)}
              </span>
            ),
          },
          {
            key: 'best',
            header: t('season.table.bestLap'),
            numeric: true,
            cell: (r) => (r.bestLapS === null ? '—' : formatLapTime(r.bestLapS)),
          },
          {
            key: 'points',
            header: t('season.table.points'),
            numeric: true,
            width: '4rem',
            cell: (r) => (r.points > 0 ? r.points : ''),
          },
        ]}
      />
    </section>
  );
}
