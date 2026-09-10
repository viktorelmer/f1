import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '@/ui/screens/PlaceholderScreen';

export const Route = createFileRoute('/hq/overview')({
  component: () => <PlaceholderScreen section="hq" tab="overview" />,
});
