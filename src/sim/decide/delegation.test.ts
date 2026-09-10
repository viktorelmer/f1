import { describe, expect, it } from 'vitest';
import { STAFF_ROLES, type StaffRole } from '@/data/schema/pack';
import { DELEGATE_ROLE, DELEGATION_AREAS, resolveDelegation } from './delegation';

const ALL_ROLES = new Set<StaffRole>(STAFF_ROLES);

describe('delegation', () => {
  it('maps every area to a real staff role (plan 5.19)', () => {
    for (const area of DELEGATION_AREAS) expect(STAFF_ROLES).toContain(DELEGATE_ROLE[area]);
  });

  it('applies the three career-start presets', () => {
    expect(Object.values(resolveDelegation('full-control', ALL_ROLES)).every((m) => m === 'manual')).toBe(
      true,
    );

    const principal = resolveDelegation('principal', ALL_ROLES);
    expect(principal.development).toBe('manual');
    expect(principal.setup).toBe('directed');

    const raceOnly = resolveDelegation('race-only', ALL_ROLES);
    expect(raceOnly['race-strategy']).toBe('manual');
    expect(raceOnly.sponsorship).toBe('delegated');
  });

  it('keeps an area manual when nobody holds its role', () => {
    const noScout = new Set([...ALL_ROLES].filter((r) => r !== 'scout'));
    expect(resolveDelegation('race-only', noScout).scouting).toBe('manual');
    expect(resolveDelegation('race-only', noScout).social).toBe('delegated');
  });
});
