import { useTranslation } from 'react-i18next';
import { useCareer } from '@/app/store/career';
import { CHASSIS_PARTS } from '@/data/schema/balance';
import { carPerformance } from '@/sim/car/performance';
import { freshnessPenalty } from '@/sim/car/development';
import { Panel } from '@/ui/design/Panel';
import { Table } from '@/ui/design/Table';
import { ScreenRegion } from '../ScreenRegion';

/** Болид → Надёжность (plan 5.1, 6.2): what the newest parts on the car are costing it. */
export function ReliabilityScreen() {
  const { t } = useTranslation();
  const world = useCareer((s) => s.world);
  const team = world.teams[world.career.playerTeamId]!;
  const rated = carPerformance(team.chassis, team.engine.spec);
  const penalty = freshnessPenalty(world, team.id);
  const greenest = CHASSIS_PARTS.reduce((a, b) => (team.freshness[a] >= team.freshness[b] ? a : b));

  return (
    <ScreenRegion section="car" tab="reliability">
      <div className="flex flex-col gap-4 p-4">
        <p className="max-w-3xl text-sm text-lo">{t('car.reliability.intro')}</p>
        <Panel title={t('car.reliability.carReliability')} className="max-w-3xl">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
            <Field
              label={t('car.reliability.carReliability')}
              value={`${((rated.reliability - penalty) * 100).toFixed(1)}%`}
            />
            <Field
              label={t('car.reliability.greenest')}
              value={
                team.freshness[greenest] > 0
                  ? t(`car.specs.parts.${greenest}`)
                  : t('car.reliability.beddedIn')
              }
            />
            <Field label={t('car.reliability.cost')} value={`${(penalty * 100).toFixed(1)}%`} />
          </dl>
        </Panel>

        <Panel title={t('car.specs.part')} className="max-w-3xl" flush>
          <Table
            caption={undefined}
            rows={CHASSIS_PARTS.map((part) => ({ part, fresh: team.freshness[part] }))}
            rowKey={(row) => row.part}
            columns={[
              { key: 'part', header: t('car.specs.part'), cell: (row) => t(`car.specs.parts.${row.part}`) },
              {
                key: 'fresh',
                header: t('car.specs.fresh'),
                numeric: true,
                width: '8rem',
                cell: (row) => (row.fresh > 0 ? `${Math.round(row.fresh * 100)}%` : '—'),
              },
            ]}
          />
        </Panel>
      </div>
    </ScreenRegion>
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
