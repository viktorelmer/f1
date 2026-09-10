import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '@/ui/screens/PlaceholderScreen';

export const Route = createFileRoute('/championship/standings')({
  component: () => <PlaceholderScreen section="championship" tab="standings" />,
});
