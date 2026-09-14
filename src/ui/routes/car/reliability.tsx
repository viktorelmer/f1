import { createFileRoute } from '@tanstack/react-router';
import { ReliabilityScreen } from '@/ui/screens/car/ReliabilityScreen';

export const Route = createFileRoute('/car/reliability')({
  component: ReliabilityScreen,
});
