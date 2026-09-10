import { Tooltip as RadixTooltip } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';

/** Mount once at the app root; shares the open delay across all tooltips. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <RadixTooltip.Provider delayDuration={300}>{children}</RadixTooltip.Provider>;
}

export type TooltipProps = {
  content: ReactNode;
  /** A single focusable element; it receives the trigger props. */
  children: ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
};

export function Tooltip({ content, children, side = 'top' }: TooltipProps) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-50 max-w-72 rounded-sm border border-line-strong bg-raised px-2 py-1.5 text-xs text-hi shadow-lg"
        >
          {content}
          <RadixTooltip.Arrow className="fill-line-strong" width={8} height={4} />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
