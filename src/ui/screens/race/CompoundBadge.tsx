import { useTranslation } from 'react-i18next';
import type { Compound } from '@/sim/race/types';
import { cn } from '@/ui/design/cn';

const RING: Record<Compound, string> = {
  soft: 'border-tyre-soft',
  medium: 'border-tyre-medium',
  hard: 'border-tyre-hard',
  inter: 'border-tyre-inter',
  wet: 'border-tyre-wet',
};

/** A tyre: coloured ring plus the compound letter — colour is never the only signal. */
export function CompoundBadge({ compound }: { compound: Compound }) {
  const { t } = useTranslation();
  return (
    <span
      role="img"
      aria-label={t(`race.compound.${compound}`)}
      className={cn(
        'inline-flex size-5 items-center justify-center rounded-full border-2 font-mono text-2xs leading-none font-bold text-hi',
        RING[compound],
      )}
    >
      {t(`race.compound.short.${compound}`)}
    </span>
  );
}
