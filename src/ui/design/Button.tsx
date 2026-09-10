import type { ComponentProps } from 'react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg border-accent hover:brightness-110',
  secondary: 'bg-raised text-hi border-line hover:border-line-strong',
  ghost: 'bg-transparent text-lo border-transparent hover:text-hi hover:bg-raised',
  danger: 'bg-transparent text-negative border-negative/60 hover:bg-negative/10 hover:border-negative',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-6 px-2 text-xs',
  md: 'h-8 px-3 text-sm',
};

export type ButtonProps = ComponentProps<'button'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({
  variant = 'secondary',
  size = 'md',
  type = 'button',
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-sm border font-medium whitespace-nowrap transition-colors',
        'disabled:pointer-events-none disabled:opacity-40',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}
