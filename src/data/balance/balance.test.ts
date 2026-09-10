import { describe, expect, it } from 'vitest';
import { careerBalanceSchema, decideBalanceSchema } from '@/data/schema/balance';
import { balance } from './index';
import career from './career.json';
import decide from './decide.json';

describe('balance files', () => {
  it('load as bare numbers, comments stripped', () => {
    expect(balance.decide.noiseSdAtSkill1).toBeTypeOf('number');
    expect(JSON.stringify(balance)).not.toMatch(/"why"/);
  });

  it('refuse a value without a comment (plan rule 4)', () => {
    const broken = JSON.parse(JSON.stringify(decide)) as Record<string, { value: number; why?: string }>;
    delete broken.blunderSize!.why;
    expect(decideBalanceSchema.safeParse(broken).success).toBe(false);
  });

  it('refuse a placeholder comment', () => {
    const broken = JSON.parse(JSON.stringify(decide)) as Record<string, { value: number; why: string }>;
    broken.blunderSize!.why = 'todo';
    expect(decideBalanceSchema.safeParse(broken).success).toBe(false);
  });

  it('refuse a bare number where a commented value belongs', () => {
    const broken = JSON.parse(JSON.stringify(career)) as { founder: Record<string, unknown> };
    broken.founder.heritageFreeSeasons = 2;
    expect(careerBalanceSchema.safeParse(broken).success).toBe(false);
  });
});
