import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { initI18n } from '@/i18n';

// UI tests read English copy regardless of the machine's locale.
initI18n('en');

// jsdom gaps that Radix (floating positioning) and the router (scroll restoration) touch.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
window.scrollTo = () => {};

afterEach(() => {
  cleanup();
});
