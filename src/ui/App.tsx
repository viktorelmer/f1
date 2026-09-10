import { RouterProvider } from '@tanstack/react-router';
import { TooltipProvider } from './design/Tooltip';
import type { createAppRouter } from './router';

export function App({ router }: { router: ReturnType<typeof createAppRouter> }) {
  return (
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>
  );
}
