import { useTranslation } from 'react-i18next';
import { useCareer } from '@/app/store/career';
import { pendingRound } from '@/app/store/season';
import { pendingStage, useWeekend } from '@/app/store/weekend';
import { balance } from '@/data/balance';
import type { DryCompound } from '@/data/schema/race-balance';
import type { DriverId, TyreAllocation } from '@/sim/types/world';
import { Button } from '@/ui/design/Button';
import { cn } from '@/ui/design/cn';
import { Panel } from '@/ui/design/Panel';
import { ControlBar } from '../race/ControlBar';
import { ScreenRegion } from '../ScreenRegion';
import { PlanStep } from './PlanStep';

const COMPOUNDS: readonly DryCompound[] = ['soft', 'medium', 'hard'];

/**
 * Уик-энд → Стратегия (plan 6.5, docs/systems/weekend-play.md): the three decisions taken away from
 * the track — what tyres the cars declare for the weekend, what plan Sunday starts on, and who
 * makes the calls once it does.
 */
export function StrategyScreen() {
  const { t } = useTranslation();
  const world = useCareer((s) => s.world);
  const stage = pendingStage(world);

  return (
    <ScreenRegion section="weekend" tab="strategy">
      <div className="flex flex-col gap-4 p-4">
        <TyreEntry />
        <Panel title={t('race.planStep.title')} className="max-w-3xl">
          {stage === 'race' || stage === 'sprint' ? (
            <PlanStep />
          ) : (
            <p className="text-sm text-lo">{t('weekend.strategy.planLater')}</p>
          )}
        </Panel>
        <div className="flex max-w-3xl flex-col border border-line bg-panel">
          <h2 className="flex h-9 shrink-0 items-center border-b border-line px-3 text-sm font-semibold text-hi">
            {t('weekend.strategy.delegation')}
          </h2>
          <ControlBar inRace={false} label={t('weekend.strategy.delegation')} />
        </div>
      </div>
    </ScreenRegion>
  );
}

/**
 * The tyre entry (plan 5.3): declared before the weekend, blind to the weather, and spent for real.
 * The strategist has already made his declaration — this is the player taking it over.
 */
function TyreEntry() {
  const { t } = useTranslation();
  const world = useCareer((s) => s.world);
  const pack = useCareer((s) => s.pack);
  const { setEntry } = useWeekend();
  const drivers = world.teams[world.career.playerTeamId]?.drivers.race ?? [];
  const weekend = world.weekend;
  const round = world.season.calendar.find((r) => r.round === (weekend?.round ?? pendingRound(world)));
  const regulation = pack.regulations.find((r) => r.season === world.season.year) ?? pack.regulations[0]!;
  const limit = round ? regulation.tyreSetsPerWeekend[round.format] : 0;
  // Once a session has run the sets are spent, not declared.
  const locked = !weekend || (round?.sessions.length ?? 0) > 0;

  return (
    <Panel title={t('weekend.entry.title')} className="max-w-3xl">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-lo">{t('weekend.entry.intro', { limit })}</p>
        {!weekend && <p className="text-sm text-caution">{t('weekend.entry.notOpen')}</p>}
        {weekend &&
          drivers.map((driverId) => (
            <CarEntry
              key={driverId}
              driverId={driverId}
              entry={weekend.tyres[driverId] ?? { soft: 0, medium: 0, hard: 0 }}
              limit={limit}
              locked={locked}
              onChange={(entry) => setEntry(driverId, entry)}
            />
          ))}
      </div>
    </Panel>
  );
}

function CarEntry({
  driverId,
  entry,
  limit,
  locked,
  onChange,
}: {
  driverId: DriverId;
  entry: TyreAllocation;
  limit: number;
  locked: boolean;
  onChange: (entry: TyreAllocation) => void;
}) {
  const { t } = useTranslation();
  const world = useCareer((s) => s.world);
  const min = balance.weekend.tyres.minPerCompound;
  const total = COMPOUNDS.reduce((sum, c) => sum + entry[c], 0);

  return (
    <section className="flex flex-col gap-2 border-t border-line pt-3 first:border-t-0 first:pt-0">
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-hi">{world.drivers[driverId]?.name ?? driverId}</h3>
        <span className={cn('font-mono text-xs', total === limit ? 'text-lo' : 'text-caution')}>
          {t('weekend.entry.total', { total, limit })}
        </span>
      </header>
      <div className="flex flex-wrap gap-4">
        {COMPOUNDS.map((compound) => (
          <div key={compound} className="flex items-center gap-2">
            <span className="w-20 text-sm text-lo">{t(`race.compound.${compound}`)}</span>
            <Button
              size="sm"
              aria-label={t('weekend.entry.fewer', { compound: t(`race.compound.${compound}`) })}
              disabled={locked || entry[compound] <= min}
              onClick={() => onChange({ ...entry, [compound]: entry[compound] - 1 })}
            >
              −
            </Button>
            <span className="w-6 text-center font-mono text-sm text-hi">{entry[compound]}</span>
            <Button
              size="sm"
              aria-label={t('weekend.entry.more', { compound: t(`race.compound.${compound}`) })}
              disabled={locked || total >= limit}
              onClick={() => onChange({ ...entry, [compound]: entry[compound] + 1 })}
            >
              +
            </Button>
          </div>
        ))}
      </div>
      {locked && <p className="text-2xs text-lo">{t('weekend.entry.locked')}</p>}
    </section>
  );
}
