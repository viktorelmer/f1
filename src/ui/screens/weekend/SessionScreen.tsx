import { useTranslation } from 'react-i18next';
import { useCareer } from '@/app/store/career';
import { useRace } from '@/app/store/race';
import { pendingStage, type SessionPlay, useWeekend } from '@/app/store/weekend';
import { Button } from '@/ui/design/Button';
import { Panel } from '@/ui/design/Panel';
import { RaceView } from '../race/RaceScreen';
import { ScreenRegion } from '../ScreenRegion';
import { PracticeView } from './PracticeView';
import { QualifyingView } from './QualifyingView';

/**
 * Уик-энд → Гонка (plan 6.3, docs/systems/weekend-play.md): the session the weekend is on, whatever
 * it is. Practice and qualifying play back from the weekend slice; Sunday is the race screen, and
 * its result goes into the world at the flag.
 */
export function SessionScreen() {
  const mode = useRace((s) => s.mode);
  const phase = useRace((s) => s.phase);
  const replay = useRace((s) => s.replay);
  const play = useWeekend((s) => s.play);
  const racing = mode === 'weekend' && phase === 'ready' && replay !== null;

  return (
    <ScreenRegion section="weekend" tab="race" className="flex h-full min-h-0 flex-col">
      {racing ? <RaceView replay={replay} /> : play ? <Session play={play} /> : <SessionGate />}
    </ScreenRegion>
  );
}

function Session({ play }: { play: SessionPlay }) {
  return play.kind === 'practice' ? (
    <PracticeView replay={play.replay} />
  ) : (
    <QualifyingView replay={play.replay} />
  );
}

/** Before the session: what the weekend is waiting on, and the way in. */
function SessionGate() {
  const { t } = useTranslation();
  const world = useCareer((s) => s.world);
  const pack = useCareer((s) => s.pack);
  const { phase, error, startWeekend } = useRace();
  const { busy, open, enter, simulateSession } = useWeekend();
  const stage = pendingStage(world);
  const weekend = world.weekend;
  const round = weekend ? world.season.calendar.find((r) => r.round === weekend.round) : undefined;
  const track = round ? (pack.tracks.find((tr) => tr.id === round.trackId)?.name ?? round.trackId) : null;
  const working = busy || phase === 'loading';
  const isRace = stage === 'race' || stage === 'sprint';

  return (
    <div className="p-4">
      <Panel title={t('weekend.gate.title')} className="max-w-xl">
        <div className="flex flex-col gap-3">
          {stage === null ? (
            <>
              <p className="text-sm text-lo">{t('weekend.gate.noWeekend')}</p>
              <div>
                <Button variant="primary" disabled={working} onClick={() => void open()}>
                  {working ? t('weekend.gate.working') : t('weekend.gate.open')}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-hi">
                {t('season.schedule.round', { round: weekend!.round, track: track ?? '' })}
              </p>
              <p className="text-sm text-lo">
                {t('weekend.gate.next', { session: t(`season.session.${stage}`) })}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  disabled={working}
                  onClick={() => void (isRace ? startWeekend() : enter())}
                >
                  {working
                    ? t('weekend.gate.working')
                    : t(isRace ? 'weekend.gate.start' : 'weekend.gate.enter')}
                </Button>
                <Button variant="ghost" disabled={working} onClick={() => void simulateSession()}>
                  {t('season.schedule.simulateSession')}
                </Button>
              </div>
            </>
          )}
          {phase === 'error' && error !== null && (
            <p role="alert" className="text-sm text-negative">
              {t('race.setup.error', { message: error })}
            </p>
          )}
        </div>
      </Panel>
    </div>
  );
}
