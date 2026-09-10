import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '@/ui/screens/PlaceholderScreen';

export const Route = createFileRoute('/championship/history')({
  component: () => <PlaceholderScreen section="championship" tab="history" />,
});
