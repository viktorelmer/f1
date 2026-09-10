import { useTranslation } from 'react-i18next';
import { Panel } from '@/ui/design/Panel';
import { type SectionId, type TabId, tabLabelKey } from '@/ui/navigation';

/** Stands in for a screen until the milestone that builds its system replaces it. */
export function PlaceholderScreen<S extends SectionId>({ section, tab }: { section: S; tab: TabId<S> }) {
  const { t } = useTranslation();

  return (
    <Panel title={t(tabLabelKey(section, tab))} className="max-w-3xl">
      <p className="text-sm text-lo">{t('placeholder.body')}</p>
    </Panel>
  );
}
