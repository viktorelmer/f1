import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { PackGeometry } from '@/data/schema/pack';
import type { CarFrame } from '@/sim/race/replay';
import { parsePath, pathSampler, type Point } from '@/sim/race/track';
import type { Roster } from './roster';

const TYRE_VAR: Record<CarFrame['compound'], string> = {
  soft: 'var(--color-tyre-soft)',
  medium: 'var(--color-tyre-medium)',
  hard: 'var(--color-tyre-hard)',
  inter: 'var(--color-tyre-inter)',
  wet: 'var(--color-tyre-wet)',
};

/** Points along the path between two lap fractions (wrapping across the line). */
function stretch(sample: (f: number) => Point, from: number, to: number, steps = 24): string {
  const span = to >= from ? to - from : 1 - from + to;
  return Array.from({ length: steps + 1 }, (_, i) => sample(from + (span * i) / steps).join(',')).join(' ');
}

/**
 * The track map (plan 6.3): the SVG path, DRS zones, and a dot per car placed by lap fraction —
 * fill in the team colour, ring in the tyre compound. Retired cars leave a marker where they
 * stopped; cars in the pits wait by the line.
 */
export function TrackMap({
  geometry,
  cars,
  roster,
}: {
  geometry: PackGeometry;
  cars: readonly CarFrame[];
  roster: Roster;
}) {
  const { t } = useTranslation();
  const sample = useMemo(() => pathSampler(parsePath(geometry.path)), [geometry.path]);
  const [x, y, w, h] = geometry.viewBox;

  // Draw the player's cars last so they sit on top.
  const ordered = [...cars].sort(
    (a, b) =>
      Number(roster.get(a.driverId)?.isPlayer ?? false) - Number(roster.get(b.driverId)?.isPlayer ?? false),
  );

  return (
    <svg
      role="img"
      aria-label={t('race.map.title')}
      viewBox={`${x} ${y} ${w} ${h}`}
      className="h-full w-full"
    >
      <path
        d={geometry.path}
        fill="none"
        stroke="var(--color-line-strong)"
        strokeWidth={14}
        strokeLinejoin="round"
      />
      <path
        d={geometry.path}
        fill="none"
        stroke="var(--color-raised)"
        strokeWidth={9}
        strokeLinejoin="round"
      />
      {geometry.drsZones.map((zone) => (
        <polyline
          key={`${zone.from}-${zone.to}`}
          points={stretch(sample, zone.from, zone.to)}
          fill="none"
          stroke="var(--color-positive)"
          strokeOpacity={0.45}
          strokeWidth={9}
          strokeLinecap="round"
        >
          <title>{t('race.map.drs')}</title>
        </polyline>
      ))}
      {(() => {
        const [lx, ly] = sample(0);
        return <circle cx={lx} cy={ly} r={5} fill="var(--color-hi)" />;
      })()}
      {ordered.map((car) => {
        const who = roster.get(car.driverId);
        const [cx, cy] = sample(car.progress % 1);
        if (car.status === 'retired') {
          return (
            <g key={car.driverId} transform={`translate(${cx} ${cy})`} data-testid="map-retired">
              <title>{t('race.map.retired', { driver: who?.short ?? car.driverId })}</title>
              <path
                d="M-9,-9L9,9M9,-9L-9,9"
                stroke="var(--color-negative)"
                strokeWidth={4}
                strokeLinecap="round"
              />
            </g>
          );
        }
        const inPit = car.status === 'pit';
        return (
          <g
            key={car.driverId}
            transform={`translate(${cx} ${cy})`}
            opacity={inPit ? 0.45 : 1}
            data-testid="map-car"
          >
            <title>
              {who?.short ?? car.driverId} · P{car.position}
              {inPit ? ` · ${t('race.map.inPit')}` : ''}
            </title>
            <circle
              r={who?.isPlayer ? 13 : 10}
              fill={who?.colour ?? 'var(--color-lo)'}
              stroke={TYRE_VAR[car.compound]}
              strokeWidth={4}
            />
            {who?.isPlayer && (
              <text
                x={18}
                y={6}
                fontSize={22}
                fontWeight={600}
                fill="var(--color-hi)"
                stroke="var(--color-ground)"
                strokeWidth={5}
                paintOrder="stroke"
              >
                {who.short}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
