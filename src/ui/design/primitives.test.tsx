import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { accentForeground, applyAccent } from './accent';
import { Button } from './Button';
import { Dialog, DialogClose } from './Dialog';
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
