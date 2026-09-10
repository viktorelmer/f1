import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, type Language, setLanguage } from '@/i18n';
import { cn } from '@/ui/design/cn';
import { SECTION_IDS, sectionLabelKey, sectionPath } from '@/ui/navigation';

const LINK = 'flex h-8 items-center border-l-2 px-3 text-sm transition-colors';
const LINK_IDLE = 'border-transparent text-lo hover:bg-raised hover:text-hi';
const LINK_ACTIVE = 'border-accent bg-raised text-hi';

export function Sidebar() {
  const { t, i18n } = useTranslation();

  return (
    <aside className="flex w-44 shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex h-12 items-center border-b border-line px-3 text-sm font-semibold tracking-wide">
        {t('app.title')}
      </div>

      <nav aria-label={t('nav.label')} className="flex flex-1 flex-col py-2">
        {SECTION_IDS.map((section) => (
          <Link
            key={section}
            to={sectionPath(section)}
            className={LINK}
            activeProps={{ className: LINK_ACTIVE, 'aria-current': 'page' }}
            inactiveProps={{ className: LINK_IDLE }}
          >
            {t(sectionLabelKey(section))}
          </Link>
        ))}
      </nav>

      <div className="flex flex-col gap-2 border-t border-line p-3">
        <Link to="/dev/components" className="text-xs text-lo hover:text-hi">
          {t('nav.components')}
        </Link>
        <div role="group" aria-label={t('nav.language')} className="flex gap-1">
          {LANGUAGES.map((language: Language) => (
            <button
              key={language}
              type="button"
              aria-pressed={i18n.language === language}
              onClick={() => void setLanguage(language)}
              className={cn(
                'h-6 rounded-sm border px-2 font-mono text-2xs uppercase',
                i18n.language === language
                  ? 'border-line-strong bg-raised text-hi'
                  : 'border-transparent text-lo hover:text-hi',
              )}
            >
              {language}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
