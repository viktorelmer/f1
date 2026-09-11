import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { setRaceEngine } from '@/app/store/race';
import { createInlineEngine } from '@/app/worker/engine';
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

// jsdom has no workers: every UI test runs the race engine in-process unless it swaps in its own.
setRaceEngine(createInlineEngine());

afterEach(() => {
  cleanup();
});
