import { Outlet } from '@tanstack/react-router';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

/** Layout from plan section 6.2: top bar across, sections down the left, the screen in the rest. */
export function AppShell() {
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
