import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { projectsOf, useCar } from '@/app/store/car';
import { useCareer } from '@/app/store/career';
import { useWeekend } from '@/app/store/weekend';
import { balance } from '@/data/balance';
import { CHASSIS_PARTS, type ChassisPart } from '@/data/schema/balance';
import { aeroAllowance, isReady, officeCapacity } from '@/sim/car/development';
import { canDelegate, type DelegationMode } from '@/sim/decide/delegation';
import type { RnDProject } from '@/sim/types/world';
import { Button } from '@/ui/design/Button';
import { Estimate } from '@/ui/design/Estimate';
import { Panel } from '@/ui/design/Panel';
import { Segmented } from '../race/Segmented';
import { ScreenRegion } from '../ScreenRegion';

const MODES: readonly DelegationMode[] = ['manual', 'directed', 'delegated'];
const SHARES = [0.2, 0.35, 0.6] as const;

/**
 * Болид → Разработка (plan 5.1, 6.2): what the factory is building, what it is costing, and the
 * one number nobody can be sure of — shown, as always, as an `Estimate` and never as a figure.
 */
export function DevelopmentScreen() {
  const { t } = useTranslation();
  const world = useCareer((s) => s.world);
  const pack = useCareer((s) => s.pack);
  const { start, install, error } = useCar();
  const setDelegation = useWeekend((s) => s.setDelegation);
  const teamId = world.career.playerTeamId;
  const team = world.teams[teamId]!;
  const projects = projectsOf(world);
  const active = projects.filter((p) => !isReady(p) && p.stage !== 'installed' && p.stage !== 'validated');
  const ready = projects.filter(isReady);
  const committed = active.reduce((sum, p) => sum + p.atrShare, 0);

  const [part, setPart] = useState<ChassisPart>('floor');
  const [season, setSeason] = useState(world.season.year);
  const [share, setShare] = useState<number>(0.35);
  const roles = new Set(team.staffIds.map((id) => world.staff[id]!.role));

  return (
    <ScreenRegion section="car" tab="development">
      <div className="flex flex-col gap-4 p-4">
        <p className="max-w-3xl text-sm text-lo">{t('car.development.intro')}</p>

        <div className="max-w-3xl">
          <Segmented
            label={t('car.development.delegation')}
            options={MODES.map((m) => ({ value: m, label: t(`race.control.mode.${m}`) }))}
            disabledValues={
              canDelegate('development', roles) ? [] : (['directed', 'delegated'] as DelegationMode[])
            }
            value={world.career.delegation.development}
            onChange={(mode) => setDelegation('development', mode)}
          />
        </div>

        <Panel title={t('car.development.resources')} className="max-w-3xl">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            <Field
              label={t('car.development.allowance')}
              value={`${Math.round(aeroAllowance(world, pack, teamId) * 100)}%`}
            />
            <Field label={t('car.development.committed')} value={`${Math.round(committed * 100)}%`} />
            <Field
              label={t('car.development.office')}
              value={officeCapacity(world, teamId, active.length).toFixed(2)}
            />
            <Field label={t('car.development.active')} value={String(active.length)} />
          </dl>
        </Panel>

        <Panel title={t('car.development.start')} className="max-w-3xl">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-lo">
              {t('car.development.startPart')}
              <select
                value={part}
                onChange={(e) => setPart(e.target.value as ChassisPart)}
                className="h-8 rounded-sm border border-line bg-raised px-2 text-sm text-hi"
              >
                {CHASSIS_PARTS.map((p) => (
                  <option key={p} value={p}>
                    {t(`car.specs.parts.${p}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-lo">
              {t('car.development.startSeason')}
              <select
                value={season}
                onChange={(e) => setSeason(Number(e.target.value))}
                className="h-8 rounded-sm border border-line bg-raised px-2 text-sm text-hi"
              >
                {[world.season.year, world.season.year + 1].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-col gap-1">
              <Segmented
                label={t('car.development.startShare')}
                options={SHARES.map((s) => ({ value: String(s), label: `${Math.round(s * 100)}%` }))}
                value={String(share)}
                onChange={(value) => setShare(Number(value))}
              />
            </div>
            <Button variant="primary" onClick={() => start({ part, targetSeason: season, atrShare: share })}>
              {t('car.development.start')}
            </Button>
          </div>
          {error !== null && (
            <p role="alert" className="mt-2 text-sm text-negative">
              {error === 'already-started' ? t('car.development.alreadyStarted') : error}
            </p>
          )}
        </Panel>

        {ready.length > 0 && (
          <Panel title={t('car.development.ready')} className="max-w-3xl">
            <div className="flex flex-col gap-3">
              {ready.map((project) => (
                <ProjectRow key={project.id} project={project} onInstall={() => install(project.id)} />
              ))}
            </div>
          </Panel>
        )}

        <Panel title={t('car.development.active')} className="max-w-3xl">
          {active.length === 0 ? (
            <p className="text-sm text-lo">{t('car.development.none')}</p>
          ) : (
            <div className="flex flex-col gap-4">
              {active.map((project) => (
                <ProjectRow key={project.id} project={project} />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </ScreenRegion>
  );
}

function ProjectRow({ project, onInstall }: { project: RnDProject; onInstall?: () => void }) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-3 first:border-t-0 first:pt-0">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-hi">
          {t(`car.specs.parts.${project.part}`)}
          <span className="ml-2 text-2xs font-normal text-lo">
            {t('car.development.forSeason', { season: project.targetSeason })}
          </span>
        </h3>
        <span className="font-mono text-xs text-lo">
          {t(`car.development.stage.${project.stage}`)} · {Math.round(project.progress * 100)}% ·{' '}
          {t('car.development.share', { defaultValue: 'Tunnel share' })} {Math.round(project.atrShare * 100)}%
          · {project.spentM.toFixed(1)}M
        </span>
      </header>
      <Estimate
        estimate={project.expectedGain}
        label={t('car.development.gain')}
        format={(v) => t('car.development.gainPoints', { value: v.toFixed(1) })}
      />
      {onInstall && (
        <div>
          <Button size="sm" variant="primary" onClick={onInstall}>
            {t('car.upgrades.fit')}
          </Button>
          <span className="ml-2 text-2xs text-caution">
            {t('car.upgrades.greenWarning', {
              points: (balance.development.freshness.reliabilityCost * 100).toFixed(0),
            })}
          </span>
        </div>
      )}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-2xs text-lo">{label}</dt>
      <dd className="font-mono text-hi">{value}</dd>
    </div>
  );
}
