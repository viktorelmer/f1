import { createFileRoute } from '@tanstack/react-router';
import { RivalsScreen } from '@/ui/screens/season/RivalsScreen';

export const Route = createFileRoute('/championship/rivals')({
  component: RivalsScreen,
});
