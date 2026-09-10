import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

export function NotFoundScreen() {
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col items-start gap-2 p-6">
      <h1 className="text-xl font-semibold">{t('notFound.title')}</h1>
      <Link to="/hq/overview" className="text-sm text-lo underline hover:text-hi">
        {t('notFound.back')}
      </Link>
    </div>
  );
}
