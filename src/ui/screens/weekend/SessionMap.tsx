import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { PackGeometry, PackTrack } from '@/data/schema/pack';
import { fractionAtTimeShare, lapMotion } from '@/sim/race/motion';
import { parsePath, pathSampler } from '@/sim/race/track';
import type { Roster } from '../race/roster';

export type MapCar = { driverId: string; lapProgress: number };

/**
 * Where the cars on a flying lap are (docs/systems/weekend-play.md). A car's share of its lap time
 * is turned into a share of the lap's distance through the same speed profile the race screen uses,
 * so a car slows for the corners instead of sliding round at a constant rate.
 */
export const SessionMap = memo(function SessionMap({
  track,
  geometry,
  cars,
  roster,
}: {
  track: PackTrack;
  geometry: PackGeometry;
  cars: readonly MapCar[];
  roster: Roster;
}) {
  const { t } = useTranslation();
  const sample = useMemo(() => pathSampler(parsePath(geometry.path)), [geometry.path]);
  const motion = useMemo(() => lapMotion(track, geometry), [track, geometry]);
  const [x, y, w, h] = geometry.viewBox;

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
      {cars.map((car) => {
        const [cx, cy] = sample(fractionAtTimeShare(motion, car.lapProgress));
        const entry = roster.get(car.driverId);
        return (
          <g key={car.driverId}>
            <circle cx={cx} cy={cy} r={14} fill={entry?.colour ?? 'var(--color-hi)'} />
            {entry?.isPlayer && (
              <circle cx={cx} cy={cy} r={20} fill="none" stroke="var(--color-hi)" strokeWidth={4} />
            )}
          </g>
        );
      })}
    </svg>
  );
});
