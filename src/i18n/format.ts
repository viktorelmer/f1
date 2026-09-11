import type { GameDate } from '@/sim/types/game-date';

const MS_PER_DAY = 86_400_000;

/**
 * "24 February 2027" / "24 февраля 2027 г.". A GameDate counts days from the Unix epoch, so the
 * day's UTC midnight is one multiplication; formatting in UTC keeps the player's time zone out.
 */
export function formatGameDate(date: GameDate, language: string): string {
  return new Intl.DateTimeFormat(language, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date * MS_PER_DAY);
}

/** Exact money in millions of dollars: "$142.6M" / "142,6 млн $". */
export function formatMoneyMillions(millions: number, language: string): string {
  return new Intl.NumberFormat(language, {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(millions * 1_000_000);
}

/** A lap time: "1:32.418". */
export function formatLapTime(seconds: number): string {
  // Whole milliseconds first, so 59.9996 s rounds to 1:00.000, never 0:60.000.
  const ms = Math.round(seconds * 1000);
  const m = Math.floor(ms / 60_000);
  const rest = (ms - m * 60_000) / 1000;
  return `${m}:${rest.toFixed(3).padStart(6, '0')}`;
}

/** A race time: "1:34:08.865". */
export function formatRaceTime(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3_600_000);
  return `${h}:${formatLapTime((ms - h * 3_600_000) / 1000).padStart(9, '0')}`;
}

/** A gap or interval: "+1.234", with a decimal separator for the language. */
export function formatGap(seconds: number, language: string): string {
  return `+${new Intl.NumberFormat(language, { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(seconds)}`;
}
