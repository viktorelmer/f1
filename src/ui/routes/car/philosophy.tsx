import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '@/ui/screens/PlaceholderScreen';

export const Route = createFileRoute('/car/philosophy')({
  component: () => <PlaceholderScreen section="car" tab="philosophy" />,
});
