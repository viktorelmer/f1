import { Tabs } from 'radix-ui';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCareer } from '@/app/store/career';
import { type PlayerCommand, useRace } from '@/app/store/race';
import { frameAt, type Replay } from '@/sim/race/replay';
import { cn } from '@/ui/design/cn';
import { ControlBar } from './ControlBar';
import { DecisionDialog } from './DecisionDialog';
import { DriverPanel } from './DriverPanel';
import { EventFeed } from './EventFeed';
import { GapChart } from './GapChart';
import { PitHistory } from './PitHistory';
import { RaceHeader } from './RaceHeader';
import { RaceResults } from './RaceResults';
import { RaceSetup } from './RaceSetup';
import { buildRoster } from './roster';
import { TimingBoard } from './TimingBoard';
import { TrackMap } from './TrackMap';
import { usePlaybackClock } from './use-playback-clock';
import { useStable } from './use-stable';
import { boardRows, boardSignature } from './view-model';

/** Chart width before the container has been measured (and in tests, where nothing is laid out). */
const FALLBACK_CHART_WIDTH = 640;

type Tab = 'events' | 'gaps' | 'pits' | 'results';

/** The race screen (plan 6.3): setup, then the race playing back until the flag. */
export function RaceScreen() {
  const phase = useRace((s) => s.phase);
  const replay = useRace((s) => s.replay);
  if (phase !== 'ready' || !replay) return <RaceSetup />;
  return <RaceView replay={replay} />;
}

/** The race itself, playing back: the same view whether it is the weekend's Sunday or the sandbox. */
export function RaceView({ replay }: { replay: Replay }) {
  const { t, i18n } = useTranslation();
  const world = useCareer((s) => s.world);
  const { timeS, speed, paused, seed, togglePause, setSpeed, restart, backToSetup, command, tick } =
    useRace();
  const roster = useMemo(() => buildRoster(world), [world]);
  const frame = useMemo(() => frameAt(replay, timeS), [replay, timeS]);
  usePlaybackClock(!paused && !frame.finished, tick);

  // The frame is rebuilt every animation frame; these are handed down only when what they show changes.
  const freshRows = boardRows(frame.cars, i18n.language, t, (n) => t('race.board.lapsDown', { count: n }));
  const rows = useStable(freshRows, `${i18n.language}|${boardSignature(freshRows)}`);
  const events = useStable(frame.events, String(frame.events.length));
  const freshMine = frame.cars.filter((c) => roster.get(c.driverId)?.isPlayer);
  const myCars = useStable(
    freshMine,
    freshMine
      .map(
        (c) =>
          `${c.position}:${c.status}:${c.lap}:${c.stops}:${c.compound}:${c.tyreAge}:${c.plan.map((s) => s.toLap).join()}:${c.radio ? Object.values(c.radio).join() : ''}:${c.forecast?.lap ?? ''}`,
      )
      .join('|'),
  );
  const onCommand = useCallback((c: PlayerCommand) => void command(c), [command]);
  const lapsDone = frame.cars[0] ? Math.min(frame.totalLaps, Math.floor(frame.cars[0].progress)) : 0;

  // A tab picked during the race gives way to the result at the flag (and back after a restart).
  const [picked, setPicked] = useState<{ tab: Tab; finished: boolean } | null>(null);
  const tab: Tab = picked?.finished === frame.finished ? picked.tab : frame.finished ? 'results' : 'events';
  const tabs: Tab[] = frame.finished ? ['results', 'events', 'gaps', 'pits'] : ['events', 'gaps', 'pits'];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <RaceHeader
        frame={frame}
        seed={seed}
        speed={speed}
        paused={paused}
        durationS={replay.durationS}
        onTogglePause={togglePause}
        onSpeed={setSpeed}
        onRestart={restart}
        onNewRace={backToSetup}
      />
      <div className="grid min-h-0 flex-1 grid-cols-[24rem_minmax(0,1fr)_19rem]">
        <div className="min-h-0 overflow-y-auto border-r border-line bg-panel">
          <TimingBoard rows={rows} roster={roster} />
        </div>

        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="min-h-0 flex-1 p-2">
            <TrackMap geometry={replay.input.geometry} cars={frame.cars} roster={roster} />
          </div>
          <Tabs.Root
            value={tab}
            onValueChange={(value) => setPicked({ tab: value as Tab, finished: frame.finished })}
            className="flex h-64 shrink-0 flex-col border-t border-line bg-panel"
          >
            <Tabs.List aria-label={t('race.tabs.label')} className="flex shrink-0 border-b border-line">
              {tabs.map((id) => (
                <Tabs.Trigger
                  key={id}
                  value={id}
                  className={cn(
                    '-mb-px h-8 border-b-2 border-transparent px-3 text-sm text-lo hover:text-hi',
                    'data-[state=active]:border-accent data-[state=active]:text-hi',
                  )}
                >
                  {id === 'results' ? t('race.results.title') : t(`race.tabs.${id}`)}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            {frame.finished && (
              <Tabs.Content value="results" className="min-h-0 flex-1 overflow-y-auto">
                <RaceResults classification={replay.result.classification} roster={roster} />
              </Tabs.Content>
            )}
            <Tabs.Content value="events" className="min-h-0 flex-1 overflow-y-auto">
              <EventFeed events={events} roster={roster} />
            </Tabs.Content>
            <Tabs.Content value="gaps" className="min-h-0 flex-1 overflow-y-auto">
              <Measured>
                {(width) => (
                  <GapChart
                    result={replay.result}
                    roster={roster}
                    lapsDone={lapsDone}
                    events={events}
                    width={width || FALLBACK_CHART_WIDTH}
                  />
                )}
              </Measured>
            </Tabs.Content>
            <Tabs.Content value="pits" className="min-h-0 flex-1 overflow-y-auto">
              <PitHistory events={events} roster={roster} />
            </Tabs.Content>
          </Tabs.Root>
        </div>

        <div className="min-h-0 overflow-y-auto border-l border-line bg-panel">
          <ControlBar inRace={!frame.finished} />
          <DriverPanel
            cars={myCars}
            roster={roster}
            field={replay.input.entries.length}
            onCommand={onCommand}
          />
        </div>
      </div>
      <DecisionDialog roster={roster} />
    </div>
  );
}

/** Hands its child the container's width, so an SVG chart draws in real pixels instead of scaling text. */
function Measured({ children }: { children: (width: number) => ReactNode }) {
  const [width, setWidth] = useState(0);
  const ref = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref}>{children(width)}</div>;
}
