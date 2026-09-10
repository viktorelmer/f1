import { createRootRoute } from '@tanstack/react-router';
import { NotFoundScreen } from '@/ui/screens/NotFoundScreen';
import { AppShell } from '@/ui/shell/AppShell';

export const Route = createRootRoute({
  component: AppShell,
  notFoundComponent: NotFoundScreen,
});
