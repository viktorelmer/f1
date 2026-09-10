import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '@/ui/screens/PlaceholderScreen';

export const Route = createFileRoute('/people/drivers')({
  component: () => <PlaceholderScreen section="people" tab="drivers" />,
});
