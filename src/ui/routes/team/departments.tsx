import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '@/ui/screens/PlaceholderScreen';

export const Route = createFileRoute('/team/departments')({
  component: () => <PlaceholderScreen section="team" tab="departments" />,
});
