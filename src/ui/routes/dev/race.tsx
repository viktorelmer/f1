import { createFileRoute } from '@tanstack/react-router';
import { RaceScreen } from '@/ui/screens/race/RaceScreen';

/** The sandbox: any round, any seed, nothing written back — for debugging and screenshots. */
export const Route = createFileRoute('/dev/race')({
  component: RaceScreen,
  staticData: { fullBleed: true },
});
