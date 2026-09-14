import { useTranslation } from 'react-i18next';
import { useCareer } from '@/app/store/career';
import { CHASSIS_PARTS } from '@/data/schema/balance';
import { carPerformance } from '@/sim/car/performance';
import { freshnessPenalty } from '@/sim/car/development';
import { Panel } from '@/ui/design/Panel';
import { Table } from '@/ui/design/Table';
import { ScreenRegion } from '../ScreenRegion';

/** Болид → Характеристики (plan 6.2): the team's own car, in the team's own numbers. */
export function CarSpecsScreen() {
  const { t } = useTranslation();
  const world = useCareer((s) => s.world);
  const team = world.teams[world.career.playerTeamId]!;
  const rated = carPerformance(team.chassis, team.engine.spec);
  const car = { ...rated, reliability: rated.reliability - freshnessPenalty(world, team.id) };

  return (
    <ScreenRegion section="car" tab="specs">
      <div className="flex flex-wrap gap-4 p-4">
        <Panel title={t('car.specs.title')} className="w-[26rem]" flush>
          <Table
            caption={undefined}
            rows={Object.entries(car)}
            rowKey={([key]) => key}
            columns={[
              {
                key: 'name',
                header: t('car.specs.characteristic'),
                cell: ([key]) => t(`car.specs.characteristics.${key}` as 'car.specs.title'),
              },
              {
                key: 'value',
                header: t('car.specs.value'),
                numeric: true,
                width: '6rem',
                cell: ([key, value]) =>
                  key === 'reliability' ? `${(value * 100).toFixed(1)}%` : value.toFixed(1),
              },
            ]}
          />
        </Panel>

        <Panel title={t('car.specs.part')} className="w-[22rem]" flush>
          <Table
            caption={undefined}
            rows={CHASSIS_PARTS.map((part) => ({
              part,
              rating: team.chassis[part],
              fresh: team.freshness[part],
            }))}
            rowKey={(row) => row.part}
            columns={[
              {
                key: 'part',
                header: t('car.specs.part'),
                cell: (row) => (
                  <span>
                    {t(`car.specs.parts.${row.part}`)}
                    {row.fresh > 0 && (
                      <span className="ml-2 text-2xs text-caution">{t('car.specs.fresh')}</span>
                    )}
                  </span>
                ),
              },
              {
                key: 'rating',
                header: t('car.specs.rating'),
                numeric: true,
                width: '5rem',
                cell: (row) => row.rating.toFixed(1),
              },
            ]}
          />
        </Panel>
        <p className="w-full max-w-3xl text-sm text-lo">{t('car.specs.intro')}</p>
      </div>
    </ScreenRegion>
  );
}
