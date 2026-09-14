import { createFileRoute } from '@tanstack/react-router';
import { DevelopmentScreen } from '@/ui/screens/car/DevelopmentScreen';

export const Route = createFileRoute('/car/development')({
  component: DevelopmentScreen,
});
