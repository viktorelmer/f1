import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '@/ui/screens/PlaceholderScreen';

export const Route = createFileRoute('/weekend/race')({
  component: () => <PlaceholderScreen section="weekend" tab="race" />,
});
