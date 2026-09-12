import { createFileRoute } from '@tanstack/react-router';
import { StandingsScreen } from '@/ui/screens/season/StandingsScreen';

export const Route = createFileRoute('/championship/standings')({
  component: StandingsScreen,
});
