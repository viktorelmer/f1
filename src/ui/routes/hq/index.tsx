import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/hq/')({
  beforeLoad: () => {
    throw redirect({ to: '/hq/overview', replace: true });
  },
});
