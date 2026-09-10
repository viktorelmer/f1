/**
 * Weather (docs/systems/weather.md): five quantities on a minute timeline, generated before the
 * race from the track's profile, plus the per-sector wetness and track grip that evolve while
 * the race runs.
 */
import { balance } from '@/data/balance';
import type { PackTrack } from '@/data/schema/pack';
import type { Rng } from '../rng/rng';
import type { SectorShape, TrackModel } from './track';
import { windInSector } from './track';
import type { WeatherSample, WeatherTimeline } from './types';

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const wrapDeg = (d: number) => ((d % 360) + 360) % 360;

/** The rain episode of a race, if any: minutes, intensity, and when the front reaches each sector. */
type RainEpisode = { start: number; end: number; intensity: number; lag: [number, number, number] };

function rainEpisode(track: PackTrack, rng: Rng): RainEpisode | null {
  const cfg = balance.weather.rain;
  // Draw everything regardless, so the stream advances the same way with or without rain.
  const wet = rng.chance(track.weather.rainChance);
  const start = rng.range(cfg.startWindowMin[0], cfg.startWindowMin[1]);
  const duration = rng.range(cfg.durationMin[0], cfg.durationMin[1]);
  const intensity = rng.range(cfg.intensity[0], cfg.intensity[1]);
  const first = rng.int(0, 2);
  const lagA = rng.range(cfg.frontLagMinPerSector[0], cfg.frontLagMinPerSector[1]);
  const lagB = rng.range(cfg.frontLagMinPerSector[0], cfg.frontLagMinPerSector[1]);
  if (!wet) return null;
  const lag: [number, number, number] = [0, 0, 0];
  lag[(first + 1) % 3] = lagA;
  lag[(first + 2) % 3] = lagA + lagB;
  return { start, end: start + duration, intensity, lag };
}

/** Rain intensity in a sector at a minute, ramping in and out at each edge of the episode. */
function rainAt(episode: RainEpisode | null, sector: number, minute: number): number {
  if (!episode) return 0;
  const start = episode.start + episode.lag[sector]!;
  const end = episode.end + episode.lag[sector]!;
  const ramp = balance.weather.rainShape.rampMinutes;
  if (minute <= start || minute >= end) return 0;
  const edge = Math.min(minute - start, end - minute);
  return episode.intensity * Math.min(1, edge / ramp);
}

export function generateWeather(track: PackTrack, rng: Rng): WeatherTimeline {
  const w = balance.weather;
  const perMinute = (sdPerHour: number) => sdPerHour / Math.sqrt(60);
  const [airLo, airHi] = track.weather.airTempC;
  const [offLo, offHi] = track.weather.trackTempOffsetC;
  const [windLo, windHi] = track.weather.windKph;

  let air = airLo + ((airHi - airLo) * (rng.next() + rng.next())) / 2;
  const sunOffset = rng.range(offLo, offHi);
  let cloud = rng.range(w.cloudStart[0], w.cloudStart[1]);
  let wind = rng.range(windLo, windHi);
  let windFrom = rng.range(0, 360);
  const baseHumidity = rng.range(w.humidity.range[0], w.humidity.range[1]);
  const episode = rainEpisode(track, rng);

  const equilibrium = (a: number, c: number, raining: number) =>
    a + Math.max(0, sunOffset - w.trackTempCloudDropC * c) * (1 - raining);
  let trackTemp = equilibrium(air, cloud, 0);

  const samples: WeatherSample[] = [];
  for (let minute = 0; minute <= w.timelineMinutes; minute++) {
    const rain: [number, number, number] = [0, 1, 2].map((k) => rainAt(episode, k, minute)) as [
      number,
      number,
      number,
    ];
    const raining = Math.max(...rain);
    samples.push({
      minute,
      airTempC: round(air, 2),
      trackTempC: round(trackTemp, 2),
      humidity: round(
        clamp(raining > 0 ? w.humidity.inRain : baseHumidity + w.humidity.perCloud * cloud, 0, 100),
        1,
      ),
      windKph: round(wind, 2),
      windFromDeg: round(windFrom, 1),
      cloud: round(cloud, 3),
      rain: rain.map((r) => round(r, 3)) as [number, number, number],
    });

    // Step to the next minute: random walks, cloud building ahead of rain, asphalt following.
    air +=
      rng.normal(0, perMinute(w.airTempDriftPerHourSd)) -
      (raining > 0 ? w.rainShape.airCoolingPerMinuteC : 0);
    wind = Math.max(0, wind + rng.normal(0, perMinute(w.windDriftPerHourSd.speedKph)));
    windFrom = wrapDeg(windFrom + rng.normal(0, perMinute(w.windDriftPerHourSd.directionDeg)));
    const shape = w.rainShape;
    const cloudTarget =
      episode &&
      minute >= episode.start - shape.cloudLeadMinutes &&
      minute <= episode.end + shape.cloudTrailMinutes
        ? 1
        : null;
    cloud =
      cloudTarget === null
        ? clamp(cloud + rng.normal(0, perMinute(w.cloudDriftPerHourSd)), 0, 1)
        : clamp(cloud + (cloudTarget - cloud) * shape.cloudApproachPerMinute, 0, 1);
    trackTemp += (equilibrium(air, cloud, raining) - trackTemp) / w.trackTempLagMinutes;
  }
  return { samples };
}

