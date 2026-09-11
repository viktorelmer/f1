import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatLapTime } from '@/i18n/format';
import type { CarFrame } from '@/sim/race/replay';
import { CompoundBadge } from './CompoundBadge';
import type { Roster } from './roster';
import { nextPlannedStop } from './view-model';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-lo">{label}</dt>
      <dd className="text-right font-mono text-sm tabular-nums">{children}</dd>
    </div>
  );
}

/**
 * "Your drivers" (plan 6.3): position, tyres, ERS, fuel, stops and the strategist's plan — the
 * team's own telemetry, shown exactly. Radio buttons and the finish forecast arrive with M4.
 */
export const DriverPanel = memo(function DriverPanel({
  cars,
  roster,
}: {
  cars: readonly CarFrame[];
  roster: Roster;
}) {
  const { t } = useTranslation();
  const mine = cars.filter((c) => roster.get(c.driverId)?.isPlayer);

  return (
    <section aria-label={t('race.panel.title')} className="flex flex-col gap-3 p-3">
      <h2 className="text-sm font-semibold">{t('race.panel.title')}</h2>
      {mine.map((car) => {
        const who = roster.get(car.driverId)!;
        const lapsDone = Math.max(0, Math.floor(car.progress));
        const next = nextPlannedStop(car.plan, lapsDone);
        return (
          <article
            key={car.driverId}
            aria-label={who.short}
            className="flex flex-col gap-2 border border-line bg-raised p-3"
          >
            <header className="flex items-center gap-2">
              <span className="font-mono text-xl font-semibold">
                {t('race.panel.position', { position: car.position })}
              </span>
              <span aria-hidden className="h-5 w-1 rounded-sm" style={{ background: who.colour }} />
              <span className="text-lg font-semibold">{who.short}</span>
            </header>
            <dl className="flex flex-col gap-1">
              <Row label={t('race.panel.tyre')}>
                <span className="inline-flex items-center gap-1.5">
                  <CompoundBadge compound={car.compound} />
                  {t('race.panel.tyreValue', {
                    age: car.tyreAge,
                    life: Math.max(0, Math.round((1 - car.tyreWear) * 100)),
                  })}
                </span>
              </Row>
              <Row label={t('race.panel.ers')}>{Math.round(car.battery * 100)}%</Row>
              <Row label={t('race.panel.fuel')}>
                {t('race.panel.fuelValue', { kg: car.fuelKg.toFixed(1) })}
              </Row>
              <Row label={t('race.panel.stops')}>{car.stops}</Row>
              <Row label={t('race.panel.lastLap')}>
                {car.lastLapS === null ? '—' : formatLapTime(car.lastLapS)}
              </Row>
              <Row label={t('race.panel.bestLap')}>
                {car.bestLapS === null ? '—' : formatLapTime(car.bestLapS)}
              </Row>
            </dl>
            {car.status !== 'retired' && car.status !== 'finished' && car.plan.length > 0 && (
              <p className="text-xs text-lo">
                {t('race.panel.plan')}:{' '}
                <span className="font-mono text-hi">
                  {car.plan
                    .map((s) => `${t(`race.compound.short.${s.compound}`)}${s.fromLap}–${s.toLap}`)
                    .join(' → ')}
                </span>
                <br />
                {next === null ? t('race.panel.noStop') : t('race.panel.nextStop', { lap: next })}
              </p>
            )}
          </article>
        );
      })}
      <p className="text-2xs text-lo">{t('race.panel.forecastLater')}</p>
    </section>
  );
});
