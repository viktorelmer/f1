import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/weekend/')({
  beforeLoad: () => {
    throw redirect({ to: '/weekend/schedule', replace: true });
  },
});
