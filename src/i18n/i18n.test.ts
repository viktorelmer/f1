import { describe, expect, it } from 'vitest';
import { gameDate } from '@/sim/types/game-date';
import { formatGameDate, formatMoneyMillions } from './format';
import { LANGUAGES, resources } from './index';

type Dict = { [key: string]: string | Dict };

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function flatten(dict: Dict, prefix = ''): string[] {
  return Object.entries(dict).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : flatten(value, `${prefix}${key}.`),
  );
}

const keysOf = (language: (typeof LANGUAGES)[number]) => flatten(resources[language].translation);

describe('dictionaries', () => {
  it('have the same keys in every language (plural forms aside)', () => {
    const [first, ...rest] = LANGUAGES.map(
      (language) => new Set(keysOf(language).map((k) => k.replace(PLURAL_SUFFIX, ''))),
    );
    for (const other of rest) expect([...other].sort()).toEqual([...first!].sort());
  });

  it('give every plural key all the forms the language needs', () => {
    for (const language of LANGUAGES) {
      const keys = keysOf(language);
      const pluralBases = new Set(
        keys.filter((k) => PLURAL_SUFFIX.test(k)).map((k) => k.replace(PLURAL_SUFFIX, '')),
      );
      const categories = new Intl.PluralRules(language).resolvedOptions().pluralCategories;

      for (const base of pluralBases) {
        for (const category of categories) expect(keys).toContain(`${base}_${category}`);
      }
    }
  });

  it('have no empty strings', () => {
    for (const language of LANGUAGES) {
      const empty = keysOf(language).filter((key) => {
        const value = key
          .split('.')
          .reduce<string | Dict>(
            (node, part) => (node as Dict)[part]!,
            resources[language].translation as Dict,
          );
        return value === '';
      });
      expect(empty).toEqual([]);
    }
  });
});

describe('formatting', () => {
  it('formats a GameDate in the player language, independent of time zone', () => {
    const date = gameDate(2027, 2, 22);
    expect(formatGameDate(date, 'en')).toBe('February 22, 2027');
    expect(formatGameDate(date, 'ru')).toBe('22 февраля 2027 г.');
    expect(formatGameDate(gameDate(1969, 12, 31), 'en')).toBe('December 31, 1969');
  });

  it('formats exact budgets in millions', () => {
    expect(formatMoneyMillions(142.6, 'en')).toBe('$142.6M');
    expect(formatMoneyMillions(142.6, 'ru')).toMatch(/^142,6\s?млн\s?\$$/);
  });
});
