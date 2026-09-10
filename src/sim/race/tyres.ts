/**
 * Tyres (plan 5.4): three dry compounds plus inters and wets. Each has base grip, wear rate, a cliff
 * past a wear threshold, a working temperature window and a wetness band. Wear 0..1 drives time
 * loss; what wears a tyre is the car, the driver, the track, the temperature and the fuel load.
 */
import { balance } from '@/data/balance';
import type { Compound } from '@/data/schema/race-balance';

const spec = (c: Compound) => balance.tyres.compounds[c];

function outsideWindow(compound: Compound, trackTempC: number): number {
  const [lo, hi] = spec(compound).windowC;
  return trackTempC < lo ? lo - trackTempC : trackTempC > hi ? trackTempC - hi : 0;
}

/** Seconds a wetness costs this compound relative to its ideal conditions. */
export function wetnessLossS(compound: Compound, wetness: number): number {
  const { band, belowLossS, aboveLossS } = spec(compound).wet;
  const [lo, hi] = band;
  let loss = 0;
  if (lo > 0 && wetness < lo) loss += belowLossS * ((lo - wetness) / lo);
  if (hi < 1 && wetness > hi) loss += aboveLossS * ((wetness - hi) / (1 - hi)) ** 2;
  return loss;
}

/**
 * Lap-time loss of a tyre in seconds, relative to a new medium in its window on a dry track:
 * base grip, linear degradation up to the cliff, steep loss beyond it, temperature and water.
 */
export function tyreLossS(compound: Compound, wear: number, trackTempC: number, wetness: number): number {
  const s = spec(compound);
  const beforeCliff = Math.min(wear, s.cliffWear);
  const beyondCliff = Math.max(0, wear - s.cliffWear);
  return (
    s.gripOffsetS +
    s.secondsPerWear * beforeCliff +
    s.cliffSecondsPerWear * beyondCliff +
    balance.tyres.outOfWindowSPerDeg * outsideWindow(compound, trackTempC) +
    wetnessLossS(compound, wetness)
  );
}

export type WearContext = {
  trackDegFactor: number;
  carTyreManagement: number;
  driverTyreManagement: number;
  fuelKg: number;
  trackTempC: number;
  wetness: number;
};

/** Wear added over one lap. */
export function wearPerLap(compound: Compound, ctx: WearContext): number {
  const t = balance.tyres;
  const s = spec(compound);
  const car = Math.max(0.5, 1 - t.carWearPerPoint * (ctx.carTyreManagement - t.carTyreManagementRef));
  const driver = Math.max(
    0.5,
    1 - t.driverWearPerPoint * (ctx.driverTyreManagement - t.driverTyreManagementRef),
  );
  const fuel = 1 + t.fuelWearPerKg * ctx.fuelKg;
  const window = 1 + t.outOfWindowWearPerDeg * outsideWindow(compound, ctx.trackTempC);
  // Wet-weather tyres on a track drier than their band overheat and wear fast.
  const [lo] = s.wet.band;
  const offBand = lo > 0 && ctx.wetness < lo ? 1 + (t.offBandWearFactor - 1) * ((lo - ctx.wetness) / lo) : 1;
  return s.wearPerLap * ctx.trackDegFactor * car * driver * fuel * window * offBand;
}

/** Extra time on the first lap of a new set, while it comes up to temperature. */
export function warmupLossS(compound: Compound): number {
  return spec(compound).warmupLossS;
}

/** Wear at which compounds are compared for the conditions: a tyre a few laps into its stint. */
export const COMPARISON_WEAR = 0.2;

/** The compound that loses least in these conditions — what an ideal strategist would fit. */
export function bestCompoundFor(wetness: number, trackTempC: number): Compound {
  const candidates: Compound[] = ['soft', 'medium', 'hard', 'inter', 'wet'];
  let best: Compound = 'medium';
  let bestLoss = Infinity;
  for (const c of candidates) {
    const loss = tyreLossS(c, COMPARISON_WEAR, trackTempC, wetness);
    if (loss < bestLoss) [best, bestLoss] = [c, loss];
  }
  return best;
}

export const isDry = (c: Compound) => c === 'soft' || c === 'medium' || c === 'hard';
