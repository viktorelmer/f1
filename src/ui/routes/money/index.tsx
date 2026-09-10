import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/money/')({
  beforeLoad: () => {
    throw redirect({ to: '/money/budget', replace: true });
  },
});
