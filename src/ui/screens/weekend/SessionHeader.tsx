import { useTranslation } from 'react-i18next';
import { SPEEDS } from '@/app/store/playback';
import { useWeekend } from '@/app/store/weekend';
import { Button } from '@/ui/design/Button';
import { cn } from '@/ui/design/cn';

/** "FP1 · 41:12 left   ▮▮ ×1 ×2 ×5 ×15  To the flag  Leave" — the clock of a weekend session. */
export function SessionHeader({
  title,
  status,
  timeS,
  durationS,
  finished,
}: {
  title: string;
  status: string;
  timeS: number;
  durationS: number;
  finished: boolean;
}) {
  const { t } = useTranslation();
  const { speed, paused, busy, setSpeed, togglePause, skipToEnd, leave } = useWeekend();
  const progress = durationS > 0 ? timeS / durationS : 0;

  return (
    <div className="flex h-10 shrink-0 items-center gap-4 border-b border-line bg-panel px-3 text-sm">
      <span className="font-semibold">{title}</span>
      <span
        role="status"
        className={cn('rounded-sm px-2 py-0.5 font-mono text-xs', finished ? 'bg-hi text-ground' : 'text-lo')}
      >
        {status}
      </span>
      {busy && <span className="text-2xs text-lo">{t('weekend.clock.rerunning')}</span>}

      <div role="group" aria-label={t('race.controls.label')} className="ml-auto flex items-center gap-1">
        <div
          role="progressbar"
          aria-label={t('weekend.clock.progress')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          className="mr-2 h-1 w-28 overflow-hidden rounded-sm bg-raised"
        >
          <div className="h-full bg-accent" style={{ width: `${progress * 100}%` }} />
        </div>
        <Button size="sm" variant="secondary" onClick={togglePause} disabled={finished}>
          {paused ? t('race.controls.play') : t('race.controls.pause')}
        </Button>
        {SPEEDS.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={s === speed ? 'primary' : 'ghost'}
            aria-pressed={s === speed}
            aria-label={t('race.controls.speedLabel', { speed: s })}
            onClick={() => setSpeed(s)}
          >
            {t('race.controls.speed', { speed: s })}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={skipToEnd} disabled={finished}>
          {t('weekend.clock.skip')}
        </Button>
        <Button size="sm" variant="ghost" onClick={leave}>
          {t('weekend.clock.leave')}
        </Button>
      </div>
    </div>
  );
}
