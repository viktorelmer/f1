import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '@/ui/screens/PlaceholderScreen';

export const Route = createFileRoute('/team/infrastructure')({
  component: () => <PlaceholderScreen section="team" tab="infrastructure" />,
});
