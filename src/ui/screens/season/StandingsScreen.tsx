import { useTranslation } from 'react-i18next';
import { useCareer } from '@/app/store/career';
import { constructorTable, driverTable } from '@/sim/season/standings';
import { Panel } from '@/ui/design/Panel';
import { ScreenRegion } from '../ScreenRegion';
import { Table } from '@/ui/design/Table';
import { visibleTeamColour } from '@/ui/design/accent';

/**
 * Чемпионат → Таблицы (plan 6.2). Both tables are derived from the results on every render — the
 * same function the season itself uses, so what is on screen cannot disagree with what was raced
 * (docs/systems/season.md).
 */
export function StandingsScreen() {
  const { t } = useTranslation();
  const world = useCareer((s) => s.world);
  const mine = world.career.playerTeamId;
  const drivers = driverTable(world.season, Object.keys(world.drivers));
  const teams = constructorTable(
    world.season,
    Object.keys(world.teams),
    (id) => world.teams[id]!.drivers.race,
  );

  return (
    <ScreenRegion section="championship" tab="standings">
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <Panel title={t('season.standings.drivers')}>
          <Table
            rows={drivers}
            rowKey={(row) => row.id}
            columns={[
              {
                key: 'pos',
                header: t('season.table.position'),
                numeric: true,
                width: '3rem',
                cell: (r) => r.position,
              },
              {
                key: 'driver',
                header: t('season.table.driver'),
                cell: (r) => {
                  const driver = world.drivers[r.id]!;
                  const team = driver.contract ? world.teams[driver.contract.teamId] : undefined;
                  return (
                    <span className="inline-flex items-center gap-2">
                      <span
                        aria-hidden
                        className="h-4 w-1 rounded-sm"
                        style={{ background: team ? visibleTeamColour(team.colours) : undefined }}
                      />
                      <span
                        className={driver.contract?.teamId === mine ? 'font-semibold text-hi' : undefined}
                      >
                        {driver.name}
                      </span>
                    </span>
                  );
                },
              },
              {
                key: 'team',
                header: t('season.table.team'),
                cell: (r) => {
                  const teamId = world.drivers[r.id]!.contract?.teamId;
                  return teamId ? (world.teams[teamId]?.shortName ?? teamId) : '—';
                },
              },
              {
                key: 'points',
                header: t('season.table.points'),
                numeric: true,
                width: '4rem',
                cell: (r) => r.points,
              },
            ]}
          />
        </Panel>

        <Panel title={t('season.standings.constructors')}>
          <Table
            rows={teams}
            rowKey={(row) => row.id}
            columns={[
              {
                key: 'pos',
                header: t('season.table.position'),
                numeric: true,
                width: '3rem',
                cell: (r) => r.position,
              },
              {
                key: 'team',
                header: t('season.table.team'),
                cell: (r) => {
                  const team = world.teams[r.id]!;
                  return (
                    <span className="inline-flex items-center gap-2">
                      <span
                        aria-hidden
                        className="h-4 w-1 rounded-sm"
                        style={{ background: visibleTeamColour(team.colours) }}
                      />
                      <span className={r.id === mine ? 'font-semibold text-hi' : undefined}>{team.name}</span>
                    </span>
                  );
                },
              },
              {
                key: 'points',
                header: t('season.table.points'),
                numeric: true,
                width: '4rem',
                cell: (r) => r.points,
              },
            ]}
          />
        </Panel>
      </div>
    </ScreenRegion>
  );
}
