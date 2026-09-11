import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PlayerCommand } from '@/app/store/race';
import { balance } from '@/data/balance';
import { formatLapTime } from '@/i18n/format';
import type { CarFrame } from '@/sim/race/replay';
import type { Aggression, Compound, ErsMode, PaceMode } from '@/sim/race/types';
import { Button } from '@/ui/design/Button';
import { Estimate } from '@/ui/design/Estimate';
import { CompoundBadge } from './CompoundBadge';
import type { Roster } from './roster';
import { Segmented } from './Segmented';
import { nextPlannedStop } from './view-model';

const PACES: readonly PaceMode[] = ['push', 'neutral', 'save-tyres', 'save-fuel'];
const ERS: readonly ErsMode[] = ['attack', 'balanced', 'harvest'];
const AGGRESSION: readonly Aggression[] = ['calm', 'normal', 'aggressive'];
const COMPOUNDS: readonly Compound[] = ['soft', 'medium', 'hard', 'inter', 'wet'];
/** A new plan asks for this many more stops: as many as the strategist ever plans. */
const STOPS = Array.from({ length: balance.race.strategy.maxStops }, (_, i) => i + 1);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-lo">{label}</dt>
      <dd className="text-right font-mono text-sm tabular-nums">{children}</dd>
    </div>
  );
}

/** Box this lap on a chosen tyre. */
function BoxControl({ onBox }: { onBox: (compound: Compound) => void }) {
  const { t } = useTranslation();
  const [compound, setCompound] = useState<Compound>('hard');
  return (
    <div className="flex items-end gap-2">
      <label className="flex flex-1 flex-col gap-0.5 text-2xs text-lo">
        {t('race.pit.compound')}
        <select
          value={compound}
          onChange={(e) => setCompound(e.target.value as Compound)}
          className="h-6 rounded-sm border border-line bg-panel px-1 text-xs text-hi"
        >
          {COMPOUNDS.map((c) => (
            <option key={c} value={c}>
              {t(`race.compound.${c}`)}
            </option>
          ))}
        </select>
      </label>
      <Button size="sm" variant="primary" onClick={() => onBox(compound)}>
        {t('race.pit.box')}
      </Button>
    </div>
  );
}

/**
 * "Your drivers" (plan 6.3): position, tyres, ERS, fuel, stops, the strategist's plan with its pit
 * window and his finish forecast — an estimate, drawn by the one Estimate component — and the radio.
 * The telemetry is the team's own and shown exactly. Every control works in any delegation mode:
 * a call the engineer or strategist made can always be taken back.
 */
export const DriverPanel = memo(function DriverPanel({
  cars,
  roster,
  field,
  onCommand,
}: {
  cars: readonly CarFrame[];
  roster: Roster;
  /** Cars in the race: the scale of the forecast. */
  field: number;
  onCommand: (command: PlayerCommand) => void;
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
        const racing = car.status === 'running' || car.status === 'pit';
        const window = car.forecast?.window ?? null;
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
            {racing && car.forecast && (
              <div className="flex flex-col gap-1">
                <span className="text-2xs text-lo">{t('race.pit.forecast')}</span>
                <Estimate
                  estimate={car.forecast.position}
                  label={t('race.pit.forecast')}
                  format={(v) => t('race.pit.forecastValue', { value: Math.round(v) })}
                  min={1}
                  max={field}
                />
              </div>
            )}
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
            {racing && car.plan.length > 0 && (
              <p className="text-xs text-lo">
                {t('race.panel.plan')}:{' '}
                <span className="font-mono text-hi">
                  {car.plan
                    .map((s) => `${t(`race.compound.short.${s.compound}`)}${s.fromLap}–${s.toLap}`)
                    .join(' → ')}
                </span>
                <br />
                {window
                  ? t('race.pit.window', { from: window[0], to: window[1] })
                  : next === null
                    ? t('race.panel.noStop')
                    : t('race.panel.nextStop', { lap: next })}
              </p>
            )}
            {racing && (
              <div className="flex flex-col gap-2 border-t border-line pt-2">
                <Segmented
                  label={t('race.radio.pace.label')}
                  options={PACES.map((p) => ({ value: p, label: t(`race.radio.pace.${p}`) }))}
                  value={car.radio?.pace ?? null}
                  onChange={(pace) => onCommand({ kind: 'radio', driverId: car.driverId, radio: { pace } })}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Segmented
                    label={t('race.radio.ers.label')}
                    options={ERS.map((e) => ({ value: e, label: t(`race.radio.ers.${e}`) }))}
                    value={car.radio?.ers ?? null}
                    onChange={(ers) => onCommand({ kind: 'radio', driverId: car.driverId, radio: { ers } })}
                  />
                  <Segmented
                    label={t('race.radio.aggression.label')}
                    options={AGGRESSION.map((a) => ({ value: a, label: t(`race.radio.aggression.${a}`) }))}
                    value={car.radio?.aggression ?? null}
                    onChange={(aggression) =>
                      onCommand({ kind: 'radio', driverId: car.driverId, radio: { aggression } })
                    }
                  />
                </div>
                <BoxControl
                  onBox={(compound) => onCommand({ kind: 'pit', driverId: car.driverId, compound })}
                />
                <Segmented
                  label={t('race.pit.newPlan')}
                  options={STOPS.map((n) => ({ value: String(n), label: t('race.pit.stops', { count: n }) }))}
                  value={null}
                  onChange={(n) => onCommand({ kind: 'plan', driverId: car.driverId, stops: Number(n) })}
                />
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
});
