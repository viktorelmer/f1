import { Link, Outlet, useMatches } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { cn } from '@/ui/design/cn';
import { type SectionId, sectionLabelKey, tabLabelKey, tabPath, tabsOf } from '@/ui/navigation';

/** A section: its title, a strip of tabs, and the active tab's screen. */
export function SectionLayout({ section }: { section: SectionId }) {
  const { t } = useTranslation();
  const sectionLabel = t(sectionLabelKey(section));
  const fullBleed = useMatches({ select: (matches) => matches.at(-1)?.staticData.fullBleed ?? false });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-end gap-6 border-b border-line bg-panel px-4">
        <h1 className="self-center text-lg font-semibold">{sectionLabel}</h1>
        <nav aria-label={sectionLabel} className="flex h-full items-end gap-1">
          {tabsOf(section).map((tab) => (
            <Link
              key={tab}
              to={tabPath(section, tab)}
              className="-mb-px flex h-9 items-center border-b-2 px-3 text-sm transition-colors"
              activeProps={{ className: 'border-accent text-hi', 'aria-current': 'page' }}
              inactiveProps={{ className: 'border-transparent text-lo hover:text-hi' }}
            >
              {t(tabLabelKey(section, tab))}
            </Link>
          ))}
        </nav>
      </div>
      <div className={cn('min-h-0 flex-1', fullBleed ? 'overflow-hidden' : 'overflow-auto p-4')}>
        <Outlet />
      </div>
    </div>
  );
}
