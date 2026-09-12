import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useCareer } from '@/app/store/career';
import { pendingRound, useSeason } from '@/app/store/season';
import { pendingStage, useWeekend } from '@/app/store/weekend';
import { formatGameDate, formatLapTime } from '@/i18n/format';
import { nextEvent } from '@/sim/season/events';
import { WEEKEND_SESSIONS } from '@/sim/season/weekend';
import type { RaceWeekend, SessionKind, SessionResult } from '@/sim/types/world';
import { Button } from '@/ui/design/Button';
import { Panel } from '@/ui/design/Panel';
import { Table } from '@/ui/design/Table';
import { ScreenRegion } from '../ScreenRegion';

/**
 * Уик-энд → Расписание (plan 6.2, docs/systems/weekend-play.md): the hub of the weekend. Where the
 * season stands, which session the round is waiting on, and the three ways into it — walk in, have
 * it run, or have the rest of the weekend run.
 */
export function WeekendScheduleScreen() {
  const { t, i18n } = useTranslation();
  const world = useCareer((s) => s.world);
  const pack = useCareer((s) => s.pack);
  const { advance } = useSeason();
  const { busy, error, open, simulateSession, simulateRest } = useWeekend();

  const round = world.weekend?.round ?? pendingRound(world);
  // The weekend ahead is the one to plan; the one just run is the one to read.
  const weekend = world.season.calendar.find((r) => r.round === round);
  const last = [...world.season.calendar].reverse().find((r) => r.status === 'completed');
  const read = last ?? weekend;
  const event = nextEvent(world);
  const trackName = (id: string) => pack.tracks.find((tr) => tr.id === id)?.name ?? id;
  const isOpen = world.weekend !== null;

  return (
    <ScreenRegion section="weekend" tab="schedule">
      <div className="flex flex-col gap-4 p-4">
        <Panel title={t('season.schedule.title')} className="max-w-3xl">
          <div className="flex flex-col gap-3">
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
              {!isOpen && (
                <Button variant="primary" disabled={busy || round === null} onClick={() => void open()}>
                  {busy ? t('season.schedule.working') : t('season.schedule.open')}
                </Button>
              )}
              <Button
                variant={isOpen ? 'primary' : 'secondary'}
                disabled={busy || round === null}
                onClick={() => void runWholeWeekend()}
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

        {weekend && (
          <SessionList
            weekend={weekend}
            trackName={trackName(weekend.trackId)}
            stage={world.weekend?.round === weekend.round ? pendingStage(world) : null}
            busy={busy}
            onSimulate={() => void simulateSession()}
          />
        )}
        {read && <WeekendResults weekend={read} trackName={trackName(read.trackId)} />}
      </div>
    </ScreenRegion>
  );

  /** The weekend without watching any of it: opened if it is not, then run to the flag. */
  async function runWholeWeekend() {
    if (!isOpen) await open();
    await simulateRest();
  }
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-2xs text-lo">{label}</dt>
      <dd className="text-hi">{value}</dd>
    </div>
  );
}

type Row = { session: SessionKind; status: 'done' | 'now' | 'ahead'; result: SessionResult | undefined };

/** The weekend session by session: what has run, what is waiting, and the way into it. */
function SessionList({
  weekend,
  trackName,
  stage,
  busy,
  onSimulate,
}: {
  weekend: RaceWeekend;
  trackName: string;
  stage: SessionKind | null;
  busy: boolean;
  onSimulate: () => void;
}) {
  const { t } = useTranslation();
  const world = useCareer((s) => s.world);
  const mine = new Set(world.teams[world.career.playerTeamId]?.drivers.race ?? []);
  const order = WEEKEND_SESSIONS[weekend.format];
  const rows: Row[] = order.map((session) => {
    const result = weekend.sessions.find((s) => s.session === session);
    return {
      session,
      status: result ? 'done' : session === stage ? 'now' : 'ahead',
      result,
    };
  });

  return (
    <Panel
      title={t('season.schedule.round', { round: weekend.round, track: trackName })}
      className="max-w-3xl"
      flush
    >
      <Table
        rows={rows}
        rowKey={(row) => row.session}
        columns={[
          {
            key: 'session',
            header: t('season.schedule.session'),
            cell: (row) => (
              <span className={row.status === 'now' ? 'font-semibold text-hi' : undefined}>
                {t(`season.session.${row.session}`)}
              </span>
            ),
          },
          {
            key: 'status',
            header: t('season.schedule.statusColumn'),
            width: '7rem',
            cell: (row) => <span className="text-lo">{t(`season.schedule.status.${row.status}`)}</span>,
          },
          {
            key: 'result',
            header: t('season.schedule.result'),
            cell: (row) => <Outcome result={row.result} mine={mine} />,
          },
          {
            key: 'go',
            header: '',
            align: 'right',
            width: '12rem',
            cell: (row) =>
              row.status === 'now' && (
                <span className="flex justify-end gap-1.5">
                  <Button size="sm" variant="ghost" disabled={busy} onClick={onSimulate}>
                    {t('season.schedule.simulateSession')}
                  </Button>
                  <Link to="/weekend/race">
                    <Button size="sm" variant="primary" disabled={busy}>
                      {t('season.schedule.enter')}
                    </Button>
                  </Link>
                </span>
              ),
          },
        ]}
      />
    </Panel>
  );
}

/** A line about a session that has run: who won it, and where the player's cars came. */
function Outcome({ result, mine }: { result: SessionResult | undefined; mine: ReadonlySet<string> }) {
  const { t } = useTranslation();
  const world = useCareer((s) => s.world);
  if (!result) return <span className="text-lo">—</span>;
  const first = result.classification[0];
  const ours = result.classification.filter((c) => mine.has(c.driverId));
  const name = (id: string) => world.drivers[id]?.name ?? id;

  return (
    <span className="text-lo">
      {first ? `1. ${name(first.driverId)}` : '—'}
      {ours.length > 0 && (
        <span className="ml-2 text-hi">
          {t('season.schedule.mine', { positions: ours.map((c) => `P${c.position}`).join(', ') })}
        </span>
      )}
    </span>
  );
}

function WeekendResults({ weekend, trackName }: { weekend: RaceWeekend; trackName: string }) {
  const { t } = useTranslation();
  const world = useCareer((s) => s.world);
  const mine = new Set(world.teams[world.career.playerTeamId]?.drivers.race ?? []);
  const order = WEEKEND_SESSIONS[weekend.format];
  const sessions = [...weekend.sessions].sort((a, b) => order.indexOf(a.session) - order.indexOf(b.session));

  return (
    <Panel
      title={t('season.schedule.results', { round: weekend.round, track: trackName })}
      className="max-w-3xl"
    >
      {sessions.length === 0 ? (
        <p className="text-sm text-lo">{t('season.schedule.notRunYet')}</p>
      ) : (
        <div className="flex flex-col gap-4">
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