const round = (x: number, digits: number) => Math.round(x * 10 ** digits) / 10 ** digits;

/** Conditions at a race time in seconds (the timeline is per minute; the last sample holds after it). */
export function sampleAt(weather: WeatherTimeline, timeS: number): WeatherSample {
  const minute = Math.max(0, Math.floor(timeS / 60));
  return weather.samples[Math.min(minute, weather.samples.length - 1)]!;
}

// ── Surface state during the race ────────────────────────────────────────────────────────────

/** What the race changes about the track: water per sector and rubber on the racing line. */
export type SurfaceState = { wetness: [number, number, number]; grip: number; minute: number };

export function initialSurface(weather: WeatherTimeline): SurfaceState {
  const first = weather.samples[0]!;
  // A race that starts in the rain starts on a wet track.
  return {
    wetness: first.rain.map((r) => clamp(r * balance.weather.rainShape.startWetnessPerIntensity, 0, 1)) as [
      number,
      number,
      number,
    ],
    grip: balance.weather.evolution.raceStartGrip,
    minute: 0,
  };
}

/**
 * Advances the surface to `timeS`, a minute at a time: rain wets each sector, sun, wind and cars
 * dry it, rubber builds with car-laps and rain washes it off. `carLaps` is the car-laps run since
 * the last update.
 */
export function advanceSurface(
  state: SurfaceState,
  weather: WeatherTimeline,
  timeS: number,
  carLaps: number,
): SurfaceState {
  const w = balance.weather;
  const target = Math.floor(timeS / 60);
  if (target <= state.minute) {
    return { ...state, grip: clamp(state.grip + w.evolution.gripPerCarLap * carLaps, 0, 1) };
  }
  const wetness: [number, number, number] = [...state.wetness];
  let grip = state.grip + w.evolution.gripPerCarLap * carLaps;
  for (let m = state.minute; m < target; m++) {
    const s = weather.samples[Math.min(m, weather.samples.length - 1)]!;
    for (let k = 0; k < 3; k++) {
      const rain = s.rain[k]!;
      const drying =
        rain > w.rainShape.dryingBelowIntensity
          ? 0
          : w.drying.basePerMinute +
            w.drying.perDegTrackPerMinute * Math.max(0, s.trackTempC) +
            w.drying.perWindKphPerMinute * s.windKph +
            w.drying.racingLinePerMinute;
      wetness[k] = clamp(wetness[k]! + w.wettingPerMinute * rain - drying, 0, 1);
    }
    grip -= w.evolution.washPerWetnessPerMinute * ((wetness[0] + wetness[1] + wetness[2]) / 3);
  }
  return { wetness, grip: clamp(grip, 0, 1), minute: target };
}

// ── Effects on a lap ─────────────────────────────────────────────────────────────────────────

/** Share of lap time lost to heat and humidity (engine power), scaled by the track's power sensitivity. */
export function powerLossFraction(sample: WeatherSample, powerSensitivity: number): number {
  const w = balance.weather;
  return (
    powerSensitivity *
    (w.powerLossPerDegAbove25 * Math.max(0, sample.airTempC - 25) +
      w.powerLossPerHumidityPointAbove50 * Math.max(0, sample.humidity - 50))
  );
}

/** Seconds the wind adds to a sector: headwind on straights (−tail), crosswind in corners. */
export function windSeconds(shape: SectorShape, sample: WeatherSample): number {
  const { tail, cross } = windInSector(shape, sample.windKph, sample.windFromDeg);
  return -balance.weather.windStraightSPerKph * tail + balance.weather.crosswindCornerSPerKph * cross;
}

/** Share of lap time a sector's water costs on any tyre. */
export function wetSlowdownFraction(wetness: number): number {
  return balance.weather.wetSlowdownFraction * wetness;
}

/** Share of lap time lost to a track not fully rubbered in. */
export function greenTrackFraction(model: TrackModel, grip: number): number {
  return model.track.profile.trackEvolution * balance.weather.evolution.maxGreenPenaltyFraction * (1 - grip);
}
