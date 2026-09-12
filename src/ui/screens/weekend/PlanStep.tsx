import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useRace } from '@/app/store/race';
import { cn } from '@/ui/design/cn';

/**
 * The strategist's pre-race options (plan 6.5): what each plan is expected to cost against the
 * best, and his pick. In manual strategy the plan the player picks is the one both cars start on.
 */
export function PlanStep() {
  const { t } = useTranslation();
  const { plans, control, loadPlans, choosePlan } = useRace();
  const manual = control.strategy.mode === 'manual';
  const mine = Object.values(control.plans)[0];

  useEffect(() => {
    if (!plans) void loadPlans();
  }, [plans, loadPlans]);

  if (!plans) return <p className="text-sm text-lo">{t('race.planStep.loading')}</p>;
  const best = Math.min(...plans.options.map((o) => o.timeS));
  const chosen = mine ? plans.options.findIndex((o) => o.plan === mine) : -1;
  const selected = manual ? (chosen >= 0 ? chosen : plans.recommended) : plans.recommended;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-lo">{t('race.planStep.intro')}</p>
      <ul role="radiogroup" aria-label={t('race.planStep.title')} className="flex flex-col gap-1">
        {plans.options.map((o, i) => (
          <li key={i}>
            <button
              type="button"
              role="radio"
              aria-checked={i === selected}
              disabled={!manual}
              onClick={() => choosePlan(o.plan)}
              className={cn(
                'flex w-full items-center justify-between gap-3 rounded-sm border px-2 py-1.5 text-left text-sm',
                i === selected ? 'border-accent bg-raised text-hi' : 'border-line text-lo',
                manual && 'hover:text-hi',
              )}
            >
              <span className="font-mono">
                {t('race.planStep.option', {
                  stints: o.plan.stints
                    .map((s) => `${t(`race.compound.short.${s.compound}`)}·${s.laps}`)
                    .join(' → '),
                })}
                {i === plans.recommended && (
                  <span className="ml-2 font-sans text-2xs text-lo">· {t('race.planStep.pick')}</span>
                )}
                {manual && i === chosen && (
                  <span className="ml-2 font-sans text-2xs text-lo">· {t('race.planStep.yours')}</span>
                )}
              </span>
              <span className="font-mono text-xs tabular-nums">
                {o.timeS - best < 0.05
                  ? t('race.decision.best')
                  : t('race.planStep.delta', { s: (o.timeS - best).toFixed(1) })}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
