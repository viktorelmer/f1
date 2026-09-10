import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/championship/')({
  beforeLoad: () => {
    throw redirect({ to: '/championship/standings', replace: true });
  },
});
