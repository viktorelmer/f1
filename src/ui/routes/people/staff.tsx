import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '@/ui/screens/PlaceholderScreen';

export const Route = createFileRoute('/people/staff')({
  component: () => <PlaceholderScreen section="people" tab="staff" />,
});
