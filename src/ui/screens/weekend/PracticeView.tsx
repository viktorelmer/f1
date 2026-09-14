import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCareer } from '@/app/store/career';
import { runsOf, useWeekend } from '@/app/store/weekend';
import { balance } from '@/data/balance';
import { formatLapTime } from '@/i18n/format';
import type { DriverId, TyreAllocation, WeekendKnowledge } from '@/sim/types/world';
import type { Run } from '@/sim/weekend/practice';
import {
  type PracticeCarFrame,
  type PracticeFrame,
  practiceFrameAt,
  type PracticeReplay,
} from '@/sim/weekend/practice-replay';
import { Button } from '@/ui/design/Button';
import { cn } from '@/ui/design/cn';
import { Estimate } from '@/ui/design/Estimate';
import { Panel } from '@/ui/design/Panel';
import { CompoundBadge } from '../race/CompoundBadge';
import { buildRoster, type Roster } from '../race/roster';
import { usePlaybackClock } from '../race/use-playback-clock';
import { useStable } from '../race/use-stable';
import { RunQueue } from './RunQueue';
import { SessionHeader } from './SessionHeader';
import { mmss } from './session-view-model';

/**
 * Practice as an hour you sit through (docs/systems/weekend-play.md): the board, the laps as they
 * come, what the team is working out, and the queue of the player's own cars — which can be
 * rewritten while the session runs.
 */
export function PracticeView({ replay }: { replay: PracticeReplay }) {
  const { t } = useTranslation();
  const world = useCareer((s) => s.world);
  const { timeS, paused, tick } = useWeekend();
  const roster = useMemo(() => buildRoster(world), [world]);
  const frame = useMemo(() => practiceFrameAt(replay, timeS), [replay, timeS]);
  usePlaybackClock(!paused && !frame.finished, tick);

  const session = replay.result.session.session;
  const cars = useStable(
    frame.cars,
    frame.cars.map((c) => `${c.driverId}:${c.lapsDone}:${c.bestLapS ?? ''}:${c.state}`).join('|'),
  );
  const laps = useStable(frame.laps, String(frame.laps.length));
  const mine = world.teams[world.career.playerTeamId]?.drivers.race ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SessionHeader
        title={t(`season.session.${session}`)}
        status={
          frame.finished
            ? t('weekend.clock.ended')
            : t('weekend.clock.remaining', { time: mmss(frame.durationS - frame.timeS) })
        }
        timeS={frame.timeS}
        durationS={frame.durationS}
        finished={frame.finished}
      />
      <div className="grid min-h-0 flex-1 grid-cols-[24rem_minmax(0,1fr)_23rem]">
        <div className="min-h-0 overflow-y-auto border-r border-line bg-panel">
          <PracticeBoard cars={cars} roster={roster} />
        </div>
        <div className="min-h-0 overflow-y-auto p-3">
          <LapFeed laps={laps} roster={roster} />
        </div>
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto border-l border-line bg-panel p-3">
          {mine.map((driverId) => (
            <CarPanel
              key={driverId}
              driverId={driverId}
              session={session}
              car={frame.cars.find((c) => c.driverId === driverId)}
              replay={replay}
              timeS={frame.timeS}
              finished={frame.finished}
            />
          ))}
          <KnowledgePanel knowledge={frame.knowledge[world.career.playerTeamId]} driverIds={mine} />
        </div>
      </div>
    </div>
  );
}

const PracticeBoard = memo(function PracticeBoard({
  cars,
  roster,
}: {
  cars: readonly PracticeCarFrame[];
  roster: Roster;
}) {
  const { t } = useTranslation();
  const grid =
    'grid grid-cols-[1.75rem_minmax(0,1fr)_4.5rem_2.5rem_6.5rem] items-center gap-x-1.5 px-2 whitespace-nowrap';

  return (
    <div role="table" aria-label={t('weekend.practice.board')} className="flex min-h-0 flex-col text-sm">
      <div role="row" className={cn(grid, 'h-row border-b border-line text-xs text-lo')}>
        <span role="columnheader" className="text-right">
          {t('race.board.position')}
        </span>
        <span role="columnheader">{t('race.board.driver')}</span>
        <span role="columnheader" className="text-right">
          {t('weekend.practice.best')}
        </span>
        <span role="columnheader" className="text-right">
          {t('weekend.practice.laps')}
        </span>
        <span role="columnheader">{t('weekend.practice.state')}</span>
      </div>
      {cars.map((car, i) => {
        const entry = roster.get(car.driverId);
        return (
          <div
            key={car.driverId}
            role="row"
            className={cn(grid, 'h-row border-b border-line/60', entry?.isPlayer && 'bg-raised')}
          >
            <span role="cell" className="text-right font-mono text-xs text-lo">
              {i + 1}
            </span>
            <span role="cell" className="flex min-w-0 items-center gap-1.5">
              <span className="h-3 w-0.5 shrink-0" style={{ background: entry?.colour }} />
              <span className={cn('truncate', entry?.isPlayer ? 'font-semibold text-hi' : 'text-lo')}>
                {entry?.short ?? car.driverId}
              </span>
            </span>
            <span role="cell" className="text-right font-mono text-xs">
              {car.bestLapS === null ? '—' : formatLapTime(car.bestLapS)}
            </span>
            <span role="cell" className="text-right font-mono text-xs text-lo">
              {car.lapsDone}
            </span>
            <span role="cell" className="flex items-center gap-1 text-xs text-lo">
              {car.compound && <CompoundBadge compound={car.compound} />}
              {t(`weekend.practice.carState.${car.state}`)}
            </span>
          </div>
        );
      })}
    </div>
  );
});

