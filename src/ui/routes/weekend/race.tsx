import { createFileRoute } from '@tanstack/react-router';
import { SessionScreen } from '@/ui/screens/weekend/SessionScreen';

export const Route = createFileRoute('/weekend/race')({
  component: SessionScreen,
  staticData: { fullBleed: true },
});
