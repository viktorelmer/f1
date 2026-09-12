import { createFileRoute } from '@tanstack/react-router';
import { CalendarScreen } from '@/ui/screens/season/CalendarScreen';

export const Route = createFileRoute('/championship/calendar')({
  component: CalendarScreen,
});
