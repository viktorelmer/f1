import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRace } from '@/app/store/race';
import type { PitAnswer, StrategyDecision } from '@/sim/race/types';
import { Button } from '@/ui/design/Button';
import { cn } from '@/ui/design/cn';
import { Dialog } from '@/ui/design/Dialog';
import type { Roster } from './roster';

/** Seconds before a suggested call is accepted, when the timer is on (plan 6.5). */
const TIMER_S = 10;

/**
 * The strategist's call, put to the player (plan 5.19 rule 2, 6.5): the race is paused on it. His
 * pick is marked and every option shows what he expects it to cost against the best. In manual
 * strategy nothing happens until the player decides; when suggesting, a timer accepts his pick.
 */
export function DecisionDialog({ roster }: { roster: Roster }) {
  const pending = useRace((s) => s.pending);
  if (!pending) return null;
  // Keyed by the call, so each one starts with its own choice and its own timer.
  return <Call key={`${pending.driverId}@${pending.timeS}`} decision={pending} roster={roster} />;
}

function Call({ decision, roster }: { decision: StrategyDecision; roster: Roster }) {
  const { t } = useTranslation();
  const answer = useRace((s) => s.answer);
  const timerOn = useRace((s) => s.decisionTimer) && decision.by === 'strategist';
  const [choice, setChoice] = useState(decision.recommended);
  const [left, setLeft] = useState(TIMER_S);

  useEffect(() => {
    if (!timerOn) return;
    const id = setInterval(() => {
      setLeft((s) => {
        if (s <= 1) {
          clearInterval(id);
          void answer('accept');
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [timerOn, answer]);

  const best = Math.min(...decision.options.map((o) => o.expectedS));
  const label = (a: PitAnswer) =>
    a.call === 'stay'
      ? t('race.decision.stay')
      : t('race.decision.pitOn', { compound: t(`race.compound.${a.compound}`) });
  const stay = decision.options.findIndex((o) => o.answer.call === 'stay');
  const driver = roster.get(decision.driverId)?.short ?? decision.driverId;

  return (
    <Dialog
      open
      onOpenChange={() => {}}
      title={t('race.decision.title', { driver })}
      description={t('race.decision.context', {
        trigger: t(`race.trigger.${decision.trigger}`),
        lap: decision.lap,
      })}
      footer={
        <>
          {stay >= 0 && (
            <Button variant="ghost" onClick={() => void answer(decision.options[stay]!.answer)}>
              {t('race.decision.reject')}
            </Button>
          )}
          {choice !== decision.recommended && (
            <Button onClick={() => void answer(decision.options[choice]!.answer)}>
              {t('race.decision.apply')}
            </Button>
          )}
          <Button variant="primary" onClick={() => void answer('accept')}>
            {t('race.decision.accept')}
            {timerOn && (
              <span className="font-mono text-xs">
                {' '}
                · {t('race.decision.countdown', { s: Math.max(0, left) })}
              </span>
            )}
          </Button>
        </>
      }
    >
      {decision.by === 'unanswered' && <p className="mb-2 text-xs text-lo">{t('race.decision.manual')}</p>}
      <ul role="radiogroup" aria-label={t('race.decision.title', { driver })} className="flex flex-col gap-1">
        {decision.options.map((o, i) => (
          <li key={i}>
            <button
              type="button"
              role="radio"
              aria-checked={i === choice}
              onClick={() => setChoice(i)}
              className={cn(
                'flex w-full items-center justify-between gap-3 rounded-sm border px-2 py-1.5 text-left text-sm',
                i === choice ? 'border-accent bg-raised text-hi' : 'border-line text-lo hover:text-hi',
              )}
            >
              <span>
                {label(o.answer)}
                {i === decision.recommended && (
                  <span className="ml-2 text-2xs text-lo">· {t('race.decision.pick')}</span>
                )}
              </span>
              <span className="font-mono text-xs tabular-nums">
                {o.expectedS - best < 0.05
                  ? t('race.decision.best')
                  : t('race.decision.slower', { s: (o.expectedS - best).toFixed(1) })}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
