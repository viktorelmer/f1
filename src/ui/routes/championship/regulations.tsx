import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '@/ui/screens/PlaceholderScreen';

export const Route = createFileRoute('/championship/regulations')({
  component: () => <PlaceholderScreen section="championship" tab="regulations" />,
});
