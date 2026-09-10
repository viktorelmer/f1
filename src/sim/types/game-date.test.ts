import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, daysInMonth, gameDate, isLeapYear, toCalendar, weekday } from './game-date';

const MS_PER_DAY = 86_400_000;

describe('GameDate', () => {
  it('uses 1970-01-01 as day 0', () => {
    expect(gameDate(1970, 1, 1)).toBe(0);
    expect(gameDate(1969, 12, 31)).toBe(-1);
    expect(gameDate(2000, 3, 1)).toBe(11_017);
  });

  it('matches the host calendar for every day from 1900 to 2200', () => {
    // Tests may use the JS date API; the sim itself may not.
    const first = Date.UTC(1900, 0, 1) / MS_PER_DAY;
    const last = Date.UTC(2200, 11, 31) / MS_PER_DAY;

    for (let n = first; n <= last; n++) {
      const host = new Date(n * MS_PER_DAY);
      const expected = {
        year: host.getUTCFullYear(),
        month: host.getUTCMonth() + 1,
        day: host.getUTCDate(),
      };
      const date = gameDate(expected.year, expected.month, expected.day);

      if (date !== n) expect(date).toBe(n);
      const calendar = toCalendar(date);
      if (calendar.day !== expected.day || calendar.month !== expected.month) {
        expect(calendar).toEqual(expected);
      }
      if (weekday(date) !== host.getUTCDay()) expect(weekday(date)).toBe(host.getUTCDay());
    }
  });

  it('round-trips across era boundaries and negative years', () => {
    for (const [y, m, d] of [
      [-1, 3, 1],
      [0, 2, 29],
      [1600, 2, 29],
      [1700, 2, 28],
      [2000, 2, 29],
      [2400, 12, 31],
      [9999, 12, 31],
    ] as const) {
      expect(toCalendar(gameDate(y, m, d))).toEqual({ year: y, month: m, day: d });
    }
  });

  it('rejects dates that do not exist', () => {
    expect(() => gameDate(2027, 2, 29)).toThrow(RangeError);
    expect(() => gameDate(2027, 13, 1)).toThrow(RangeError);
    expect(() => gameDate(2027, 4, 31)).toThrow(RangeError);
    expect(() => gameDate(2027, 1, 0)).toThrow(RangeError);
    expect(() => gameDate(2027, 1, 1.5)).toThrow(RangeError);
  });

  it('applies the Gregorian leap-year rules', () => {
    expect([1900, 2000, 2024, 2027, 2100].map(isLeapYear)).toEqual([false, true, true, false, false]);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2027, 2)).toBe(28);
    expect(daysInMonth(2027, 9)).toBe(30);
  });

  it('advances and measures time in whole days', () => {
    const start = gameDate(2027, 2, 27);
    expect(toCalendar(addDays(start, 2))).toEqual({ year: 2027, month: 3, day: 1 });
    expect(daysBetween(gameDate(2027, 1, 1), gameDate(2028, 1, 1))).toBe(365);
    expect(() => addDays(start, 0.5)).toThrow(RangeError);
  });
});
