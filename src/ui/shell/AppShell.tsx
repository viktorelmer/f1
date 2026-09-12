import { Outlet } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useCareer } from '@/app/store/career';
import { applyAccent, NEUTRAL_ACCENT, visibleTeamColour } from '@/ui/design/accent';
import { CareerStartScreen } from '@/ui/screens/season/CareerStartScreen';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

/** The interface wears the player's team colour (plan 6.1). */
function useTeamAccent() {
  const team = useCareer((s) => s.world.teams[s.world.career.playerTeamId]);
  useEffect(() => applyAccent(team ? visibleTeamColour(team.colours) : NEUTRAL_ACCENT), [team]);
}

/**
 * Layout from plan section 6.2: top bar across, sections down the left, the screen in the rest.
 * Before a career is started the shell gives way to the career screen — there is nothing to manage
 * yet (docs/systems/season.md).
 */
export function AppShell() {
  useTeamAccent();
  const demo = useCareer((s) => s.demo);
  if (demo) return <CareerStartScreen />;
  return (
    <div className="flex h-full min-w-[1280px] flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
