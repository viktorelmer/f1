import { createRouter, type RouterHistory } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

/** Browser history by default; tests pass a memory history. */
export function createAppRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    ...(history && { history }),
    defaultPreload: 'intent',
    scrollRestoration: true,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
  interface StaticDataRouteOption {
    /** The screen manages its own layout and scrolling: no padding, no outer scroll (the race screen). */
    fullBleed?: boolean;
  }
}
