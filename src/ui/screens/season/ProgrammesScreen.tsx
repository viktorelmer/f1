import { useTranslation } from 'react-i18next';
import { useCareer } from '@/app/store/career';
import { pendingRound } from '@/app/store/season';
import { runsOf, useWeekend } from '@/app/store/weekend';
import { PRACTICE_SESSIONS } from '@/sim/season/weekend';
import type { Run } from '@/sim/weekend/practice';
import { Panel } from '@/ui/design/Panel';
import { RunQueue } from '../weekend/RunQueue';
import { ScreenRegion } from '../ScreenRegion';

/**
 * Уик-энд → Программы заездов (plan 5.3, 6.2). The hour of a session against what the team wants to
 * know: a long run buys a tyre model, setup work buys lap time, and both want the same minutes.
 * Chosen before the weekend opens, and rewritten up to the moment a session is run.
 */
export function ProgrammesScreen() {
  const { t } = useTranslation();
  const world = useCareer((s) => s.world);
  const { draft, setProgramme } = useWeekend();
  const drivers = world.teams[world.career.playerTeamId]?.drivers.race ?? [];
  const round = world.weekend?.round ?? pendingRound(world);
  const weekend = world.season.calendar.find((r) => r.round === round);
  const sessions = PRACTICE_SESSIONS[weekend?.format ?? 'standard'];
  const ran = new Set(weekend?.sessions.map((s) => s.session) ?? []);

  return (
    <ScreenRegion section="weekend" tab="programmes">
      <div className="flex flex-col gap-4 p-4">
        <p className="max-w-3xl text-sm text-lo">{t('season.programmes.intro')}</p>

        {sessions.map((session) => (
          <Panel
            key={session}
            title={t(`season.session.${session}`)}
            actions={
              ran.has(session) ? (
                <span className="text-2xs text-lo">{t('season.schedule.status.done')}</span>
              ) : undefined
            }
            className="max-w-3xl"
          >
            <div className="flex flex-col gap-4">
              {drivers.map((driverId) => (
                <DriverRow
                  key={driverId}
                  name={world.drivers[driverId]?.name ?? driverId}
                  runs={runsOf(world, draft, session, driverId)}
                  done={ran.has(session)}
                  onChange={(next) => setProgramme(session, driverId, next)}
                />
              ))}
            </div>
          </Panel>
        ))}
      </div>
    </ScreenRegion>
  );
}

function DriverRow({
  name,
  runs,
  done,
  onChange,
}: {
  name: string;
  runs: readonly Run[];
  done: boolean;
  onChange: (runs: readonly Run[]) => void;
}) {
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-3 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold text-hi">{name}</h3>
      <RunQueue runs={runs} onChange={onChange} disabled={done} />
    </section>
  );
}
