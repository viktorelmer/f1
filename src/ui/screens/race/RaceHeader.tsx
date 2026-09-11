import { useTranslation } from 'react-i18next';
import { SPEEDS, type Speed } from '@/app/store/race';
import type { RaceFrame } from '@/sim/race/replay';
import { Button } from '@/ui/design/Button';
import { cn } from '@/ui/design/cn';

type Props = {
  frame: RaceFrame;
  seed: string;
  speed: Speed;
  paused: boolean;
  durationS: number;
  onTogglePause: () => void;
  onSpeed: (speed: Speed) => void;
  onRestart: () => void;
  onNewRace: () => void;
};

/** "Lap 23/57 · Dry · air 31 °C · track 44 °C · Green flag   ▮▮ ×1 ×2 ×5 ×15" (plan 6.3). */
export function RaceHeader({
  frame,
  seed,
  speed,
  paused,
  durationS,
  onTogglePause,
  onSpeed,
  onRestart,
  onNewRace,
}: Props) {
  const { t } = useTranslation();
  const wettest = Math.max(...frame.wetness);
  const surface =
    wettest >= 0.35 ? t('race.header.wet') : wettest >= 0.1 ? t('race.header.damp') : t('race.header.dry');
  const statusText = frame.finished ? t('race.header.finished') : t(`race.header.status.${frame.status}`);
  const progress = durationS > 0 ? frame.timeS / durationS : 0;

  return (
    <div className="flex h-10 shrink-0 items-center gap-4 border-b border-line bg-panel px-3 text-sm">
      <span className="font-semibold">
        {t('race.header.lap', { lap: frame.lap, total: frame.totalLaps })}
      </span>
      <span className="text-lo">
        {surface} · {t('race.header.air', { temp: frame.weather.airTempC.toFixed(0) })} ·{' '}
        {t('race.header.track', { temp: frame.weather.trackTempC.toFixed(0) })} ·{' '}
        {t('race.header.wind', { speed: frame.weather.windKph.toFixed(0) })}
      </span>
      <span
        role="status"
        className={cn(
          'rounded-sm px-2 py-0.5 text-xs font-semibold',
          frame.status === 'green' && !frame.finished && 'text-positive',
          frame.status !== 'green' && 'bg-caution text-ground',
          frame.finished && 'bg-hi text-ground',
        )}
      >
        {statusText}
      </span>
      <span className="font-mono text-2xs text-lo">{t('race.header.seed', { seed })}</span>

      <div role="group" aria-label={t('race.controls.label')} className="ml-auto flex items-center gap-1">
        <div
          role="progressbar"
          aria-label={t('race.controls.progress')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          className="mr-2 h-1 w-28 overflow-hidden rounded-sm bg-raised"
        >
          <div className="h-full bg-accent" style={{ width: `${progress * 100}%` }} />
        </div>
        <Button size="sm" variant="secondary" onClick={onTogglePause} disabled={frame.finished}>
          {paused ? t('race.controls.play') : t('race.controls.pause')}
        </Button>
        {SPEEDS.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={s === speed ? 'primary' : 'ghost'}
            aria-pressed={s === speed}
            aria-label={t('race.controls.speedLabel', { speed: s })}
            onClick={() => onSpeed(s)}
          >
            {t('race.controls.speed', { speed: s })}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={onRestart}>
          {t('race.controls.restart')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onNewRace}>
          {t('race.controls.newRace')}
        </Button>
      </div>
    </div>
  );
}
