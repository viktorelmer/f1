import { createFileRoute } from '@tanstack/react-router';
import { UpgradesScreen } from '@/ui/screens/car/UpgradesScreen';

export const Route = createFileRoute('/car/upgrades')({
  component: UpgradesScreen,
});
