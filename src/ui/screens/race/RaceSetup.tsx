import { useEffect, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { randomSeed, useCareer } from '@/app/store/career';
import { useRace } from '@/app/store/race';
import { Button } from '@/ui/design/Button';
import { cn } from '@/ui/design/cn';
import { Panel } from '@/ui/design/Panel';
import { ControlBar } from './ControlBar';

/** Before the lights: which round, which seed, who runs the race and on what plan. */
export function RaceSetup() {
  const { t } = useTranslation();
  const world = useCareer((s) => s.world);
  const pack = useCareer((s) => s.pack);
  const { round, seed, phase, error, setRound, setSeed, start } = useRace();
  const seedId = useId();

  return (
    <div className="p-4">
      <Panel title={t('race.setup.title')} className="max-w-xl">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          <p className="text-sm text-lo">{t('race.setup.intro')}</p>
          <label className="flex flex-col gap-1 text-xs text-lo">
            {t('race.setup.round')}
            <select
              value={round}
              onChange={(e) => setRound(Number(e.target.value))}
              className="h-8 rounded-sm border border-line bg-raised px-2 text-sm text-hi"
            >
              {world.season.calendar.map((r) => {
                const track = pack.tracks.find((tr) => tr.id === r.trackId);
                return (
                  <option key={r.round} value={r.round}>
                    {t('race.setup.roundOption', { round: r.round, track: track?.name ?? r.trackId })}
                    {r.format === 'sprint' ? ` · ${t('race.setup.sprint')}` : ''}
                  </option>
                );
              })}
            </select>
          </label>
          <div className="flex flex-col gap-1">
            <label htmlFor={seedId} className="text-xs text-lo">
              {t('race.setup.seed')}
            </label>
            <span className="flex gap-2">
              <input
                id={seedId}
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                spellCheck={false}
                className="h-8 flex-1 rounded-sm border border-line bg-raised px-2 font-mono text-sm text-hi"
              />
              <Button type="button" variant="ghost" onClick={() => setSeed(randomSeed())}>
                {t('race.setup.newSeed')}
              </Button>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" disabled={phase === 'loading' || seed.trim() === ''}>
              {phase === 'loading' ? t('race.setup.loading') : t('race.setup.start')}
            </Button>
            {phase === 'error' && (
              <span role="alert" className="text-sm text-negative">
                {t('race.setup.error', { message: error ?? '' })}
              </span>
            )}
          </div>
        </form>
      </Panel>
      <Panel title={t('race.planStep.title')} className="mt-4 max-w-xl">
        <ControlBar inRace={false} />
        <PlanStep />
      </Panel>
    </div>
  );
}

/**
 * The strategist's pre-race options (plan 6.5): what each plan is expected to cost against the
 * best, and his pick. In manual strategy the plan the player picks is the one both cars start on.
 */
function PlanStep() {
  const { t } = useTranslation();
  const { plans, control, loadPlans, choosePlan } = useRace();
  const manual = control.strategy.mode === 'manual';
  const mine = Object.values(control.plans)[0];

  useEffect(() => {
    if (!plans) void loadPlans();
  }, [plans, loadPlans]);

  if (!plans) return <p className="p-3 text-sm text-lo">{t('race.planStep.loading')}</p>;
  const best = Math.min(...plans.options.map((o) => o.timeS));
  const chosen = mine ? plans.options.findIndex((o) => o.plan === mine) : -1;
  const selected = manual ? (chosen >= 0 ? chosen : plans.recommended) : plans.recommended;

  return (
    <div className="flex flex-col gap-2 p-3">
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
