import { type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useCareer } from '@/app/store/career';
import { formatGameDate, formatMoneyMillions } from '@/i18n/format';
import { Button } from '@/ui/design/Button';
import { topBarData } from './top-bar-data';

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col justify-center border-l border-line px-4 first:border-l-0 first:pl-0">
      <dt className="text-2xs text-lo">{label}</dt>
      <dd className="truncate text-sm text-hi">{children}</dd>
    </div>
  );
}

export function TopBar() {
  const { t, i18n } = useTranslation();
  const world = useCareer((s) => s.world);
  const pack = useCareer((s) => s.pack);
  const { date, nextEvent, cashM, constructorsPosition } = useMemo(
    () => topBarData(world, pack),
    [world, pack],
  );

  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-line bg-panel px-4">
      <dl className="flex min-w-0 flex-1 items-stretch">
        <Stat label={t('topBar.date')}>
          <span className="font-mono">{formatGameDate(date, i18n.language)}</span>
        </Stat>
        <Stat label={t('topBar.nextEvent')}>
          {nextEvent ? (
            <>
              {nextEvent.kind === 'test'
                ? t('topBar.test', { track: nextEvent.track })
                : t('topBar.race', { round: nextEvent.round, track: nextEvent.track })}{' '}
              <span className="text-lo">· {t('topBar.inDays', { count: nextEvent.daysAway })}</span>
            </>
          ) : (
            '—'
          )}
        </Stat>
        <Stat label={t('topBar.budget')}>
          <span className="font-mono">{formatMoneyMillions(cashM, i18n.language)}</span>
        </Stat>
        <Stat label={t('topBar.constructors')}>
          <span className="font-mono">
            {constructorsPosition === null ? '—' : `P${constructorsPosition}`}
          </span>
        </Stat>
      </dl>
      {/* The day tick arrives with the season loop (M5); until then there is nothing to advance. */}
      <Button variant="primary" disabled>
        {t('topBar.continue')}
      </Button>
    </header>
  );
}
