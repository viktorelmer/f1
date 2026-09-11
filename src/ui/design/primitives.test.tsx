import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { accentForeground, applyAccent } from './accent';
import { Button } from './Button';
import { estimateFromModel } from '@/sim/knowledge/estimate';
import { gameDate } from '@/sim/types/game-date';
import { Dialog, DialogClose } from './Dialog';
import { Estimate } from './Estimate';
import { Panel } from './Panel';
import { type Column, Table } from './Table';
import { Tooltip, TooltipProvider } from './Tooltip';

describe('Button', () => {
  it('is a non-submitting button by default and respects disabled', async () => {
    const user = userEvent.setup();
    let clicks = 0;
    render(
      <>
        <Button onClick={() => clicks++}>Go</Button>
        <Button disabled onClick={() => clicks++}>
          Off
        </Button>
      </>,
    );

    expect(screen.getByRole('button', { name: 'Go' })).toHaveAttribute('type', 'button');
    await user.click(screen.getByRole('button', { name: 'Go' }));
    await user.click(screen.getByRole('button', { name: 'Off' }));
    expect(clicks).toBe(1);
  });

  it('draws the primary variant in the team accent', () => {
    render(<Button variant="primary">Box</Button>);
    expect(screen.getByRole('button', { name: 'Box' })).toHaveClass('bg-accent', 'text-accent-fg');
  });
});

describe('Panel', () => {
  it('is a region named by its title', () => {
    render(
      <Panel title="Strategy" actions={<Button size="sm">Edit</Button>}>
        body
      </Panel>,
    );
    const region = screen.getByRole('region', { name: 'Strategy' });
    expect(within(region).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });
});

describe('Table', () => {
  type Row = { driver: string; gap: string };
  const columns: Column<Row>[] = [
    { key: 'driver', header: 'Driver', cell: (r) => r.driver },
    { key: 'gap', header: 'Gap', cell: (r) => r.gap, numeric: true },
  ];
  const rows: Row[] = [
    { driver: 'R. Hart', gap: '—' },
    { driver: 'M. Okafor', gap: '+1.204' },
  ];

  it('renders a captioned table with column headers and one row per item', () => {
    render(<Table columns={columns} rows={rows} rowKey={(r) => r.driver} caption="Timing" />);
    const table = screen.getByRole('table', { name: 'Timing' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Driver', 'Gap']);
    expect(within(table).getAllByRole('row')).toHaveLength(1 + rows.length);
  });

  it('sets numeric columns right-aligned in tabular mono', () => {
    render(<Table columns={columns} rows={rows} rowKey={(r) => r.driver} />);
    const gap = screen.getByRole('cell', { name: '+1.204' });
    expect(gap).toHaveClass('text-right', 'font-mono', 'tabular-nums');
    expect(screen.getByRole('cell', { name: 'R. Hart' })).toHaveClass('text-left');
    expect(screen.getByRole('cell', { name: 'R. Hart' })).not.toHaveClass('font-mono');
  });
});

describe('Tooltip', () => {
  it('shows its content when the trigger receives keyboard focus', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <Tooltip content="Needs a level-2 simulator">
          <Button>Locked</Button>
        </Tooltip>
      </TooltipProvider>,
    );

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Locked' })).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Needs a level-2 simulator');
  });
});

describe('Dialog', () => {
  it('opens from its trigger, traps focus, and closes with Escape back to the trigger', async () => {
    const user = userEvent.setup();
    render(
      <Dialog
        trigger={<Button>Pit</Button>}
        title="Confirm pit stop"
        description="Mediums this lap?"
        footer={
          <DialogClose>
            <Button>Cancel</Button>
          </DialogClose>
        }
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Pit' }));
    const dialog = screen.getByRole('dialog', { name: 'Confirm pit stop' });
    expect(dialog).toHaveAccessibleDescription('Mediums this lap?');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pit' })).toHaveFocus();
  });

  it('closes from a footer button', async () => {
    const user = userEvent.setup();
    render(
      <Dialog
        trigger={<Button>Pit</Button>}
        title="Confirm pit stop"
        footer={
          <DialogClose>
            <Button>Cancel</Button>
          </DialogClose>
        }
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Pit' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Estimate', () => {
  const at = gameDate(2026, 3, 1);
  const forecast = (sd: number) =>
    estimateFromModel(
      { mean: 6.4, sd },
      { quantity: { min: 1, max: 22, wideSd: 6 }, at, sources: ['data-analysis'] },
    );

  it('marks the most likely value, writes out the interval and says the confidence in words', () => {
    const estimate = forecast(1);
    render(
      <TooltipProvider>
        <Estimate estimate={estimate} label="Finish" format={(v) => `P${Math.round(v)}`} min={1} max={22} />
      </TooltipProvider>,
    );
    const group = screen.getByRole('group', {
      name: /^Finish: P6, P\d+–P\d+, (low|medium|high) confidence$/,
    });
    expect(group).toHaveTextContent('≈ P6');
    expect(group).toHaveTextContent(`P${Math.round(estimate.low)}–P${Math.round(estimate.high)}`);
    const interval = within(group).getByTestId('estimate-interval');
    expect(interval.style.left).toBe(`${(100 * (estimate.low - 1)) / 21}%`);
  });

  it('draws a vaguer estimate as a wider interval with a lower confidence', () => {
    const [sharp, vague] = [forecast(0.5), forecast(3)];
    expect(vague.high - vague.low).toBeGreaterThan(sharp.high - sharp.low);
    render(
      <TooltipProvider>
        <Estimate estimate={sharp} label="Sharp" min={1} max={22} />
        <Estimate estimate={vague} label="Vague" min={1} max={22} />
      </TooltipProvider>,
    );
    const width = (name: string) =>
      parseFloat(
        within(screen.getByRole('group', { name: new RegExp(`^${name}`) })).getByTestId('estimate-interval')
          .style.width,
      );
    expect(width('Vague')).toBeGreaterThan(width('Sharp'));
    expect(vague.confidence).toBeLessThan(sharp.confidence);
  });

  it('says in its tooltip what would narrow it', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <Estimate estimate={forecast(1)} label="Finish" />
      </TooltipProvider>,
    );
    await user.tab();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('A stronger strategist and analysts');
  });
});

describe('accent', () => {
  it('picks readable text for light and dark team colours', () => {
    expect(accentForeground('#f2d43a')).toBe('#0c0f14'); // yellow → dark text
    expect(accentForeground('#ff8a1f')).toBe('#0c0f14'); // papaya → dark text
    expect(accentForeground('#1b2a6b')).toBe('#e8edf5'); // navy → light text
    expect(accentForeground('#d7263d')).toBe('#e8edf5'); // red → light text
  });

  it('sets the accent tokens on the root element', () => {
    const root = document.createElement('div');
    applyAccent('#f2d43a', root);
    expect(root.style.getPropertyValue('--color-accent')).toBe('#f2d43a');
    expect(root.style.getPropertyValue('--color-accent-fg')).toBe('#0c0f14');
  });

  it('rejects colours that are not #rrggbb', () => {
    expect(() => accentForeground('red')).toThrow();
  });
});
