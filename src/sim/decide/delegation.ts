/**
 * Delegation (plan 5.19): who decides in each area of the team. Delegation changes who decides,
 * never what the player sees, and can be switched at any moment without penalty.
 */
import type { StaffRole } from '@/data/schema/pack';

export const DELEGATION_AREAS = [
  'setup',
  'practice-programmes',
  'race-strategy',
  'race-radio',
  'development',
  'hiring',
  'social',
  'sponsorship',
  'scouting',
  'driver-training',
  'tyre-allocation',
] as const;
export type DelegationArea = (typeof DELEGATION_AREAS)[number];

/** manual: the player decides; directed: the player sets intent, staff do the detail; delegated: staff decide and report. */
export type DelegationMode = 'manual' | 'directed' | 'delegated';
export type DelegationSettings = Readonly<Record<DelegationArea, DelegationMode>>;

/** The staff role that runs each area (plan 5.19 table). */
export const DELEGATE_ROLE: Readonly<Record<DelegationArea, StaffRole>> = {
  setup: 'race-engineer',
  'practice-programmes': 'sporting-director',
  'race-strategy': 'strategist',
  'race-radio': 'race-engineer',
  development: 'technical-director',
  hiring: 'operations-director',
  social: 'head-of-marketing',
  sponsorship: 'commercial-director',
  scouting: 'scout',
  'driver-training': 'driver-coach',
  'tyre-allocation': 'strategist',
};

export const DELEGATION_PRESETS = ['full-control', 'principal', 'race-only'] as const;
export type DelegationPreset = (typeof DELEGATION_PRESETS)[number];

const WEEKEND_AREAS: ReadonlySet<DelegationArea> = new Set([
  'setup',
  'practice-programmes',
  'race-strategy',
  'race-radio',
  'tyre-allocation',
]);
const STRATEGIC_AREAS: ReadonlySet<DelegationArea> = new Set([
  'development',
  'race-strategy',
  'hiring',
  'sponsorship',
]);

/** Career-start presets (plan 5.19); the player can change any area afterwards. */
function presetMode(preset: DelegationPreset, area: DelegationArea): DelegationMode {
  switch (preset) {
    case 'full-control':
      return 'manual';
    case 'principal':
      return STRATEGIC_AREAS.has(area) ? 'manual' : 'directed';
    case 'race-only':
      return WEEKEND_AREAS.has(area) ? 'manual' : 'delegated';
  }
}

/** Areas can only be handed to someone who exists: without the role, the area stays manual. */
export function canDelegate(area: DelegationArea, roles: ReadonlySet<StaffRole>): boolean {
  return roles.has(DELEGATE_ROLE[area]);
}

export function resolveDelegation(
  preset: DelegationPreset,
  roles: ReadonlySet<StaffRole>,
): DelegationSettings {
  return Object.fromEntries(
    DELEGATION_AREAS.map((area) => [area, canDelegate(area, roles) ? presetMode(preset, area) : 'manual']),
  ) as Record<DelegationArea, DelegationMode>;
}
