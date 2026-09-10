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
