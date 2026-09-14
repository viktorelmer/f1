import { createFileRoute } from '@tanstack/react-router';
import { PhilosophyScreen } from '@/ui/screens/car/PhilosophyScreen';

export const Route = createFileRoute('/car/philosophy')({
  component: PhilosophyScreen,
});
