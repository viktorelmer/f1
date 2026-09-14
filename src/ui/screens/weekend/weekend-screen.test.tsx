/**
 * The weekend as something you walk through (docs/systems/weekend-play.md): the hub leads into the
 * session, practice runs on its hour and takes new orders, qualifying sends a car out on the word,
 * and the tyre entry is the player's to change until the first session runs.
 */
import { createMemoryHistory } from '@tanstack/react-router';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCareer } from '@/app/store/career';
import { setRaceEngine } from '@/app/store/race';
import { pendingStage, setWeekendEngine, useWeekend } from '@/app/store/weekend';
import { createInlineEngine } from '@/app/worker/engine';
import { i18n } from '@/i18n';
import { balance } from '@/data/balance';
import { createWorld } from '@/sim/world/create-world';
import { App } from '@/ui/App';
import { TooltipProvider } from '@/ui/design/Tooltip';
import { createAppRouter } from '@/ui/router';
import { openParameters } from '@/sim/car/setup';
import { capabilityOf } from '@/sim/weekend/setup-work';
import { SetupScreen } from './SetupScreen';
import { StrategyScreen } from './StrategyScreen';

const t = i18n.t.bind(i18n);
const pack = useCareer.getState().pack;
const world = createWorld('weekend-screen', pack, {
  mode: 'takeover',
  teamId: 'kestrel',
  principalName: 'Test',
});
const mine = world.teams.kestrel!.drivers.race;

const drawAt = (path: string) =>
  render(<App router={createAppRouter(createMemoryHistory({ initialEntries: [path] }))} />);

const idle = () => vi.waitFor(() => expect(useWeekend.getState().busy).toBe(false), { timeout: 20_000 });
const weekend = () => useWeekend.getState();

beforeEach(() => {
  const engine = createInlineEngine();
  setWeekendEngine(engine);
  setRaceEngine(engine);
  useCareer.setState({ world, demo: false });
  weekend().leave();
  useWeekend.setState({ busy: false, error: null, draft: {}, speed: 1 });
});

describe('the weekend hub', () => {
  it('opens the weekend and leads into the session it is waiting on', async () => {
    const user = userEvent.setup();
    drawAt('/weekend/schedule');

    await user.click(await screen.findByRole('button', { name: t('season.schedule.open') }));
    await idle();
    expect(pendingStage(useCareer.getState().world)).toBe('fp1');

    // The row of the session that is next carries the way in.
    const row = screen.getByRole('row', { name: new RegExp(t('season.session.fp1')) });
    expect(within(row).getByText(t('season.schedule.status.now'))).toBeInTheDocument();
    await user.click(within(row).getByRole('link', { name: t('season.schedule.enter') }));

    expect(
      await screen.findByText(t('weekend.gate.next', { session: t('season.session.fp1') })),
    ).toBeInTheDocument();
  }, 30_000);
});

describe('practice on the clock', () => {
  it('plays the hour and files the session at the flag', async () => {
    const user = userEvent.setup();
    drawAt('/weekend/race');
    await user.click(await screen.findByRole('button', { name: t('weekend.gate.open') }));
    await idle();
    await user.click(await screen.findByRole('button', { name: t('weekend.gate.enter') }));
    await vi.waitFor(() => expect(weekend().play?.kind).toBe('practice'));

    expect(await screen.findByRole('table', { name: t('weekend.practice.board') })).toBeInTheDocument();
    expect(useCareer.getState().world.season.calendar[0]!.sessions).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: t('weekend.clock.skip') }));
    expect(weekend().committed).toBe(true);
    expect(pendingStage(useCareer.getState().world)).toBe('fp2');
  }, 30_000);

  it('takes a new queue from the pit wall while the session runs', async () => {
    const user = userEvent.setup();
    await weekend().open();
    await weekend().enter();
    drawAt('/weekend/race');

    const panel = await screen.findByRole('region', {
      name: useCareer.getState().world.drivers[mine[0]]!.name,
    });
    await user.click(
      within(panel).getByRole('button', { name: `+ ${t('season.programmes.kind.long-run')}` }),
    );
    await user.click(within(panel).getByRole('button', { name: t('weekend.practice.send') }));
    await idle();

    const said = weekend().practiceCommands;
    expect(said).toHaveLength(1);
    expect(said[0]!.driverId).toBe(mine[0]);
    expect(said[0]!.runs.at(-1)?.programme).toBe('long-run');
  }, 30_000);
});

