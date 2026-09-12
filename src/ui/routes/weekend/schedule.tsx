import { createFileRoute } from '@tanstack/react-router';
import { WeekendScheduleScreen } from '@/ui/screens/season/WeekendScheduleScreen';

export const Route = createFileRoute('/weekend/schedule')({
  component: WeekendScheduleScreen,
});
