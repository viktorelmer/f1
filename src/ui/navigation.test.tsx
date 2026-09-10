import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { i18n } from '@/i18n';
import { App } from './App';
import { SECTION_IDS, type SectionId, sectionLabelKey, tabLabelKey, tabPath, tabsOf } from './navigation';
import { createAppRouter } from './router';

function renderAt(path: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  render(<App router={router} />);
  return router;
}

const ALL_TABS = SECTION_IDS.flatMap((section) => tabsOf(section).map((tab) => [section, tab] as const));

describe('navigation (M0 DoD: every section can be visited)', () => {
  it.each(ALL_TABS)('/%s/%s renders its screen inside its section', async (section, tab) => {
    renderAt(tabPath(section, tab));

    const sectionLabel = i18n.t(sectionLabelKey(section));
    const tabLabel = i18n.t(tabLabelKey(section, tab));

    expect(await screen.findByRole('region', { name: tabLabel })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: sectionLabel })).toBeInTheDocument();
    const tabs = screen.getByRole('navigation', { name: sectionLabel });
    expect(within(tabs).getByRole('link', { name: tabLabel })).toHaveAttribute('aria-current', 'page');
  });

  it('has a route for every navigation entry and nothing unlisted', () => {
    const router = createAppRouter(createMemoryHistory({ initialEntries: ['/'] }));
    const routed = Object.keys(router.routesByPath).filter(
      (path) => /^\/[a-z-]+\/[a-z-]+$/.test(path) && !path.startsWith('/dev/'),
    );
    const listed = ALL_TABS.map(([section, tab]) => tabPath(section, tab));
    expect(routed.sort()).toEqual([...listed].sort());
  });

  it('opens HQ from the root URL', async () => {
    const router = renderAt('/');
    expect(await screen.findByRole('region', { name: 'Overview' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/hq/overview');
  });

  it.each(SECTION_IDS)('/%s opens the first tab of the section', async (section: SectionId) => {
    const router = renderAt(`/${section}`);
    const firstTab = tabsOf(section)[0]!;
    expect(
      await screen.findByRole('region', { name: i18n.t(tabLabelKey(section, firstTab)) }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(tabPath(section, firstTab));
  });

  it('moves between sections and tabs by clicking', async () => {
    const user = userEvent.setup();
    const router = renderAt('/hq/overview');
    await screen.findByRole('region', { name: 'Overview' });

    const sidebar = screen.getByRole('navigation', { name: 'Sections' });
    await user.click(within(sidebar).getByRole('link', { name: 'Car' }));
    expect(await screen.findByRole('region', { name: 'Characteristics' })).toBeInTheDocument();
    expect(within(sidebar).getByRole('link', { name: 'Car' })).toHaveAttribute('aria-current', 'page');

    await user.click(screen.getByRole('link', { name: 'Reliability' }));
    expect(await screen.findByRole('region', { name: 'Reliability' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/car/reliability');
  });

  it('shows a way back from an unknown URL', async () => {
    renderAt('/nowhere');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to HQ' })).toHaveAttribute('href', '/hq/overview');
  });

  it('renders the component showcase (M0 DoD: three component examples)', async () => {
    renderAt('/dev/components');
    expect(await screen.findByRole('heading', { level: 1, name: 'Components' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Buttons' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Lap times (mock data)' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Tooltip and dialog' })).toBeInTheDocument();
  });

  it('switches the interface language', async () => {
    const user = userEvent.setup();
    renderAt('/car/specs');
    await screen.findByRole('region', { name: 'Characteristics' });

    await user.click(screen.getByRole('button', { name: 'ru' }));
    expect(await screen.findByRole('region', { name: 'Характеристики' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('ru');

    await user.click(screen.getByRole('button', { name: 'en' }));
    expect(await screen.findByRole('region', { name: 'Characteristics' })).toBeInTheDocument();
  });
});
