import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NEUTRAL_ACCENT, applyAccent } from '@/ui/design/accent';
import { Button, type ButtonVariant } from '@/ui/design/Button';
import { cn } from '@/ui/design/cn';
import { Dialog, DialogClose } from '@/ui/design/Dialog';
import { Panel } from '@/ui/design/Panel';
import { type Column, Table } from '@/ui/design/Table';
import { Tooltip } from '@/ui/design/Tooltip';
import { type TimingRow, type TyreCompound, timingMock } from '@/ui/mocks/timing';

const VARIANTS: readonly ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger'];

const TYRE_CLASS: Record<TyreCompound, string> = {
  soft: 'border-tyre-soft',
  medium: 'border-tyre-medium',
  hard: 'border-tyre-hard',
  inter: 'border-tyre-inter',
  wet: 'border-tyre-wet',
};

const PALETTE = [
  'ground',
  'panel',
  'raised',
  'line',
  'line-strong',
  'hi',
  'lo',
  'accent',
  'positive',
  'negative',
  'tyre-soft',
  'tyre-medium',
  'tyre-hard',
  'tyre-inter',
  'tyre-wet',
] as const;

// Sample team colours, light to dark, to show the accent-driven theme and its readable foreground.
const ACCENTS = [NEUTRAL_ACCENT, '#d7263d', '#ff8a1f', '#f2d43a', '#27c4b4', '#1b2a6b'] as const;

function ButtonsPanel() {
  const { t } = useTranslation();
  return (
    <Panel title={t('demo.buttons')}>
      <div className="flex flex-col gap-3">
        {(['md', 'sm'] as const).map((size) => (
          <div key={size} className="flex flex-wrap items-center gap-2">
            {VARIANTS.map((variant) => (
              <Button key={variant} variant={variant} size={size}>
                {t(`demo.variants.${variant}`)}
              </Button>
            ))}
            <Button size={size} disabled>
              {t('demo.variants.disabled')}
            </Button>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function TablePanel() {
  const { t } = useTranslation();
  const columns: Column<TimingRow>[] = [
    { key: 'pos', header: t('demo.columns.position'), cell: (r) => r.position, numeric: true, width: '3rem' },
    {
      key: 'driver',
      header: t('demo.columns.driver'),
      cell: (r) => (
        <span className="flex items-center gap-2">
          <span aria-hidden className="h-3.5 w-1 rounded-sm" style={{ background: r.teamColour }} />
          {r.driver}
        </span>
      ),
    },
    { key: 'team', header: t('demo.columns.team'), cell: (r) => <span className="text-lo">{r.team}</span> },
    { key: 'lap', header: t('demo.columns.lapTime'), cell: (r) => r.lastLap, numeric: true },
    { key: 'gap', header: t('demo.columns.gap'), cell: (r) => r.gap, numeric: true },
    {
      key: 'tyre',
      header: t('demo.columns.tyre'),
      numeric: true,
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <span
            role="img"
            aria-label={r.tyre}
            className={cn('size-3 rounded-full border-2', TYRE_CLASS[r.tyre])}
          />
          {r.tyreAge}
        </span>
      ),
    },
  ];

  return (
    <Panel title={t('demo.table')} flush>
      <Table columns={columns} rows={timingMock} rowKey={(r) => r.driver} caption={t('demo.tableCaption')} />
    </Panel>
  );
}

function OverlaysPanel() {
  const { t } = useTranslation();
  return (
    <Panel title={t('demo.overlays')}>
      <div className="flex flex-wrap items-center gap-3">
        <Tooltip content={t('demo.tooltipContent')}>
          <Button variant="ghost">{t('demo.tooltipTrigger')}</Button>
        </Tooltip>
        <Dialog
          trigger={<Button>{t('demo.dialogTrigger')}</Button>}
          title={t('demo.dialogTitle')}
          description={t('demo.dialogDescription')}
          footer={
            <>
              <DialogClose>
                <Button variant="ghost">{t('demo.dialogCancel')}</Button>
              </DialogClose>
              <DialogClose>
                <Button variant="primary">{t('demo.dialogConfirm')}</Button>
              </DialogClose>
            </>
          }
        />
      </div>
    </Panel>
  );
}

function PalettePanel() {
  const { t } = useTranslation();
  const [accent, setAccent] = useState<string>(
    () =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || NEUTRAL_ACCENT,
  );

  function pick(colour: string) {
    applyAccent(colour);
    setAccent(colour);
  }

  return (
    <Panel title={t('demo.palette')}>
      <div className="flex flex-col gap-4">
        <ul className="grid grid-cols-5 gap-2">
          {PALETTE.map((token) => (
            <li key={token} className="flex items-center gap-2">
              <span
                aria-hidden
                className="size-5 shrink-0 rounded-sm border border-line"
                style={{ background: `var(--color-${token})` }}
              />
              <code className="truncate font-mono text-2xs text-lo">{token}</code>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-3">
          <span className="text-xs text-lo">{t('demo.accent')}</span>
          <div role="radiogroup" aria-label={t('demo.accent')} className="flex gap-1.5">
            {ACCENTS.map((colour) => (
              <button
                key={colour}
                type="button"
                role="radio"
                aria-checked={accent.toLowerCase() === colour}
                aria-label={colour}
                onClick={() => pick(colour)}
                className={cn(
                  'size-6 rounded-sm border-2',
                  accent.toLowerCase() === colour ? 'border-hi' : 'border-transparent',
                )}
                style={{ background: colour }}
              />
            ))}
          </div>
          <Button variant="primary" size="sm">
            {t('demo.variants.primary')}
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function TypographyPanel() {
  const { t } = useTranslation();
  return (
    <Panel title={t('demo.typography')}>
      <div className="flex flex-col gap-2">
        <p className="text-xl font-semibold">{t('demo.typeSample')}</p>
        <p className="text-base">Roboto Condensed — {t('demo.typeSample')}</p>
        <p className="font-mono text-sm tabular-nums">
          1:32.418 &nbsp; +12.560 &nbsp; $142.6M &nbsp; 0123456789
        </p>
        <p className="font-mono text-sm text-lo tabular-nums">1:11.111 &nbsp; +88.888 &nbsp; $999.9M</p>
      </div>
    </Panel>
  );
}

/** The component showcase required by the M0 Definition of Done. */
export function ComponentsDemoScreen() {
  const { t } = useTranslation();
  return (
    <div className="h-full overflow-auto p-4">
      <div className="mb-4 flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{t('demo.title')}</h1>
        <p className="text-sm text-lo">{t('demo.intro')}</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-4">
          <ButtonsPanel />
          <OverlaysPanel />
          <PalettePanel />
          <TypographyPanel />
        </div>
        <TablePanel />
      </div>
    </div>
  );
}
