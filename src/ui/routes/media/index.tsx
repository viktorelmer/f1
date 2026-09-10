import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/media/')({
  beforeLoad: () => {
    throw redirect({ to: '/media/press', replace: true });
  },
});
