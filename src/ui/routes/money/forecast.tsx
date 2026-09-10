import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '@/ui/screens/PlaceholderScreen';

export const Route = createFileRoute('/money/forecast')({
  component: () => <PlaceholderScreen section="money" tab="forecast" />,
});