describe('qualifying on the clock', () => {
  it('shows the board with its drop zone and sends a car out on the word', async () => {
    const user = userEvent.setup();
    await weekend().open();
    while (pendingStage(useCareer.getState().world) !== 'qualifying') await weekend().simulateSession();
    await weekend().enter();
    drawAt('/weekend/race');

    expect(await screen.findByRole('table', { name: t('weekend.qualifying.board') })).toBeInTheDocument();
    const panel = screen.getByRole('region', {
      name: useCareer.getState().world.drivers[mine[0]]!.name,
    });
    await user.click(within(panel).getByRole('button', { name: t('weekend.qualifying.sendOut') }));
    await idle();

    const said = weekend().qualifyingCommands;
    expect(said).toHaveLength(1);
    expect(said[0]!.driverId).toBe(mine[0]);
    expect(said[0]!.part).toBe(0);
  }, 30_000);
});

describe('the setup screen', () => {
  it('shows the engineer’s range, locks what the car may not touch, and moves what it may', async () => {
    const user = userEvent.setup();
    await weekend().open();
    render(
      <TooltipProvider>
        <SetupScreen />
      </TooltipProvider>,
    );

    const world = useCareer.getState().world;
    const driverId = mine[0];
    const capability = capabilityOf(world, world.career.playerTeamId, driverId);
    const open = openParameters(capability);
    const card = screen.getByRole('region', { name: world.drivers[driverId]!.name });

    // An open slider moves and the world follows; a closed one is there but disabled.
    const front = within(card).getByLabelText(t('weekend.setup.parameter.frontWing'));
    expect(front).toBeEnabled();
    fireEvent.change(front, { target: { value: '41' } });
    expect(useCareer.getState().world.weekend!.setups[driverId]!.frontWing).toBe(41);

    const camber = within(card).getByLabelText(t('weekend.setup.parameter.camber'));
    expect((camber as HTMLInputElement).disabled).toBe(!open.has('camber'));

    // The engineer's recommendation is on the screen as a range, never as a bare number.
    const reading = world.knowledge[world.career.playerTeamId]!.weekend!.setup[driverId]!.reading;
    const band = t('weekend.setup.recommendation', {
      low: Math.round(reading.frontWing.low),
      high: Math.round(reading.frontWing.high),
    });
    expect(within(card).getByText(band)).toBeInTheDocument();

    // And the autosetup buttons put a whole setup on the car.
    await user.click(within(card).getByRole('button', { name: t('weekend.setup.source.factory') }));
    const track = useCareer.getState().pack.tracks.find((tr) => tr.id === world.season.calendar[0]!.trackId)!;
    expect(useCareer.getState().world.weekend!.setups[driverId]!.frontWing).toBe(
      track.factorySetup.frontWing,
    );
  }, 30_000);
});

describe('the tyre entry', () => {
  it('is the player’s to change, and never goes over the limit', async () => {
    const user = userEvent.setup();
    await weekend().open();
    render(
      <TooltipProvider>
        <StrategyScreen />
      </TooltipProvider>,
    );

    const declared = useCareer.getState().world.weekend!.tyres[mine[0]]!;
    const soft = t('race.compound.soft');
    const hard = t('race.compound.hard');
    const entry = screen.getAllByRole('region')[0]!;
    // The entry is full: nothing can be added until something is given up.
    expect(
      within(entry).getAllByRole('button', { name: t('weekend.entry.more', { compound: soft }) })[0],
    ).toBeDisabled();

    await user.click(
      within(entry).getAllByRole('button', { name: t('weekend.entry.fewer', { compound: soft }) })[0]!,
    );
    expect(useCareer.getState().world.weekend!.tyres[mine[0]]!.soft).toBe(declared.soft - 1);
    await user.click(
      within(entry).getAllByRole('button', { name: t('weekend.entry.more', { compound: hard }) })[0]!,
    );
    const after = useCareer.getState().world.weekend!.tyres[mine[0]]!;
    expect(after.hard).toBe(declared.hard + 1);
    expect(after.soft + after.medium + after.hard).toBe(declared.soft + declared.medium + declared.hard);
    expect(after.soft).toBeGreaterThanOrEqual(balance.weekend.tyres.minPerCompound);
  }, 30_000);
});
