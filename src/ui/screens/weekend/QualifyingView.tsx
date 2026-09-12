import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useCareer } from '@/app/store/career';
import { useWeekend } from '@/app/store/weekend';
import { formatGap, formatLapTime } from '@/i18n/format';
import type { DriverId } from '@/sim/types/world';
import {
  type QualifyingCarFrame,
  type QualifyingFrame,
  qualifyingFrameAt,
  type QualifyingReplay,
} from '@/sim/weekend/qualifying-replay';
import { Button } from '@/ui/design/Button';
import { cn } from '@/ui/design/cn';
import { Panel } from '@/ui/design/Panel';
import { buildRoster, type Roster } from '../race/roster';
import { usePlaybackClock } from '../race/use-playback-clock';
import { useStable } from '../race/use-stable';
import { SessionHeader } from './SessionHeader';
import { mmss } from './session-view-model';
import { SessionMap } from './SessionMap';

/**
 * Qualifying as three parts on a clock (docs/systems/weekend-play.md): the board with its drop
 * zone, the cars on their laps, and the one decision that is the player's — when to go out.
 */
export function QualifyingView({ replay }: { replay: QualifyingReplay }) {
  const { t, i18n } = useTranslation();
  const world = useCareer((s) => s.world);
  const pack = useCareer((s) => s.pack);
  const { timeS, paused, tick } = useWeekend();
  const roster = useMemo(() => buildRoster(world), [world]);
  const frame = useMemo(() => qualifyingFrameAt(replay, timeS), [replay, timeS]);
  usePlaybackClock(!paused && !frame.finished, tick);

  const round = world.season.calendar.find((r) => r.round === world.weekend?.round);
  const track = pack.tracks.find((tr) => tr.id === round?.trackId);
  const geometry = pack.geometry.find((g) => g.trackId === round?.trackId);

  const session = replay.result.session.session;
  const cars = useStable(
    frame.cars,
    frame.cars.map((c) => `${c.driverId}:${c.position}:${c.timeS ?? ''}:${c.state}`).join('|'),
  );
  const laps = useStable(frame.laps, String(frame.laps.length));
  const onTrack = frame.cars.filter(
    (c): c is QualifyingCarFrame & { lapProgress: number } => c.lapProgress !== null,
  );
  const mine = world.teams[world.career.playerTeamId]?.drivers.race ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SessionHeader
        title={t(`season.session.${session}`)}
        status={
          frame.finished
            ? t('weekend.clock.ended')
            : `${t('weekend.qualifying.part', { part: frame.part + 1 })} · ${mmss(frame.partRemainingS)}`
        }
        timeS={frame.timeS}
        durationS={frame.durationS}
        finished={frame.finished}
      />
      <div className="grid min-h-0 flex-1 grid-cols-[27rem_minmax(0,1fr)_20rem]">
        <div className="min-h-0 overflow-y-auto border-r border-line bg-panel">
          <QualifyingBoard cars={cars} roster={roster} language={i18n.language} finished={frame.finished} />
        </div>
        <div className="flex min-h-0 flex-col">
          <div className="min-h-0 flex-1 p-2">
            {track && geometry && (
              <SessionMap track={track} geometry={geometry} cars={onTrack} roster={roster} />
            )}
          </div>
          <div className="h-56 shrink-0 overflow-y-auto border-t border-line bg-panel">
            <LapFeed laps={laps} roster={roster} />
          </div>
        </div>
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto border-l border-line bg-panel p-3">
          {mine.map((driverId) => (
            <CarPanel
              key={driverId}
              driverId={driverId}
              car={frame.cars.find((c) => c.driverId === driverId)}
              finished={frame.finished}
              partOver={frame.partRemainingS <= 0}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const QualifyingBoard = memo(function QualifyingBoard({
  cars,
  roster,
  language,
  finished,
}: {
  cars: readonly QualifyingCarFrame[];
  roster: Roster;
  language: string;
  /** At the flag every car is simply done: the state it was in no longer says anything. */
  finished: boolean;
}) {
  const { t } = useTranslation();
  const grid =
    'grid grid-cols-[1.75rem_minmax(0,1fr)_4.5rem_3.5rem_7.5rem] items-center gap-x-1.5 px-2 whitespace-nowrap';

  return (
    <div role="table" aria-label={t('weekend.qualifying.board')} className="flex min-h-0 flex-col text-sm">
      <div role="row" className={cn(grid, 'h-row border-b border-line text-xs text-lo')}>
        <span role="columnheader" className="text-right">
          {t('race.board.position')}
        </span>
        <span role="columnheader">{t('race.board.driver')}</span>
        <span role="columnheader" className="text-right">
          {t('weekend.qualifying.time')}
        </span>
        <span role="columnheader" className="text-right">
          {t('race.board.gap')}
        </span>
        <span role="columnheader">{t('weekend.practice.state')}</span>
      </div>
      {cars.map((car) => {
        const entry = roster.get(car.driverId);
        return (
          <div
            key={car.driverId}
            role="row"
            className={cn(
              grid,
              'h-row border-b border-line/60',
              entry?.isPlayer && 'bg-raised',
              car.knockedOut && 'opacity-50',
              car.inDropZone && 'border-l-2 border-l-negative',
            )}
          >
            <span role="cell" className="text-right font-mono text-xs text-lo">
              {car.position}
            </span>
            <span role="cell" className="flex min-w-0 items-center gap-1.5">
              <span className="h-3 w-0.5 shrink-0" style={{ background: entry?.colour }} />
              <span className={cn('truncate', entry?.isPlayer ? 'font-semibold text-hi' : 'text-lo')}>
                {entry?.short ?? car.driverId}
              </span>
            </span>
            <span role="cell" className="text-right font-mono text-xs">
              {car.timeS === null ? t('weekend.qualifying.noTime') : formatLapTime(car.timeS)}
            </span>
            <span role="cell" className="text-right font-mono text-xs text-lo">
              {car.gapS === null || car.gapS === 0 ? '' : formatGap(car.gapS, language)}
            </span>
            <span role="cell" className="text-xs text-lo">
              {finished ? t('weekend.practice.carState.done') : t(`weekend.qualifying.carState.${car.state}`)}
              {!finished && car.inDropZone && !car.knockedOut && (
                <span className="ml-1 text-negative">· {t('weekend.qualifying.dropZone')}</span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
});

const LapFeed = memo(function LapFeed({ laps, roster }: { laps: QualifyingFrame['laps']; roster: Roster }) {
  const { t } = useTranslation();
  const shown = [...laps].slice(-30).reverse();

  return (
    <Panel title={t('weekend.qualifying.feed')} flush>
      {shown.length === 0 ? (
        <p className="p-3 text-sm text-lo">{t('weekend.qualifying.noLaps')}</p>
      ) : (
        <ul className="divide-y divide-line/60">
          {shown.map((lap, i) => (
            <li
              key={`${lap.driverId}-${lap.part}-${i}`}
              className="flex items-center gap-3 px-3 py-1 text-sm whitespace-nowrap"
            >
              <span className="font-mono text-2xs text-lo">
                {t('weekend.qualifying.part', { part: lap.part + 1 })}
              </span>
              <span className={cn('w-36 truncate', roster.get(lap.driverId)?.isPlayer && 'text-hi')}>
                {roster.get(lap.driverId)?.name ?? lap.driverId}
              </span>
              {lap.trafficS > 0.05 && (
                <span className="text-2xs text-caution">
                  {t('weekend.qualifying.traffic', { s: lap.trafficS.toFixed(1) })}
                </span>
              )}
              <span className="ml-auto font-mono">{formatLapTime(lap.timeS)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
});

/** One of the player's cars: what it is doing, and the word that sends it out. */
function CarPanel({
  driverId,
  car,
  finished,
  partOver,
}: {
  driverId: DriverId;
  car: QualifyingCarFrame | undefined;
  finished: boolean;
  partOver: boolean;
}) {
  const { t } = useTranslation();
  const world = useCareer((s) => s.world);
  const { busy, sendOut } = useWeekend();
  const canGo = car?.state === 'garage' && !finished && !partOver && !busy;

  return (
    <Panel title={world.drivers[driverId]?.name ?? driverId}>
      <div className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex flex-col">
            <dt className="text-2xs text-lo">{t('weekend.practice.state')}</dt>
            <dd className="text-hi">{t(`weekend.qualifying.carState.${car?.state ?? 'garage'}`)}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-2xs text-lo">{t('weekend.qualifying.time')}</dt>
            <dd className="font-mono text-hi">
              {car?.timeS == null ? t('weekend.qualifying.noTime') : formatLapTime(car.timeS)}
            </dd>
          </div>
        </dl>
        <div>
          <Button size="sm" variant="primary" disabled={!canGo} onClick={() => void sendOut(driverId)}>
            {t('weekend.qualifying.sendOut')}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
