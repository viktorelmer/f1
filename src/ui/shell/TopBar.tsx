import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatGameDate, formatMoneyMillions } from '@/i18n/format';
import { Button } from '@/ui/design/Button';
import { topBarMock } from '@/ui/mocks/top-bar';

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
  const { date, nextEvent, budgetMillions, constructorsPosition } = topBarMock;

  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-line bg-panel px-4">
      <dl className="flex min-w-0 flex-1 items-stretch">
        <Stat label={t('topBar.date')}>
          <span className="font-mono">{formatGameDate(date, i18n.language)}</span>
        </Stat>
        <Stat label={t('topBar.nextEvent')}>
          {nextEvent.name}{' '}
          <span className="text-lo">· {t('topBar.inDays', { count: nextEvent.daysAway })}</span>
        </Stat>
        <Stat label={t('topBar.budget')}>
          <span className="font-mono">{formatMoneyMillions(budgetMillions, i18n.language)}</span>
        </Stat>
        <Stat label={t('topBar.constructors')}>
          <span className="font-mono">P{constructorsPosition}</span>
        </Stat>
      </dl>
      {/* The day tick arrives with the season loop (M5); until then there is nothing to advance. */}
      <Button variant="primary" disabled>
        {t('topBar.continue')}
      </Button>
    </header>
  );
}
