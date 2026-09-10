import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '@/ui/screens/PlaceholderScreen';

export const Route = createFileRoute('/weekend/schedule')({
  component: () => <PlaceholderScreen section="weekend" tab="schedule" />,
});
