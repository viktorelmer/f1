import { scaleLinear } from 'd3-scale';
import { line } from 'd3-shape';
import { memo, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatGap } from '@/i18n/format';
import type { RaceEvent, RaceResult } from '@/sim/race/types';
import type { Roster } from './roster';
import { neutralisedBands } from './view-model';

const HEIGHT = 200;
const PAD = { top: 12, right: 72, bottom: 24, left: 40 };
/** Gaps above this are off the chart: lapped cars would flatten everyone else. */
const MAX_GAP_S = 60;

/**
 * Gap to the leader, lap by lap. The field is quiet context; the player's drivers carry the accent
 * and a direct label; hovering picks out a lap with a crosshair and the gaps at it.
 */
export const GapChart = memo(function GapChart({
  result,
  roster,
  lapsDone,
  events,
  width,
}: {
  result: RaceResult;
  roster: Roster;
  lapsDone: number;
  events: readonly RaceEvent[];
  width: number;
}) {
  const { t, i18n } = useTranslation();
  const [hoverLap, setHoverLap] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const totalLaps = Math.max(2, ...Object.values(result.laps).map((l) => l.length));

  const series = useMemo(
    () =>
      Object.entries(result.laps).map(([driverId, laps]) => ({
        driverId,
        points: laps
          .filter((l) => l.lap <= lapsDone)
          .map((l) => [l.lap, Math.min(MAX_GAP_S, l.gapToLeaderS)] as const),
      })),
    [result, lapsDone],
  );

  if (lapsDone < 1) return <p className="p-3 text-sm text-lo">{t('race.gaps.noData')}</p>;

  const x = scaleLinear()
    .domain([1, totalLaps])
    .range([PAD.left, width - PAD.right]);
  const maxGap = Math.max(5, ...series.flatMap((s) => s.points.map((p) => p[1])));
  const y = scaleLinear()
    .domain([0, Math.min(MAX_GAP_S, Math.ceil(maxGap / 5) * 5)])
    .range([PAD.top, HEIGHT - PAD.bottom]);
  const path = line<readonly [number, number]>()
    .x((p) => x(p[0]))
    .y((p) => y(p[1]));
  const yTicks = y.ticks(4);
  const xTicks = x.ticks(Math.min(10, totalLaps));
  const bands = neutralisedBands(events, lapsDone);
  const mine = series.filter((s) => roster.get(s.driverId)?.isPlayer);
  const others = series.filter((s) => !roster.get(s.driverId)?.isPlayer);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const lap = Math.round(x.invert(((e.clientX - box.left) / box.width) * width));
    setHoverLap(Math.min(lapsDone, Math.max(1, lap)));
  };
  const atHover =
    hoverLap === null
      ? []
      : Object.entries(result.laps)
          .flatMap(([driverId, laps]) => {
            const lap = laps.find((l) => l.lap === hoverLap);
            return lap ? [{ driverId, gap: lap.gapToLeaderS, position: lap.position }] : [];
          })
          .sort((a, b) => a.position - b.position)
          .filter((r, i) => i < 3 || roster.get(r.driverId)?.isPlayer);

  return (
    <figure className="flex flex-col gap-1 px-3 pt-2">
      <figcaption className="flex items-center gap-4 text-xs text-lo">
        <span className="font-semibold text-hi">{t('race.gaps.title')}</span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-4 bg-accent" />
          {t('race.gaps.legendYou')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-px w-4 bg-line-strong" />
          {t('race.gaps.legendOthers')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-3 bg-caution/20" />
          {t('race.gaps.safetyCar')} / {t('race.gaps.vsc')}
        </span>
      </figcaption>
      <div className="relative">
        <svg
          ref={svg}
          role="img"
          aria-label={t('race.gaps.title')}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          className="block w-full"
          onPointerMove={onMove}
          onPointerLeave={() => setHoverLap(null)}
        >
          {bands.map((b) => (
            <rect
              key={`${b.kind}-${b.from}`}
              x={x(b.from)}
              width={Math.max(2, x(b.to) - x(b.from))}
              y={PAD.top}
              height={HEIGHT - PAD.top - PAD.bottom}
              fill="var(--color-caution)"
              fillOpacity={b.kind === 'sc' ? 0.18 : 0.1}
            />
          ))}
          {yTicks.map((v) => (
            <g key={`y${v}`}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(v)}
                y2={y(v)}
                stroke="var(--color-line)"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 6}
                y={y(v) + 4}
                textAnchor="end"
                fontSize={10}
                fill="var(--color-lo)"
                className="tabular-nums"
              >
                {v}
              </text>
            </g>
          ))}
          {xTicks.map((v) => (
            <text
              key={`x${v}`}
              x={x(v)}
              y={HEIGHT - 6}
              textAnchor="middle"
              fontSize={10}
              fill="var(--color-lo)"
              className="tabular-nums"
            >
              {v}
            </text>
          ))}
          <text x={PAD.left} y={HEIGHT - 6} dx={-34} fontSize={10} fill="var(--color-lo)">
            {t('race.gaps.xAxis')}
          </text>
          {others.map((s) => (
            <path
              key={s.driverId}
              d={path(s.points) ?? ''}
              fill="none"
              stroke="var(--color-line-strong)"
              strokeWidth={1}
            />
          ))}
          {mine.map((s) => {
            const last = s.points.at(-1);
            return (
              <g key={s.driverId} data-testid="gap-line-player">
                <path
                  d={path(s.points) ?? ''}
                  fill="none"
                  stroke="var(--color-accent)"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {last && (
                  <>
                    <circle
                      cx={x(last[0])}
                      cy={y(last[1])}
                      r={4}
                      fill="var(--color-accent)"
                      stroke="var(--color-panel)"
                      strokeWidth={2}
                    />
                    <text
                      x={x(last[0]) + 8}
                      y={y(last[1]) + 4}
                      fontSize={11}
                      fontWeight={600}
                      fill="var(--color-hi)"
                    >
                      {roster.get(s.driverId)?.short}
                    </text>
                  </>
                )}
              </g>
            );
          })}
          {hoverLap !== null && (
            <line
              x1={x(hoverLap)}
              x2={x(hoverLap)}
              y1={PAD.top}
              y2={HEIGHT - PAD.bottom}
              stroke="var(--color-hi)"
              strokeOpacity={0.5}
            />
          )}
        </svg>
        {hoverLap !== null && atHover.length > 0 && (
          <div
            role="tooltip"
            className="pointer-events-none absolute top-1 rounded-sm border border-line-strong bg-raised px-2 py-1 text-xs shadow-lg"
            style={{ left: `calc(${(x(hoverLap) / width) * 100}% + 8px)` }}
          >
            <div className="font-semibold">{t('race.gaps.tooltip', { lap: hoverLap })}</div>
            {atHover.map((r) => (
              <div key={r.driverId} className="flex justify-between gap-3 font-mono tabular-nums">
                <span className={roster.get(r.driverId)?.isPlayer ? 'text-hi' : 'text-lo'}>
                  P{r.position} {roster.get(r.driverId)?.short}
                </span>
                <span>{r.position === 1 ? '—' : formatGap(r.gap, i18n.language)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="sr-only">{t('race.gaps.yAxis')}</p>
    </figure>
  );
});
