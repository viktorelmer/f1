import { createFileRoute } from '@tanstack/react-router';
import { ComponentsDemoScreen } from '@/ui/screens/ComponentsDemoScreen';

export const Route = createFileRoute('/dev/components')({
  component: ComponentsDemoScreen,
});
