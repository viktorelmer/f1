import { useTranslation } from 'react-i18next';
import { useCareer } from '@/app/store/career';
import { useWeekend } from '@/app/store/weekend';
import { balance } from '@/data/balance';
import { SETUP_PARAMETERS, type SetupParameter } from '@/data/schema/pack';
import { openParameters, SETUP_LEVEL, type SetupLevel, setupLevelOf } from '@/sim/car/setup';
import { canDelegate, type DelegationMode } from '@/sim/decide/delegation';
import { capabilityOf } from '@/sim/weekend/setup-work';
import { setupOptions } from '@/sim/weekend/setup-choice';
import type { DriverId, SetupNote, SetupReading } from '@/sim/types/world';
import { Button } from '@/ui/design/Button';
import { cn } from '@/ui/design/cn';
import { Panel } from '@/ui/design/Panel';
import { Tooltip } from '@/ui/design/Tooltip';
import { Segmented } from '../race/Segmented';
import { ScreenRegion } from '../ScreenRegion';

const LEVELS: readonly SetupLevel[] = ['base', 'mechanical', 'fine'];
const MODES: readonly DelegationMode[] = ['manual', 'directed', 'delegated'];

/**
 * Уик-энд → Сетап (plan 5.2, 6.4): nine sliders, the engineer's range drawn on the ones this car
 * may touch, the factory preset locked on the ones it may not, and what the driver said last time.
 */
export function SetupScreen() {
  const { t } = useTranslation();
  const world = useCareer((s) => s.world);
  const drivers = world.teams[world.career.playerTeamId]?.drivers.race ?? [];

  return (
    <ScreenRegion section="weekend" tab="setup">
      <div className="flex flex-col gap-4 p-4">
        <p className="max-w-3xl text-sm text-lo">{t('weekend.setup.intro')}</p>
        <Delegation />
        {!world.weekend ? (
          <p className="text-sm text-caution">{t('weekend.setup.notOpen')}</p>
        ) : (
          <div className="flex flex-wrap gap-4">
            {drivers.map((driverId) => (
              <CarSetup key={driverId} driverId={driverId} />
            ))}
          </div>
        )}
      </div>
    </ScreenRegion>
  );
}

/** Who dials the car in (plan 6.5): the switch stands on the screen where the work happens. */
function Delegation() {
  const { t } = useTranslation();
  const world = useCareer((s) => s.world);
  const setDelegation = useWeekend((s) => s.setDelegation);
  const mode = world.career.delegation.setup;
  const roles = new Set(
    (world.teams[world.career.playerTeamId]?.staffIds ?? []).map((id) => world.staff[id]!.role),
  );

  return (
    <div className="flex max-w-3xl flex-col gap-1">
      <Segmented
        label={t('weekend.setup.delegation')}
        options={MODES.map((m) => ({ value: m, label: t(`race.control.mode.${m}`) }))}
        disabledValues={canDelegate('setup', roles) ? [] : (['directed', 'delegated'] as DelegationMode[])}
        value={mode}
        onChange={(next) => setDelegation('setup', next)}
      />
      {mode === 'manual' && <p className="text-2xs text-lo">{t('weekend.setup.manualNote')}</p>}
    </div>
  );
}

