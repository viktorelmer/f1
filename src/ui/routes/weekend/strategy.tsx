import { createFileRoute } from '@tanstack/react-router';
import { StrategyScreen } from '@/ui/screens/weekend/StrategyScreen';

export const Route = createFileRoute('/weekend/strategy')({
  component: StrategyScreen,
});
