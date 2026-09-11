import { useTranslation } from 'react-i18next';
import { useCareer } from '@/app/store/career';
import { useRace } from '@/app/store/race';
import { canDelegate, type DelegationMode } from '@/sim/decide/delegation';
import type { Aggression, StrategyGoal, TeamOrder } from '@/sim/race/types';
import { Segmented } from './Segmented';

const MODES: readonly DelegationMode[] = ['manual', 'directed', 'delegated'];
const RISKS = [
  { key: 'careful', value: 0.2 },
  { key: 'balanced', value: 0.5 },
  { key: 'bold', value: 0.8 },
] as const;
const GOALS: readonly StrategyGoal[] = ['fastest', 'gain-places', 'hold-position'];
const AGGRESSION: readonly Aggression[] = ['calm', 'normal', 'aggressive'];
const SAVING = ['none', 'tyres', 'fuel'] as const;
const ORDERS: readonly TeamOrder[] = ['hold', 'swap', 'free'];

/**
 * Who runs the race for the player's team (plan 5.19, 6.5): the switch sits on the race screen
 * itself. Strategy and radio each have a mode and, when directed, an instruction; team orders are
 * the player's own. A delegated area keeps every control live — any call can be taken back.
 */
export function ControlBar({ inRace }: { inRace: boolean }) {
  const { t } = useTranslation();
  const world = useCareer((s) => s.world);
  const {
    control,
    setStrategy,
    setRadio,
    suggestWithPause,
    setSuggestWithPause,
    decisionTimer,
    setDecisionTimer,
    command,
  } = useRace();
  const team = world.teams[control.teamId]!;
  const roles = new Set(team.staffIds.map((id) => world.staff[id]!.role));
  const modes = (area: 'race-strategy' | 'race-radio') => ({
    options: MODES.map((m) => ({ value: m, label: t(`race.control.mode.${m}`) })),
    disabledValues: canDelegate(area, roles) ? [] : (['directed', 'delegated'] as DelegationMode[]),
  });
  const risk = RISKS.reduce((a, b) =>
    Math.abs(b.value - control.strategy.risk) < Math.abs(a.value - control.strategy.risk) ? b : a,
  );

  return (
    <section aria-label={t('race.control.strategy')} className="flex flex-col gap-2 border-b border-line p-3">
      <Segmented
        label={t('race.control.strategy')}
        {...modes('race-strategy')}
        value={control.strategy.mode}
        onChange={(mode) => void setStrategy({ ...control.strategy, mode })}
      />
      {control.strategy.mode === 'directed' && (
        <div className="grid grid-cols-2 gap-2">
          <Segmented
            label={t('race.control.risk.label')}
            options={RISKS.map((r) => ({ value: r.key, label: t(`race.control.risk.${r.key}`) }))}
            value={risk.key}
            onChange={(key) =>
              void setStrategy({ ...control.strategy, risk: RISKS.find((r) => r.key === key)!.value })
            }
          />
          <Segmented
            label={t('race.control.goal.label')}
            options={GOALS.map((g) => ({ value: g, label: t(`race.control.goal.${g}`) }))}
            value={control.strategy.goal}
            onChange={(goal) => void setStrategy({ ...control.strategy, goal })}
          />
        </div>
      )}
      {control.strategy.mode !== 'manual' && (
        <div className="flex gap-3 text-2xs text-lo">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={suggestWithPause}
              onChange={(e) => setSuggestWithPause(e.target.checked)}
            />
            {t('race.control.suggest')}
          </label>
          {suggestWithPause && (
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={decisionTimer}
                onChange={(e) => setDecisionTimer(e.target.checked)}
              />
              {t('race.control.timer')}
            </label>
          )}
        </div>
      )}

      <Segmented
        label={t('race.control.radio')}
        {...modes('race-radio')}
        value={control.radio.mode}
        onChange={(mode) => void setRadio({ ...control.radio, mode })}
      />
      {control.radio.mode !== 'delegated' && (
        <div className="grid grid-cols-2 gap-2">
          <Segmented
            label={t('race.radio.aggression.label')}
            options={AGGRESSION.map((a) => ({ value: a, label: t(`race.radio.aggression.${a}`) }))}
            value={control.radio.aggression}
            onChange={(aggression) => void setRadio({ ...control.radio, aggression })}
          />
          {control.radio.mode === 'directed' && (
            <Segmented
              label={t('race.control.saving.label')}
              options={SAVING.map((s) => ({ value: s, label: t(`race.control.saving.${s}`) }))}
              value={control.radio.saving}
              onChange={(saving) => void setRadio({ ...control.radio, saving })}
            />
          )}
        </div>
      )}

      {inRace && (
        <Segmented
          label={t('race.orders.title')}
          options={ORDERS.map((o) => ({ value: o, label: t(`race.orders.${o}`) }))}
          value={null}
          onChange={(order) => void command({ kind: 'team-order', teamId: control.teamId, order })}
        />
      )}
    </section>
  );
}
