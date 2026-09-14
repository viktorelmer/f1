import { useTranslation } from 'react-i18next';
import { useCar } from '@/app/store/car';
import { useCareer } from '@/app/store/career';
import { balance } from '@/data/balance';
import { PHILOSOPHIES, type Philosophy } from '@/sim/types/world';
import { cn } from '@/ui/design/cn';
import { Panel } from '@/ui/design/Panel';
import { ScreenRegion } from '../ScreenRegion';

/** Болид → Философия (plan 5.1): the direction of the season, and what changing it costs. */
export function PhilosophyScreen() {
  const { t } = useTranslation();
  const world = useCareer((s) => s.world);
  const choose = useCar((s) => s.choosePhilosophy);
  const current = world.teams[world.career.playerTeamId]!.philosophy;
  const building = world.projects.some(
    (p) => p.teamId === world.career.playerTeamId && p.progress > 0 && p.stage !== 'validated',
  );

  return (
    <ScreenRegion section="car" tab="philosophy">
      <div className="flex flex-col gap-4 p-4">
        <p className="max-w-3xl text-sm text-lo">{t('car.philosophy.intro')}</p>
        <Panel title={t('car.philosophy.choose')} className="max-w-3xl">
          <ul role="radiogroup" aria-label={t('car.philosophy.choose')} className="flex flex-col gap-2">
            {PHILOSOPHIES.map((philosophy: Philosophy) => (
              <li key={philosophy}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={philosophy === current}
                  onClick={() => choose(philosophy)}
                  className={cn(
                    'flex w-full items-baseline justify-between gap-3 rounded-sm border px-3 py-2 text-left',
                    philosophy === current
                      ? 'border-accent bg-raised text-hi'
                      : 'border-line text-lo hover:text-hi',
                  )}
                >
                  <span className="text-sm font-semibold">{t(`car.philosophy.kind.${philosophy}`)}</span>
                  <span className="text-xs">{t(`car.philosophy.about.${philosophy}`)}</span>
                </button>
              </li>
            ))}
          </ul>
          {building && (
            <p className="mt-3 text-2xs text-caution">
              {t('car.philosophy.switchCost', {
                percent: Math.round(balance.development.philosophy.switchLossShare * 100),
              })}
            </p>
          )}
        </Panel>
      </div>
    </ScreenRegion>
  );
}
