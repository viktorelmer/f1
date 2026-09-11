import type { TFunction } from 'i18next';
import type { Compound, RaceEvent } from '@/sim/race/types';
import type { Roster } from './roster';

const REASONS = [
  'crash',
  'collision',
  'puncture',
  'debris',
  'power-unit failure',
  'chassis failure',
] as const;
const TRIGGERS = ['safety-car', 'weather', 'damage', 'puncture'] as const;
const COMPOUNDS: readonly Compound[] = ['soft', 'medium', 'hard', 'inter', 'wet'];

type Detail = string | number | undefined;

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  list.includes(value as T);

/**
 * One line of the race feed for an event — every kind the simulation can emit has a sentence, so
 * everything that happened in the race reads on screen (M3 DoD).
 */
export function describeEvent(event: RaceEvent, roster: Roster, t: TFunction): string {
  const name = (id: string | null) => (id === null ? '—' : (roster.get(id)?.short ?? id));
  const driver = name(event.driverId);
  const other = name(event.otherId);
  const d = event.detail;
  const reason = (value: Detail) =>
    isOneOf(REASONS, value) ? t(`race.reason.${value}`) : String(value ?? '');
  const compound = (value: Detail) =>
    isOneOf(COMPOUNDS, value) ? t(`race.compound.${value}`) : String(value ?? '');
  const seconds = (value: Detail) => (typeof value === 'number' ? value.toFixed(1) : String(value ?? ''));

  switch (event.kind) {
    case 'start':
      return t('race.events.start', { cars: d.cars });
    case 'overtake':
      return t(d.drs === 1 ? 'race.events.overtakeDrs' : 'race.events.overtake', { driver, other });
    case 'launch':
      return d.bad === 1
        ? t('race.events.launchBad', { driver })
        : t('race.events.launch', { driver, count: Number(d.places) });
    case 'defence':
      return t('race.events.defence', { driver, other });
    case 'pit':
      return t(d.slow === 1 ? 'race.events.pitSlow' : 'race.events.pit', {
        driver,
        from: compound(d.from),
        to: compound(d.to),
        stationary: seconds(d.stationaryS),
      });
    case 'safety-car':
      return t('race.events.safety-car', { cause: reason(d.cause) });
    case 'safety-car-in':
      return t('race.events.safety-car-in');
    case 'vsc':
      return t('race.events.vsc', { cause: reason(d.cause) });
    case 'vsc-end':
      return t('race.events.vsc-end');
    case 'drs-enabled':
      return t('race.events.drs-enabled');
    case 'mistake':
      return t('race.events.mistake', { driver, loss: seconds(d.lossS) });
    case 'spin':
      return t('race.events.spin', { driver, loss: seconds(d.lossS) });
    case 'crash':
      return t('race.events.crash', { driver });
    case 'contact':
      return d.phase === 'start'
        ? t('race.events.contactStart', { driver })
        : t('race.events.contact', { driver, other });
    case 'failure': {
      const component =
        d.component === 'power-unit' || d.component === 'chassis'
          ? t(`race.events.component.${d.component}`)
          : String(d.component);
      return t(d.severity === 'partial' ? 'race.events.failurePartial' : 'race.events.failure', {
        driver,
        component,
      });
    }
    case 'puncture':
      return t('race.events.puncture', { driver });
    case 'retirement':
      return t('race.events.retirement', { driver, reason: reason(d.reason) });
    case 'rain-start':
      return t('race.events.rain-start');
    case 'rain-stop':
      return t('race.events.rain-stop');
    case 'strategy-call': {
      const trigger = isOneOf(TRIGGERS, d.trigger) ? t(`race.trigger.${d.trigger}`) : String(d.trigger);
      return d.call === 'pit'
        ? t('race.events.strategyPit', { driver, compound: compound(d.compound), trigger })
        : t('race.events.strategyStay', { driver, trigger });
    }
    case 'chequered-flag':
      return t('race.events.chequered-flag', { driver });
  }
}
