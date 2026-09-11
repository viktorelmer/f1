import { createFileRoute } from '@tanstack/react-router';
import { RaceScreen } from '@/ui/screens/race/RaceScreen';

export const Route = createFileRoute('/weekend/race')({
  component: RaceScreen,
  staticData: { fullBleed: true },
});
