import { createFileRoute } from '@tanstack/react-router';
import { SetupScreen } from '@/ui/screens/weekend/SetupScreen';

export const Route = createFileRoute('/weekend/setup')({
  component: SetupScreen,
});
