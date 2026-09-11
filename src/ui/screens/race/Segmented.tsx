import { cn } from '@/ui/design/cn';

export type SegmentedOption<T extends string> = { value: T; label: string };

/** A row of mutually exclusive buttons: pace, ERS, delegation mode… The chosen one is pressed. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
  disabledValues = [],
}: {
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  disabled?: boolean;
  disabledValues?: readonly T[];
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-0.5">
      <span className="text-2xs text-lo">{label}</span>
      <div className="flex">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              disabled={disabled || disabledValues.includes(o.value)}
              onClick={() => onChange(o.value)}
              className={cn(
                '-ml-px h-6 min-w-0 flex-1 truncate border px-1.5 text-2xs first:ml-0 first:rounded-l-sm last:rounded-r-sm',
                'disabled:pointer-events-none disabled:opacity-40',
                on
                  ? 'z-10 border-accent bg-accent text-accent-fg'
                  : 'border-line bg-raised text-lo hover:text-hi',
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
