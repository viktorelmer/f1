import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '@/ui/screens/PlaceholderScreen';

export const Route = createFileRoute('/people/contracts')({
  component: () => <PlaceholderScreen section="people" tab="contracts" />,
});
