import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { type SectionId, type TabId, tabLabelKey } from '@/ui/navigation';

/**
 * A screen's outer landmark, named by its tab. Every tab of the map in 6.2 is one region with the
 * tab's own name, so the shell reads the same to a screen reader as it looks (navigation.test.tsx).
 */
export function ScreenRegion<S extends SectionId>({
  section,
  tab,
  className,
  children,
}: {
  section: S;
  tab: TabId<S>;
  className?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section aria-label={t(tabLabelKey(section, tab))} className={className}>
      {children}
    </section>
  );
}
