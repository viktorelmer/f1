import { type ReactNode, useId } from 'react';
import { cn } from './cn';

export type PanelProps = {
  title?: ReactNode;
  /** Controls on the right of the header. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Drops the body padding, for tables that run edge to edge. */
  flush?: boolean;
};

export function Panel({ title, actions, children, className, flush = false }: PanelProps) {
  const titleId = useId();
  const hasHeader = title !== undefined || actions !== undefined;

  return (
    <section
      aria-labelledby={title !== undefined ? titleId : undefined}
      className={cn('flex min-w-0 flex-col border border-line bg-panel', className)}
    >
      {hasHeader && (
        <header className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-line px-3">
          {title !== undefined && (
            <h2 id={titleId} className="truncate text-sm font-semibold text-hi">
              {title}
            </h2>
          )}
          {actions !== undefined && <div className="flex items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={cn('min-h-0 flex-1', !flush && 'p-3')}>{children}</div>
    </section>
  );
}
