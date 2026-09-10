import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '@/ui/screens/PlaceholderScreen';

export const Route = createFileRoute('/car/development')({
  component: () => <PlaceholderScreen section="car" tab="development" />,
});
