import { createFileRoute } from '@tanstack/react-router';
import { SectionLayout } from '@/ui/shell/SectionLayout';

export const Route = createFileRoute('/team')({
  component: () => <SectionLayout section="team" />,
});
