import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { randomSeed, useCareer } from '@/app/store/career';
import { useRace } from '@/app/store/race';
import { Button } from '@/ui/design/Button';
import { Panel } from '@/ui/design/Panel';

/** Before the lights: which round, which seed. */
export function RaceSetup() {
  const { t } = useTranslation();
  const world = useCareer((s) => s.world);
  const pack = useCareer((s) => s.pack);
  const { round, seed, phase, error, setRound, setSeed, start } = useRace();
  const seedId = useId();

  return (
    <div className="p-4">
      <Panel title={t('race.setup.title')} className="max-w-xl">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          <p className="text-sm text-lo">{t('race.setup.intro')}</p>
          <label className="flex flex-col gap-1 text-xs text-lo">
            {t('race.setup.round')}
            <select
              value={round}
              onChange={(e) => setRound(Number(e.target.value))}
              className="h-8 rounded-sm border border-line bg-raised px-2 text-sm text-hi"
            >
              {world.season.calendar.map((r) => {
                const track = pack.tracks.find((tr) => tr.id === r.trackId);
                return (
                  <option key={r.round} value={r.round}>
                    {t('race.setup.roundOption', { round: r.round, track: track?.name ?? r.trackId })}
                    {r.format === 'sprint' ? ` · ${t('race.setup.sprint')}` : ''}
                  </option>
                );
              })}
            </select>
          </label>
          <div className="flex flex-col gap-1">
            <label htmlFor={seedId} className="text-xs text-lo">
              {t('race.setup.seed')}
            </label>
            <span className="flex gap-2">
              <input
                id={seedId}
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                spellCheck={false}
                className="h-8 flex-1 rounded-sm border border-line bg-raised px-2 font-mono text-sm text-hi"
              />
              <Button type="button" variant="ghost" onClick={() => setSeed(randomSeed())}>
                {t('race.setup.newSeed')}
              </Button>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" disabled={phase === 'loading' || seed.trim() === ''}>
              {phase === 'loading' ? t('race.setup.loading') : t('race.setup.start')}
            </Button>
            {phase === 'error' && (
              <span role="alert" className="text-sm text-negative">
                {t('race.setup.error', { message: error ?? '' })}
              </span>
            )}
          </div>
        </form>
      </Panel>
    </div>
  );
}
