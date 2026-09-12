import { useTranslation } from 'react-i18next';
import { useCareer } from '@/app/store/career';
import { defaultRuns, useSeason } from '@/app/store/season';
import { PROGRAMMES, type ProgrammeKind } from '@/data/schema/weekend-balance';
import { balance } from '@/data/balance';
import type { Run } from '@/sim/weekend/practice';
import { PRACTICE_SESSIONS } from '@/sim/weekend/run-practice';
import { Button } from '@/ui/design/Button';
import { Panel } from '@/ui/design/Panel';
import { ScreenRegion } from '../ScreenRegion';

/**
 * Уик-энд → Программы заездов (plan 5.3, 6.2). The hour of a session against what the team wants to
 * know: a long run buys a tyre model, setup work buys lap time, and both want the same minutes.
 */
export function ProgrammesScreen() {
  const { t } = useTranslation();
  const world = useCareer((s) => s.world);
  const { programmes, setProgramme } = useSeason();
  const drivers = world.teams[world.career.playerTeamId]?.drivers.race ?? [];
  const sprintWeekend = world.season.calendar.find((r) => r.status !== 'completed')?.format === 'sprint';
  const sessions = PRACTICE_SESSIONS[sprintWeekend ? 'sprint' : 'standard'];

  return (
    <ScreenRegion section="weekend" tab="programmes">
      <div className="flex flex-col gap-4 p-4">
        <p className="max-w-3xl text-sm text-lo">{t('season.programmes.intro')}</p>

        {sessions.map((session) => (
          <Panel key={session} title={t(`season.session.${session}`)} className="max-w-3xl">
            <div className="flex flex-col gap-4 p-3">
              {drivers.map((driverId) => {
                const runs = programmes[session]?.[driverId] ?? defaultRuns(world, session);
                return (
                  <DriverRow
                    key={driverId}
                    name={world.drivers[driverId]?.name ?? driverId}
                    runs={runs}
                    minutes={minutesOf(runs)}
                    onChange={(next) => setProgramme(session, driverId, next)}
                  />
                );
              })}
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
  minutes,
  onChange,
}: {
  name: string;
  runs: readonly Run[];
  minutes: number;
  onChange: (runs: readonly Run[]) => void;
}) {
  const { t } = useTranslation();
  const budget = balance.weekend.session.practiceMinutes;

  return (
    <section className="flex flex-col gap-2 border-t border-line pt-3 first:border-t-0 first:pt-0">
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-hi">{name}</h3>
        <span className={`font-mono text-xs ${minutes > budget ? 'text-caution' : 'text-lo'}`}>
          {t('season.programmes.minutes', { used: Math.round(minutes), budget })}
        </span>
      </header>

      <ol className="flex flex-wrap gap-2">
        {runs.length === 0 && <li className="text-sm text-lo">{t('season.programmes.empty')}</li>}
        {runs.map((run, i) => (
          <li key={`${run.programme}-${i}`}>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onChange(runs.filter((_, k) => k !== i))}
              aria-label={`${t(`season.programmes.kind.${run.programme}`)} — ${t('season.programmes.clear')}`}
            >
              {t(`season.programmes.kind.${run.programme}`)} ✕
            </Button>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-2">
        {PROGRAMMES.map((kind) => (
          <Button
            key={kind}
            size="sm"
            onClick={() => onChange([...runs, { programme: kind, compound: compoundFor(kind) }])}
          >
            + {t(`season.programmes.kind.${kind}`)}
          </Button>
        ))}
      </div>
    </section>
  );
}

/** The tyre a programme normally goes out on; the player changes the programme, not the set. */
function compoundFor(kind: ProgrammeKind) {
  return kind === 'qualifying-sim'
    ? ('soft' as const)
    : kind === 'long-run'
      ? ('medium' as const)
      : ('hard' as const);
}

/**
 * Roughly what a queue of programmes costs in minutes — the same arithmetic the session runs on, at
 * a typical lap time, so the bar is honest without pretending to know this track to the second.
 */
function minutesOf(runs: readonly Run[]): number {
  const w = balance.weekend;
  const lapS = 90;
  return runs.reduce((total, run) => {
    const laps = w.programmes[run.programme]?.laps ?? 0;
    return total + w.session.boxMinutes + ((w.session.outLapShare + w.session.inLapShare + laps) * lapS) / 60;
  }, 0);
}
