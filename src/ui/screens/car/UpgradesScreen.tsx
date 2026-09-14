import { useTranslation } from 'react-i18next';
import { projectsOf, useCar } from '@/app/store/car';
import { useCareer } from '@/app/store/career';
import { balance } from '@/data/balance';
import { isReady } from '@/sim/car/development';
import type { RnDProject } from '@/sim/types/world';
import { Button } from '@/ui/design/Button';
import { Estimate } from '@/ui/design/Estimate';
import { Panel } from '@/ui/design/Panel';
import { ScreenRegion } from '../ScreenRegion';

/** Болид → Апгрейды (plan 6.2): what is built, what is on the car, and what the track made of it. */
export function UpgradesScreen() {
  const { t } = useTranslation();
  const world = useCareer((s) => s.world);
  const install = useCar((s) => s.install);
  const projects = projectsOf(world);
  const waiting = projects.filter(isReady);
  const onCar = projects.filter((p) => p.stage === 'installed');
  const checked = projects.filter((p) => p.stage === 'validated');

  return (
    <ScreenRegion section="car" tab="upgrades">
      <div className="flex flex-col gap-4 p-4">
        <p className="max-w-3xl text-sm text-lo">{t('car.upgrades.intro')}</p>

        <Panel title={t('car.upgrades.waiting')} className="max-w-3xl">
          {waiting.length === 0 ? (
            <p className="text-sm text-lo">{t('car.upgrades.none')}</p>
          ) : (
            <div className="flex flex-col gap-4">
              {waiting.map((project) => (
                <Upgrade key={project.id} project={project} onInstall={() => install(project.id)} />
              ))}
            </div>
          )}
        </Panel>

        {onCar.length > 0 && (
          <Panel title={t('car.upgrades.onCar')} className="max-w-3xl">
            <div className="flex flex-col gap-4">
              {onCar.map((project) => (
                <Upgrade key={project.id} project={project} />
              ))}
            </div>
          </Panel>
        )}

        {checked.length > 0 && (
          <Panel title={t('car.upgrades.checked')} className="max-w-3xl">
            <div className="flex flex-col gap-4">
              {checked.map((project) => (
                <Upgrade key={project.id} project={project} checked />
              ))}
            </div>
          </Panel>
        )}
      </div>
    </ScreenRegion>
  );
}

function Upgrade({
  project,
  onInstall,
  checked = false,
}: {
  project: RnDProject;
  onInstall?: () => void;
  checked?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-3 first:border-t-0 first:pt-0">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-hi">{t(`car.specs.parts.${project.part}`)}</h3>
        <span className="font-mono text-xs text-lo">
          {t('car.development.forSeason', { season: project.targetSeason })} · {project.spentM.toFixed(1)}M
        </span>
      </header>
      <Estimate
        estimate={project.expectedGain}
        label={checked ? t('car.upgrades.gave') : t('car.upgrades.promised')}
        format={(v) => t('car.development.gainPoints', { value: v.toFixed(1) })}
      />
      {onInstall && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" onClick={onInstall}>
            {t('car.upgrades.fit')}
          </Button>
          <span className="text-2xs text-caution">
            {t('car.upgrades.greenWarning', {
              points: (balance.development.freshness.reliabilityCost * 100).toFixed(0),
            })}
          </span>
        </div>
      )}
    </section>
  );
}
