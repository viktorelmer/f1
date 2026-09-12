import { useTranslation } from 'react-i18next';
import { balance } from '@/data/balance';
import { PROGRAMMES } from '@/data/schema/weekend-balance';
import type { Run } from '@/sim/weekend/practice';
import { Button } from '@/ui/design/Button';
import { compoundFor, minutesOf } from './session-view-model';

/**
 * A car's queue of programmes, as the player builds it (plan 5.3): the hour of the session against
 * what the team wants to know. The same editor plans a session beforehand and rewrites what is left
 * of it while the session runs.
 */
export function RunQueue({
  runs,
  onChange,
  disabled = false,
}: {
  runs: readonly Run[];
  onChange: (runs: readonly Run[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const budget = balance.weekend.session.practiceMinutes;
  const minutes = minutesOf(runs);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-2xs text-lo">{t('season.programmes.queue')}</span>
        <span className={`font-mono text-xs ${minutes > budget ? 'text-caution' : 'text-lo'}`}>
          {t('season.programmes.minutes', { used: Math.round(minutes), budget })}
        </span>
      </div>
      <ol className="flex flex-wrap gap-2">
        {runs.length === 0 && <li className="text-sm text-lo">{t('season.programmes.empty')}</li>}
        {runs.map((run, i) => (
          <li key={`${run.programme}-${i}`}>
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => onChange(runs.filter((_, k) => k !== i))}
              aria-label={`${t(`season.programmes.kind.${run.programme}`)} — ${t('season.programmes.clear')}`}
            >
              {t(`season.programmes.kind.${run.programme}`)} ✕
            </Button>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        {PROGRAMMES.map((kind) => (
          <Button
            key={kind}
            size="sm"
            disabled={disabled}
            onClick={() => onChange([...runs, { programme: kind, compound: compoundFor(kind) }])}
          >
            + {t(`season.programmes.kind.${kind}`)}
          </Button>
        ))}
      </div>
    </div>
  );
}
