import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCareer } from '@/app/store/career';
import { setSeasonEngine, useSeason } from '@/app/store/season';
import { createInlineEngine } from '@/app/worker/engine';
import { i18n } from '@/i18n';
import { createWorld } from '@/sim/world/create-world';
import { TooltipProvider } from '@/ui/design/Tooltip';
import { CalendarScreen } from './CalendarScreen';
import { CareerStartScreen } from './CareerStartScreen';
import { ProgrammesScreen } from './ProgrammesScreen';
import { RivalsScreen } from './RivalsScreen';
import { StandingsScreen } from './StandingsScreen';
import { WeekendScheduleScreen } from './WeekendScheduleScreen';

const t = i18n.t.bind(i18n);
const pack = useCareer.getState().pack;
const world = createWorld('season-screen', pack, {
  mode: 'takeover',
  teamId: 'kestrel',
  principalName: 'Test',
});

const draw = (ui: React.ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>);

describe('the season on screen (M5)', () => {
  beforeEach(() => {
    setSeasonEngine(createInlineEngine());
    useCareer.setState({ world });
    useSeason.setState({ busy: false, error: null, programmes: {} });
  });

  it('runs a weekend from the schedule and shows what happened in every session', async () => {
    const user = userEvent.setup();
    draw(<WeekendScheduleScreen />);
    expect(screen.getByText(t('season.schedule.notRunYet'))).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: t('season.schedule.run') }));
    await vi.waitFor(() => expect(useSeason.getState().busy).toBe(false), { timeout: 20_000 });

    const after = useCareer.getState().world;
    expect(after.season.calendar[0]!.status).toBe('completed');
    // Every session of the weekend is on the screen, the race among them.
    for (const session of after.season.calendar[0]!.sessions)
      expect(await screen.findByText(t(`season.session.${session.session}`))).toBeInTheDocument();
    // And the clock has moved to race day.
    expect(after.date).toBe(after.season.calendar[0]!.raceDate);
  }, 30_000);

  it('shows the championship the race produced, both tables agreeing with it', async () => {
    const user = userEvent.setup();
    draw(<WeekendScheduleScreen />);
    await user.click(screen.getByRole('button', { name: t('season.schedule.run') }));
    await vi.waitFor(() => expect(useSeason.getState().busy).toBe(false), { timeout: 20_000 });

    const after = useCareer.getState().world;
    const race = after.season.calendar[0]!.sessions.find((s) => s.session === 'race')!;
    const winner = race.classification[0]!;
    cleanup();

    const { unmount } = draw(<StandingsScreen />);
    const drivers = screen.getByRole('region', { name: t('season.standings.drivers') });
    const winnerRow = within(drivers).getByRole('row', {
      name: new RegExp(after.drivers[winner.driverId]!.name),
    });
    expect(winnerRow).toHaveTextContent(String(winner.points));
    const constructors = screen.getByRole('region', { name: t('season.standings.constructors') });
    expect(
      within(constructors).getByRole('row', { name: new RegExp(after.teams[winner.teamId]!.name) }),
    ).toBeInTheDocument();
    unmount();

    draw(<CalendarScreen />);
    expect(screen.getAllByText(after.drivers[winner.driverId]!.name).length).toBeGreaterThan(0);
  }, 30_000);

  it('shows the opposition only as an estimate, never as a number', async () => {
    const user = userEvent.setup();
    draw(<WeekendScheduleScreen />);
    await user.click(screen.getByRole('button', { name: t('season.schedule.run') }));
    await vi.waitFor(() => expect(useSeason.getState().busy).toBe(false), { timeout: 20_000 });
    cleanup();

    draw(<RivalsScreen />);
    const after = useCareer.getState().world;
    const rivals = Object.keys(after.knowledge.kestrel!.rivals);
    expect(rivals.length).toBeGreaterThan(0);
    for (const teamId of rivals) {
      const name = after.teams[teamId]!.name;
      // The one Estimate component: a group whose name carries the interval and the confidence.
      const group = screen.getByRole('group', { name: new RegExp(`^${name}:`) });
      expect(group).toBeInTheDocument();
    }
  }, 30_000);

  it('lets the player rewrite a practice programme, and keeps it for the weekend', async () => {
    const user = userEvent.setup();
    draw(<ProgrammesScreen />);
    const fp2 = screen.getByRole('region', { name: t('season.session.fp2') });
    const team = world.teams.kestrel;
    const driver = team === undefined ? undefined : world.drivers[team.drivers.race[0]!];
    if (!driver) throw new Error('the demo team has no drivers');
    expect(within(fp2).getByText(driver.name)).toBeInTheDocument();

    await user.click(
      within(fp2).getAllByRole('button', { name: `+ ${t('season.programmes.kind.long-run')}` })[0]!,
    );
    const runs = useSeason.getState().programmes.fp2?.[driver.id];
    expect(runs?.at(-1)?.programme).toBe('long-run');
  });
});

describe('starting a career (plan 5.11)', () => {
  it('takes over a team on the seed the player chose', async () => {
    const user = userEvent.setup();
    useCareer.setState({ demo: true });
    draw(<CareerStartScreen />);

    await user.click(screen.getByRole('radio', { name: new RegExp(pack.teams[3]!.name) }));
    const seed = screen.getByLabelText(t('season.career.seed'));
    await user.clear(seed);
    await user.type(seed, 'my-career');
    await user.click(screen.getByRole('button', { name: t('season.career.start') }));

    const { world: started, demo } = useCareer.getState();
    expect(demo).toBe(false);
    expect(started.seed).toBe('my-career');
    expect(started.career.mode).toBe('takeover');
    expect(started.career.playerTeamId).toBe(pack.teams[3]!.id);
  });

  it('founds a twelfth team when asked to', async () => {
    const user = userEvent.setup();
    useCareer.setState({ demo: true });
    draw(<CareerStartScreen />);

    await user.click(screen.getByRole('button', { name: t('season.career.founder') }));
    const name = screen.getByLabelText(t('season.career.teamName'));
    await user.clear(name);
    await user.type(name, 'Northern Star');
    await user.click(screen.getByRole('button', { name: t('season.career.start') }));

    const { world: started } = useCareer.getState();
    expect(started.career.mode).toBe('founder');
    expect(Object.keys(started.teams)).toHaveLength(pack.teams.length + 1);
    expect(started.teams[started.career.playerTeamId]!.name).toBe('Northern Star');
  });
});
