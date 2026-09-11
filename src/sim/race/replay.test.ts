import { describe, expect, it } from 'vitest';
import { loadActivePack } from '@/data/packs/active';
import { createWorld } from '../world/create-world';
import { buildRaceInput } from './build-input';
import { buildReplay, frameAt } from './replay';
import { simulateRace } from './simulate';
import { pathSampler } from './track';

const pack = loadActivePack();
const world = createWorld('replay-tests', pack, {
  mode: 'takeover',
  teamId: 'kestrel',
  principalName: 'Test',
});
const roundOf = (trackId: string) => world.season.calendar.find((r) => r.trackId === trackId)!.round;

/** A race with a stop, a retirement and a safety car, found by trying seeds. */
function eventfulRace() {
  for (let i = 0; i < 60; i++) {
    const input = buildRaceInput(world, pack, roundOf('marina-lights'), `replay-${i}`);
    const result = simulateRace(input);
    const kinds = new Set(result.events.map((e) => e.kind));
    if (kinds.has('retirement') && kinds.has('safety-car') && kinds.has('pit')) return { input, result };
  }
  throw new Error('no eventful race in 60 seeds');
}

const { input, result } = eventfulRace();
const replay = buildReplay(input, result);
const samples = Array.from({ length: 200 }, (_, i) => (replay.durationS * i) / 199);

describe('buildReplay / frameAt', () => {
  it('ends on the final classification, in order, with the same statuses, stops, gaps and laps down', () => {
    const end = frameAt(replay, replay.durationS);
    expect(end.finished).toBe(true);
    expect(end.cars.map((c) => c.driverId)).toEqual(result.classification.map((c) => c.driverId));
    for (const [i, c] of result.classification.entries()) {
      expect(end.cars[i]!.status).toBe(c.status);
      expect(end.cars[i]!.stops).toBe(c.stops);
      if (c.status === 'finished') {
        expect(end.cars[i]!.lapsDown).toBe(c.lapsDown);
        if (c.gapS !== null && i > 0) expect(end.cars[i]!.gapS).toBe(c.gapS);
      }
    }
  });

  it('stands the cars on the grid at the signal, in grid order behind the line', () => {
    const frame = frameAt(replay, 0);
    expect(frame.cars.map((c) => c.driverId)).toEqual(input.grid);
    expect(frame.cars.every((c) => c.progress <= 0)).toBe(true);
  });

  it('gives every frame unique positions, ordered by distance for cars still racing', () => {
    for (const t of samples) {
      const frame = frameAt(replay, t);
      expect(frame.cars.map((c) => c.position)).toEqual(frame.cars.map((_, i) => i + 1));
      const racing = frame.cars.filter((c) => c.status !== 'retired');
      for (let i = 1; i < racing.length; i++)
        expect(racing[i]!.progress).toBeLessThanOrEqual(racing[i - 1]!.progress);
      expect(frame.lap).toBeGreaterThanOrEqual(1);
      expect(frame.lap).toBeLessThanOrEqual(frame.totalLaps);
    }
  });

  it('never moves a car backwards', () => {
    const last = new Map<string, number>();
    for (const t of samples) {
      for (const car of frameAt(replay, t).cars) {
        expect(car.progress).toBeGreaterThanOrEqual((last.get(car.driverId) ?? -Infinity) - 1e-9);
        last.set(car.driverId, car.progress);
      }
    }
  });

  it('matches the lap chart: the gap to the leader just after a car crosses the line', () => {
    const p2 = result.classification[1]!;
    for (const lap of result.laps[p2.driverId]!.filter((l) => l.lap % 7 === 0)) {
      // Its own line crossing: summing the rounded lap times drifts by a few ms over a race.
      const perLap = replay.segmentBounds.length - 1;
      const crossing = replay.cars.find((c) => c.driverId === p2.driverId)!.ends[lap.lap * perLap - 1]!;
      const car = frameAt(replay, crossing + 1e-3).cars.find((c) => c.driverId === p2.driverId)!;
      if (car.position === 2 && lap.position === 2 && car.gapS !== null)
        expect(car.gapS).toBeCloseTo(lap.gapToLeaderS, 1);
    }
  });

  it('shows only the events that have happened', () => {
    let previous = 0;
    for (const t of samples) {
      const events = frameAt(replay, t).events;
      expect(events.every((e) => e.timeS <= t)).toBe(true);
      expect(events.length).toBeGreaterThanOrEqual(previous);
      previous = events.length;
    }
    expect(previous).toBe(result.events.length);
  });

  it('holds a car still in the box during its stop', () => {
    const stop = result.events.find((e) => e.kind === 'pit')!;
    const during = [stop.timeS + 1, stop.timeS + 8].map((t) =>
      frameAt(replay, t).cars.find((c) => c.driverId === stop.driverId)!,
    );
    expect(during.map((c) => c.status)).toEqual(['pit', 'pit']);
    expect(during[1]!.progress).toBeCloseTo(during[0]!.progress, 10);
  });

  it('flags the safety car while it is out', () => {
    const sc = result.events.find((e) => e.kind === 'safety-car')!;
    expect(frameAt(replay, sc.timeS + 1).status).toBe('sc');
    const back = result.events.find((e) => e.kind === 'safety-car-in' && e.timeS > sc.timeS);
    if (back) expect(frameAt(replay, back.timeS + 1).status).not.toBe('sc');
  });

  it('drops a retired car to the back, at the place it stopped', () => {
    const out = result.events.find((e) => e.kind === 'retirement')!;
    const before = frameAt(replay, out.timeS - 1).cars.find((c) => c.driverId === out.driverId)!;
    const after = frameAt(replay, out.timeS + 30);
    const car = after.cars.find((c) => c.driverId === out.driverId)!;
    expect(car.status).toBe('retired');
    expect(car.retireReason).not.toBeNull();
    expect(after.cars.slice(car.position).every((c) => c.status === 'retired')).toBe(true);
    expect(car.progress).toBeGreaterThanOrEqual(before.progress - 1e-9);
    expect(frameAt(replay, out.timeS + 300).cars.find((c) => c.driverId === out.driverId)!.progress).toBe(
      car.progress,
    );
  });
});

describe('pathSampler', () => {
  const square = pathSampler([
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ]);

  it('walks a closed polyline by distance', () => {
    expect(square(0)).toEqual([0, 0]);
    expect(square(0.125)).toEqual([5, 0]);
    expect(square(0.25)).toEqual([10, 0]);
    expect(square(0.5)).toEqual([10, 10]);
    expect(square(0.875)).toEqual([0, 5]);
  });

  it('wraps round the lap', () => {
    expect(square(1)).toEqual([0, 0]);
    expect(square(1.25)).toEqual(square(0.25));
    expect(square(-0.25)).toEqual(square(0.75));
  });
});
