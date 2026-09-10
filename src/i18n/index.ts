import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import ru from './locales/ru.json';

export const LANGUAGES = ['ru', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

export const resources = { en: { translation: en }, ru: { translation: ru } } as const;

const STORAGE_KEY = 'f1.language';

function isLanguage(value: unknown): value is Language {
  return LANGUAGES.includes(value as Language);
}

/** Saved choice first, then the browser language (ru* → ru), otherwise English. */
export function detectLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLanguage(saved)) return saved;
  } catch {
    // Storage can be unavailable (private mode, blocked site data); fall through to the browser.
  }
  return navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

export function initI18n(language: Language = detectLanguage()) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: 'en',
    // Resources are bundled, so initialisation is synchronous and the first render is translated.
    initAsync: false,
    interpolation: { escapeValue: false }, // React escapes.
  });
  document.documentElement.lang = language;
  return i18n;
}

export async function setLanguage(language: Language): Promise<void> {
  await i18n.changeLanguage(language);
  document.documentElement.lang = language;
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Not persisted; the choice still applies to this session.
  }
}

export { i18n };