const LapFeed = memo(function LapFeed({ laps, roster }: { laps: PracticeFrame['laps']; roster: Roster }) {
  const { t } = useTranslation();
  const shown = [...laps].slice(-40).reverse();

  return (
    <Panel title={t('weekend.practice.feed')} className="h-full" flush>
      {shown.length === 0 ? (
        <p className="p-3 text-sm text-lo">{t('weekend.practice.noLaps')}</p>
      ) : (
        <ul className="divide-y divide-line/60">
          {shown.map((lap) => (
            <li
              key={`${lap.driverId}-${lap.lap}`}
              className="flex items-center gap-3 px-3 py-1 text-sm whitespace-nowrap"
            >
              <span className="font-mono text-2xs text-lo">{mmss(lap.atS)}</span>
              <span className={cn('w-36 truncate', roster.get(lap.driverId)?.isPlayer && 'text-hi')}>
                {roster.get(lap.driverId)?.name ?? lap.driverId}
              </span>
              <CompoundBadge compound={lap.compound} />
              <span className="text-2xs text-lo">{t(`season.programmes.kind.${lap.programme}`)}</span>
              <span className="ml-auto font-mono">{formatLapTime(lap.timeS)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
});

/** One of the player's cars: what it is doing, what it has left, and what it does next. */
function CarPanel({
  driverId,
  session,
  car,
  replay,
  timeS,
  finished,
}: {
  driverId: DriverId;
  session: Parameters<typeof runsOf>[2];
  car: PracticeCarFrame | undefined;
  replay: PracticeReplay;
  timeS: number;
  finished: boolean;
}) {
  const { t } = useTranslation();
  const world = useCareer((s) => s.world);
  const { draft, busy, setRuns } = useWeekend();
  const planned = runsOf(world, draft, session, driverId);
  const [queue, setQueue] = useState<readonly Run[]>(planned);
  const sets = setsNow(world, replay, driverId, timeS);

  return (
    <Panel title={world.drivers[driverId]?.name ?? driverId}>
      <div className="flex flex-col gap-3">
        <dl className="grid grid-cols-3 gap-2 text-xs">
          <Field
            label={t('weekend.practice.state')}
            value={t(`weekend.practice.carState.${car?.state ?? 'done'}`)}
          />
          <Field
            label={t('weekend.practice.minutes')}
            value={`${Math.round(car?.minutesUsed ?? 0)} / ${balance.weekend.session.practiceMinutes}`}
          />
          <Field label={t('weekend.practice.sets')} value={`${sets.soft}·${sets.medium}·${sets.hard}`} />
        </dl>
        <RunQueue runs={queue} onChange={setQueue} disabled={finished} />
        <div>
          <Button
            size="sm"
            variant="primary"
            disabled={finished || busy}
            onClick={() => void setRuns(driverId, queue)}
          >
            {t('weekend.practice.send')}
          </Button>
        </div>
      </div>
    </Panel>
  );
}

/** What the team has worked out so far — the only way an estimate ever shows (plan 6.6). */
function KnowledgePanel({
  knowledge,
  driverIds,
}: {
  knowledge: WeekendKnowledge | undefined;
  driverIds: readonly string[];
}) {
  const { t } = useTranslation();
  if (!knowledge) return null;

  return (
    <Panel title={t('weekend.practice.knowledge')}>
      <div className="flex flex-col gap-3">
        <Estimate
          estimate={knowledge.tyreDegradation}
          label={t('weekend.practice.degradation')}
          format={(v) => t('weekend.practice.perLap', { value: v.toFixed(3) })}
        />
        <Estimate
          estimate={knowledge.fuelPerLapKg}
          label={t('weekend.practice.fuel')}
          format={(v) => t('weekend.practice.kgPerLap', { value: v.toFixed(2) })}
        />
        <dl className="grid grid-cols-2 gap-2 text-xs">
          <Field
            label={t('weekend.practice.setupLaps')}
            value={driverIds.map((id) => Math.round(knowledge.setup[id]?.laps ?? 0)).join(' · ')}
          />
          <Field label={t('weekend.practice.behind')} value={String(Math.round(knowledge.laps))} />
        </dl>
      </div>
    </Panel>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-2xs text-lo">{label}</dt>
      <dd className="font-mono text-hi">{value}</dd>
    </div>
  );
}

/**
 * The sets this car still has: what it declared for the weekend, less the fresh runs it has already
 * gone out on. Read from the runs that have started, never from the session's final tally.
 */
function setsNow(
  world: ReturnType<typeof useCareer.getState>['world'],
  replay: PracticeReplay,
  driverId: DriverId,
  timeS: number,
): TyreAllocation {
  const left: TyreAllocation = { ...(world.weekend?.sets[driverId] ?? { soft: 0, medium: 0, hard: 0 }) };
  for (const run of replay.runs) {
    if (run.driverId !== driverId || run.outAtS > timeS) continue;
    if (!balance.weekend.programmes[run.programme]?.fresh) continue;
    const compound = run.compound;
    if (compound === 'soft' || compound === 'medium' || compound === 'hard')
      left[compound] = Math.max(0, left[compound] - 1);
  }
  return left;
}
