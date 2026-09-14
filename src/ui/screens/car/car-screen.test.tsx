/**
 * The car on screen (docs/systems/car-development.md): the factory is a screen you work on — start
 * a project, watch the interval narrow, fit the part, take a direction.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useCar } from '@/app/store/car';
import { useCareer } from '@/app/store/career';
import { i18n } from '@/i18n';
import { balance } from '@/data/balance';
import { advanceTo } from '@/sim/season/advance';
import { addDays } from '@/sim/types/game-date';
import { createWorld } from '@/sim/world/create-world';
import { TooltipProvider } from '@/ui/design/Tooltip';
import { CarSpecsScreen } from './CarSpecsScreen';
import { DevelopmentScreen } from './DevelopmentScreen';
import { PhilosophyScreen } from './PhilosophyScreen';
import { UpgradesScreen } from './UpgradesScreen';

const t = i18n.t.bind(i18n);
const pack = useCareer.getState().pack;
const world = createWorld('car-screen', pack, {
  mode: 'takeover',
  teamId: pack.teams[0]!.id,
  principalName: 'Test',
});
const draw = (ui: React.ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>);

beforeEach(() => {
  useCareer.setState({ world, demo: false });
  useCar.setState({ error: null });
});

describe('the development screen', () => {
  it('starts a project and shows what the factory believes it is worth', async () => {
    const user = userEvent.setup();
    draw(<DevelopmentScreen />);
    expect(screen.getByText(t('car.development.none'))).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: t('car.development.start') }));

    const after = useCareer.getState().world;
    const mine = after.projects.filter((p) => p.teamId === after.career.playerTeamId);
    expect(mine).toHaveLength(1);
    // The expected gain is on screen only as an Estimate: a group whose name carries the interval.
    expect(
      screen.getByRole('group', { name: new RegExp(`^${t('car.development.gain')}:`) }),
    ).toBeInTheDocument();
    // And the truth is not on the screen anywhere.
    const truth = after.hidden.projects[mine[0]!.id]!.trueGain.toFixed(3);
    expect(screen.queryByText(new RegExp(truth))).toBeNull();
  });

  it('fits a part that is built, and the car changes', async () => {
    const user = userEvent.setup();
    useCar.getState().start({ part: 'floor', targetSeason: world.season.year, atrShare: 0.35 });
    // Four months of work: the part is built and waiting in the garage.
    useCareer.setState({ world: advanceTo(useCareer.getState().world, pack, addDays(world.date, 200)) });
    const before = useCareer.getState().world.teams[world.career.playerTeamId]!.chassis.floor;

    draw(<UpgradesScreen />);
    await user.click(screen.getAllByRole('button', { name: t('car.upgrades.fit') })[0]!);

    const team = useCareer.getState().world.teams[world.career.playerTeamId]!;
    expect(team.chassis.floor).toBeGreaterThan(before);
    expect(team.freshness.floor).toBe(1);
  }, 30_000);
});

describe('the philosophy screen', () => {
  it('takes a direction and says what changing it costs', async () => {
    const user = userEvent.setup();
    useCar.getState().start({ part: 'floor', targetSeason: world.season.year, atrShare: 0.35 });
    useCareer.setState({ world: advanceTo(useCareer.getState().world, pack, addDays(world.date, 14)) });
    draw(<PhilosophyScreen />);

    await user.click(screen.getByRole('radio', { name: new RegExp(t('car.philosophy.kind.low-drag')) }));
    expect(useCareer.getState().world.teams[world.career.playerTeamId]!.philosophy).toBe('low-drag');
    expect(
      screen.getByText(
        t('car.philosophy.switchCost', {
          percent: Math.round(balance.development.philosophy.switchLossShare * 100),
        }),
      ),
    ).toBeInTheDocument();
  }, 30_000);
});

describe('the specs screen', () => {
  it('shows the car’s own numbers, no estimates', () => {
    draw(<CarSpecsScreen />);
    const card = screen.getByRole('region', { name: t('car.specs.title') });
    expect(within(card).getByText(t('car.specs.characteristics.reliability'))).toBeInTheDocument();
    expect(screen.queryAllByRole('group', { name: /:/ })).toHaveLength(0);
  });
});
