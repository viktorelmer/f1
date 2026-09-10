import 'i18next';
import type en from './locales/en.json';

// English is the reference dictionary: keys are type-checked against it, and a test keeps ru in step.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
  }
}
