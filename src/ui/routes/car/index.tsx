import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/car/')({
  beforeLoad: () => {
    throw redirect({ to: '/car/specs', replace: true });
  },
});
