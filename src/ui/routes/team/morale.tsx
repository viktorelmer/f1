import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '@/ui/screens/PlaceholderScreen';

export const Route = createFileRoute('/team/morale')({
  component: () => <PlaceholderScreen section="team" tab="morale" />,
});
