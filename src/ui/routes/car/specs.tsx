import { createFileRoute } from '@tanstack/react-router';
import { CarSpecsScreen } from '@/ui/screens/car/CarSpecsScreen';

export const Route = createFileRoute('/car/specs')({
  component: CarSpecsScreen,
});
