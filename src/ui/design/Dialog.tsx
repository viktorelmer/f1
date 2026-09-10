import { Dialog as RadixDialog } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';

export type DialogProps = {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Buttons along the bottom; wrap the dismissing one in <DialogClose>. */
  footer?: ReactNode;
  /** Element that opens the dialog, for uncontrolled use. */
  trigger?: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/** Wrap a footer button in this to make it close the dialog. */
export function DialogClose({ children }: { children: ReactElement }) {
  return <RadixDialog.Close asChild>{children}</RadixDialog.Close>;
}

export function Dialog({ title, description, children, footer, trigger, open, onOpenChange }: DialogProps) {
  return (
    <RadixDialog.Root {...(open !== undefined && { open })} {...(onOpenChange && { onOpenChange })}>
      {trigger && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <RadixDialog.Content
          // Without a description Radix expects an explicit opt-out of aria-describedby.
          {...(description === undefined && { 'aria-describedby': undefined })}
          className="fixed top-1/2 left-1/2 z-50 flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col border border-line-strong bg-panel shadow-2xl"
        >
          <div className="flex flex-col gap-1 border-b border-line px-4 py-3">
            <RadixDialog.Title className="text-lg font-semibold text-hi">{title}</RadixDialog.Title>
            {description !== undefined && (
              <RadixDialog.Description className="text-sm text-lo">{description}</RadixDialog.Description>
            )}
          </div>
          {children !== undefined && <div className="px-4 py-3">{children}</div>}
          {footer !== undefined && (
            <div className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
