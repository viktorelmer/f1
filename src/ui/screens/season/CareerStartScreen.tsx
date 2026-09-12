import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { randomSeed, useCareer } from '@/app/store/career';
import type { CareerMode } from '@/sim/types/world';
import { Button } from '@/ui/design/Button';
import { Panel } from '@/ui/design/Panel';
import { visibleTeamColour } from '@/ui/design/accent';
import { Segmented } from '@/ui/screens/race/Segmented';

/**
 * Starting a career (plan 5.11, docs/systems/season.md): take over one of the pack's teams, or found
 * the twelfth. One seed for the whole playthrough — the world you start in is the same every time
 * (plan section 10), and only what happens after it depends on the seed.
 */
export function CareerStartScreen({ onStarted }: { onStarted?: () => void }) {
  const { t } = useTranslation();
  const pack = useCareer((s) => s.pack);
  const startCareer = useCareer((s) => s.startCareer);
  const nameId = useId();
  const seedId = useId();

  const [mode, setMode] = useState<CareerMode>('takeover');
  const [teamId, setTeamId] = useState(pack.teams[0]!.id);
  const [principalName, setPrincipalName] = useState(t('season.career.name'));
  const [teamName, setTeamName] = useState(t('season.career.newTeam'));
  const [seed, setSeed] = useState(randomSeed);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <Panel title={t('season.career.title')}>
        <form
          className="flex flex-col gap-4 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            startCareer(
              mode === 'takeover'
                ? { mode, teamId, principalName, seed }
                : { mode, principalName, seed, teamName },
            );
            onStarted?.();
          }}
        >
          <p className="text-sm text-lo">{t('season.career.intro')}</p>

          <Segmented
            label={t('season.career.mode')}
            value={mode}
            options={[
              { value: 'takeover', label: t('season.career.takeover') },
              { value: 'founder', label: t('season.career.founder') },
            ]}
            onChange={setMode}
          />

          {mode === 'takeover' && (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-xs text-lo">{t('season.career.team')}</legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {pack.teams.map((team) => (
                  <label
                    key={team.id}
                    className="flex items-center gap-2 rounded-sm border border-line px-2 py-1 text-sm has-checked:border-accent"
                  >
                    <input
                      type="radio"
                      name="team"
                      value={team.id}
                      checked={teamId === team.id}
                      onChange={() => setTeamId(team.id)}
                      className="accent-accent"
                    />
                    <span
                      aria-hidden
                      className="h-4 w-1 rounded-sm"
                      style={{ background: visibleTeamColour(team.colours) }}
                    />
                    <span className="text-hi">{team.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {mode === 'founder' && (
            <label className="flex flex-col gap-1 text-xs text-lo">
              {t('season.career.teamName')}
              <input
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                className="h-8 rounded-sm border border-line bg-raised px-2 text-sm text-hi"
              />
            </label>
          )}

          <label htmlFor={nameId} className="flex flex-col gap-1 text-xs text-lo">
            {t('season.career.name')}
            <input
              id={nameId}
              value={principalName}
              onChange={(e) => setPrincipalName(e.target.value)}
              className="h-8 rounded-sm border border-line bg-raised px-2 text-sm text-hi"
            />
          </label>

          <div className="flex flex-col gap-1">
            <label htmlFor={seedId} className="text-xs text-lo">
              {t('season.career.seed')}
            </label>
            <span className="flex gap-2">
              <input
                id={seedId}
                value={seed}
                spellCheck={false}
                onChange={(e) => setSeed(e.target.value)}
                className="h-8 flex-1 rounded-sm border border-line bg-raised px-2 font-mono text-sm text-hi"
              />
              <Button type="button" variant="ghost" onClick={() => setSeed(randomSeed())}>
                {t('season.career.newSeed')}
              </Button>
            </span>
          </div>

          <Button type="submit" variant="primary">
            {t('season.career.start')}
          </Button>
        </form>
      </Panel>
    </div>
  );
}
