import { useTranslation } from 'react-i18next';
import { useCareer } from '@/app/store/career';
import { formatLapTime } from '@/i18n/format';
import { Estimate } from '@/ui/design/Estimate';
import { Panel } from '@/ui/design/Panel';
import { ScreenRegion } from '../ScreenRegion';
import { visibleTeamColour } from '@/ui/design/accent';

/**
 * Чемпионат → Соперники (plan 5.13, 6.6). Never a number: the team's read on everyone else's pace
 * here, as an interval with a word for how sure it is. The one Estimate component draws it, and the
 * tooltip says what would narrow it.
 */
export function RivalsScreen() {
  const { t } = useTranslation();
  const world = useCareer((s) => s.world);
  const mine = world.career.playerTeamId;
  const rivals = world.knowledge[mine]?.rivals ?? {};
  const entries = Object.entries(rivals);
  const lap = world.season.calendar.find((r) => r.status !== 'completed')?.trackId;
  const scale = entries.map(([, estimate]) => estimate.value);
  const [low, high] = [Math.min(...scale), Math.max(...scale)];

  return (
    <ScreenRegion section="championship" tab="rivals">
      <div className="p-4">
        <Panel title={t('season.rivals.title')} className="max-w-2xl">
          <div className="flex flex-col gap-3 p-3">
            <p className="text-sm text-lo">{t('season.rivals.intro')}</p>
            {entries.length === 0 ? (
              <p className="text-sm text-lo">{t('season.rivals.nothing')}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {entries
                  .sort(([, a], [, b]) => a.value - b.value)
                  .map(([teamId, estimate]) => {
                    const team = world.teams[teamId];
                    return (
                      <li key={teamId} className="flex flex-col gap-1">
                        <span className="inline-flex items-center gap-2 text-sm text-hi">
                          <span
                            aria-hidden
                            className="h-4 w-1 rounded-sm"
                            style={{ background: team ? visibleTeamColour(team.colours) : undefined }}
                          />
                          {team?.name ?? teamId}
                        </span>
                        <Estimate
                          estimate={estimate}
                          label={team?.name ?? teamId}
                          format={(value) => formatLapTime(value)}
                          min={low - 0.5}
                          max={high + 0.5}
                        />
                      </li>
                    );
                  })}
              </ul>
            )}
            {lap !== undefined && <p className="text-2xs text-lo">{t('season.table.pace')}</p>}
          </div>
        </Panel>
      </div>
    </ScreenRegion>
  );
}
