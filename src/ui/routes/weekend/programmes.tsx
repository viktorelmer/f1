import { createFileRoute } from '@tanstack/react-router';
import { ProgrammesScreen } from '@/ui/screens/season/ProgrammesScreen';

export const Route = createFileRoute('/weekend/programmes')({
  component: ProgrammesScreen,
});
