/**
 * The game calendar. A GameDate is a whole number of days since 1970-01-01 in the proleptic
 * Gregorian calendar — the sim's own day index, never a JS date object (ADR 001). Between races
 * one tick is one day, so advancing time is `addDays(d, 1)` and comparing dates is `<`.
 *
 * Conversions use Howard Hinnant's integer days-from-civil algorithm:
 * https://howardhinnant.github.io/date_algorithms.html
 */

declare const gameDateBrand: unique symbol;

/** Days since 1970-01-01. Serialises as a plain number. */
export type GameDate = number & { readonly [gameDateBrand]: true };

export type CalendarDate = {
  readonly year: number;
  /** 1–12 */
  readonly month: number;
  /** 1–31 */
  readonly day: number;
};

/** 0 = Sunday … 6 = Saturday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// Calendar arithmetic, not balance: the Gregorian calendar repeats every 400 years (an era).
const DAYS_PER_ERA = 146_097;
/** Days from 0000-03-01, the algorithm's internal epoch, to 1970-01-01. */
const EPOCH_SHIFT = 719_468;
/** 1970-01-01 was a Thursday. */
const EPOCH_WEEKDAY = 4;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/** Builds a GameDate from a calendar date. Throws on dates that do not exist (e.g. 2027-02-29). */
export function gameDate(year: number, month: number, day: number): GameDate {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new RangeError(`GameDate parts must be integers: ${year}-${month}-${day}`);
  }
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`No such calendar date: ${year}-${month}-${day}`);
  }

  // Count years from March so the leap day falls at the end of the year.
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400; // [0, 399]
  const monthFromMarch = month > 2 ? month - 3 : month + 9; // [0, 11]
  const dayOfYear = Math.floor((153 * monthFromMarch + 2) / 5) + day - 1; // [0, 365]
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear; // [0, 146096]

  return (era * DAYS_PER_ERA + dayOfEra - EPOCH_SHIFT) as GameDate;
}

export function toCalendar(date: GameDate): CalendarDate {
  const z = date + EPOCH_SHIFT;
  const era = Math.floor(z / DAYS_PER_ERA);
  const dayOfEra = z - era * DAYS_PER_ERA; // [0, 146096]
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36_524) -
      Math.floor(dayOfEra / 146_096)) /
      365,
  ); // [0, 399]
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100)); // [0, 365]
  const monthFromMarch = Math.floor((5 * dayOfYear + 2) / 153); // [0, 11]
  const day = dayOfYear - Math.floor((153 * monthFromMarch + 2) / 5) + 1;
  const month = monthFromMarch < 10 ? monthFromMarch + 3 : monthFromMarch - 9;
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);

  return { year, month, day };
}

export function addDays(date: GameDate, days: number): GameDate {
  if (!Number.isInteger(days)) throw new RangeError(`Days must be an integer: ${days}`);
  return (date + days) as GameDate;
}

/** Signed number of days from `from` to `to`. */
export function daysBetween(from: GameDate, to: GameDate): number {
  return to - from;
}

export function weekday(date: GameDate): Weekday {
  return ((((date + EPOCH_WEEKDAY) % 7) + 7) % 7) as Weekday;
}