function CarSetup({ driverId }: { driverId: DriverId }) {
  const { t } = useTranslation();
  const world = useCareer((s) => s.world);
  const pack = useCareer((s) => s.pack);
  const { setSetup } = useWeekend();
  const teamId = world.career.playerTeamId;
  const weekend = world.weekend!;
  const round = world.season.calendar.find((r) => r.round === weekend.round)!;
  const track = pack.tracks.find((tr) => tr.id === round.trackId)!;
  const capability = capabilityOf(world, teamId, driverId);
  const open = openParameters(capability);
  const level = setupLevelOf(capability);
  const setup = weekend.setups[driverId] ?? track.factorySetup;
  const reading = world.knowledge[teamId]?.weekend?.setup[driverId]?.reading;
  const notes = weekend.notes[driverId] ?? [];

  const mate = world.teams[teamId]?.drivers.race.find((id) => id !== driverId);
  const sources = reading
    ? setupOptions({
        reading,
        factory: track.factorySetup,
        current: setup,
        notes,
        teamMate: mate ? weekend.setups[mate] : undefined,
        capability,
      })
    : [];

  return (
    <Panel title={world.drivers[driverId]?.name ?? driverId} className="w-[26rem]">
      <div className="flex flex-col gap-4">
        {LEVELS.map((group) => (
          <section key={group} className="flex flex-col gap-2">
            <header className="flex items-baseline justify-between gap-2">
              <h3 className="text-xs font-semibold text-lo uppercase">{t(`weekend.setup.level.${group}`)}</h3>
              {group !== 'base' && LEVELS.indexOf(group) > LEVELS.indexOf(level) && (
                <Tooltip content={lockedHint(t, group)}>
                  <span tabIndex={0} className="text-2xs text-caution">
                    🔒
                  </span>
                </Tooltip>
              )}
            </header>
            {SETUP_PARAMETERS.filter((p) => SETUP_LEVEL[p] === group).map((parameter) => (
              <Slider
                key={parameter}
                parameter={parameter}
                value={setup[parameter]}
                reading={reading}
                open={open.has(parameter)}
                onChange={(value) => setSetup(driverId, { ...setup, [parameter]: value })}
              />
            ))}
          </section>
        ))}

        <section className="flex flex-col gap-2 border-t border-line pt-3">
          <h3 className="text-xs font-semibold text-lo uppercase">{t('weekend.setup.notes.title')}</h3>
          {notes.length === 0 ? (
            <p className="text-sm text-lo">{t('weekend.setup.notes.none')}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm text-hi">
              {notes.map((note, i) => (
                <li key={i}>« {noteText(t, note)} »</li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          {sources
            .filter((option) => option.source !== 'driver-note' && option.source !== 'stay')
            .map((option) => (
              <Button key={option.source} size="sm" onClick={() => setSetup(driverId, option.setup)}>
                {t(`weekend.setup.source.${option.source}`)}
              </Button>
            ))}
        </div>
      </div>
    </Panel>
  );
}

/** One slider, with the engineer's range drawn on the scale when he has one to give. */
function Slider({
  parameter,
  value,
  reading,
  open,
  onChange,
}: {
  parameter: SetupParameter;
  value: number;
  reading: SetupReading | undefined;
  open: boolean;
  onChange: (value: number) => void;
}) {
  const { t } = useTranslation();
  const band = open ? reading?.[parameter] : undefined;
  const label = t(`weekend.setup.parameter.${parameter}`);

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className={open ? 'text-hi' : 'text-lo'}>{label}</span>
        <span className="font-mono text-lo tabular-nums">
          {Math.round(value)}
          {band && (
            <span className="ml-2 text-2xs">
              {t('weekend.setup.recommendation', {
                low: Math.round(band.low),
                high: Math.round(band.high),
              })}
            </span>
          )}
        </span>
      </div>
      <div className="relative h-4">
        {band && (
          <div
            aria-hidden
            className="pointer-events-none absolute top-1.5 h-1 rounded-sm bg-accent/30"
            style={{ left: `${band.low}%`, width: `${Math.max(1, band.high - band.low)}%` }}
          />
        )}
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(value)}
          disabled={!open}
          aria-label={label}
          onChange={(e) => onChange(Number(e.target.value))}
          className={cn('relative w-full accent-accent', !open && 'opacity-40')}
        />
      </div>
    </div>
  );
}

function lockedHint(t: ReturnType<typeof useTranslation>['t'], level: SetupLevel): string {
  const a = balance.setup.access;
  return level === 'mechanical'
    ? t('weekend.setup.locked.mechanical', { engineer: a.mechanicEngineer, simulator: a.mechanicSimulator })
    : t('weekend.setup.locked.fine', {
        engineer: a.fineEngineer,
        simulator: a.fineSimulator,
        feedback: a.fineFeedback,
      });
}

/** What the driver said, in his words: the note points at a slider and a direction, never a number. */
function noteText(t: ReturnType<typeof useTranslation>['t'], note: SetupNote): string {
  return t(`weekend.setup.note.${note.parameter}.${note.direction}` as 'weekend.setup.notes.none');
}
