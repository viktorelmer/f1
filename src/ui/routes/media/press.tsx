import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '@/ui/screens/PlaceholderScreen';

export const Route = createFileRoute('/media/press')({
  component: () => <PlaceholderScreen section="media" tab="press" />,
});
