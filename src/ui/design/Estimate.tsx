import { useTranslation } from 'react-i18next';
import { confidenceLabel, type Estimate as EstimateValue } from '@/sim/knowledge/estimate';
import { Tooltip } from './Tooltip';

export type EstimateProps = {
  estimate: EstimateValue;
  /** What is being estimated, as the accessible name. */
  label: string;
  /** How a value reads: "P7", "93.2 s", "82". Applied to the most likely value and both bounds. */
  format?: (value: number) => string;
  /** The scale the bar spans; the estimate's own bounds by default. */
  min?: number;
  max?: number;
};

/**
 * The one way an estimate appears anywhere in the game (plan 6.6). It never looks like an exact
 * number: the most likely value is marked on a bar with the interval shaded, the interval is always
 * written out, and the confidence is said in words — never in colour. The tooltip says what would
 * narrow the interval.
 */
export function Estimate({
  estimate,
  label,
  format = (v) => String(Math.round(v)),
  min,
  max,
}: EstimateProps) {
  const { t } = useTranslation();
  const lo = min ?? estimate.basis.min;
  const hi = max ?? estimate.basis.max;
  const at = (v: number) => `${(100 * (v - lo)) / Math.max(1e-9, hi - lo)}%`;
  const width = (100 * (estimate.high - estimate.low)) / Math.max(1e-9, hi - lo);
  const confidence = confidenceLabel(estimate.confidence);
  const range = t('estimate.range', { low: format(estimate.low), high: format(estimate.high) });

  return (
    <Tooltip
      content={
        <div className="flex flex-col gap-1">
          <span className="text-lo">{t('estimate.narrows')}</span>
          <ul className="list-inside list-disc">
            {estimate.sources.map((source) => (
              <li key={source}>{t(`estimate.source.${source}`)}</li>
            ))}
          </ul>
        </div>
      }
    >
      <div
        role="group"
        tabIndex={0}
        aria-label={`${label}: ${format(estimate.value)}, ${range}, ${t(`estimate.confidence.${confidence}`)}`}
        className="flex flex-col gap-1 rounded-sm outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-mono text-base text-hi">≈ {format(estimate.value)}</span>
          <span className="font-mono text-xs text-lo tabular-nums">{range}</span>
        </div>
        <div aria-hidden className="relative h-2 rounded-sm bg-raised">
          <div
            data-testid="estimate-interval"
            className="absolute inset-y-0 rounded-sm bg-line-strong"
            style={{ left: at(estimate.low), width: `${width}%` }}
          />
          <div className="absolute -inset-y-0.5 w-0.5 bg-hi" style={{ left: at(estimate.value) }} />
        </div>
        <span className="text-2xs text-lo">{t(`estimate.confidence.${confidence}`)}</span>
      </div>
    </Tooltip>
  );
}
