import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '@/ui/screens/PlaceholderScreen';

export const Route = createFileRoute('/money/cost-cap')({
  component: () => <PlaceholderScreen section="money" tab="cost-cap" />,
});
