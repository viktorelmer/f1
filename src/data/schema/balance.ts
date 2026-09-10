import { z } from 'zod';

/**
 * Balance files (plan rule 4): every tuned value is written as `{ "value": …, "why": "…" }` so the
 * reason travels with the number. `tuned()` validates both and unwraps to the bare value, so a
 * value without a comment fails to load.
 */
export function tuned<T extends z.ZodType>(value: T) {
  return z
    .strictObject({
      value,
      why: z.string().trim().min(12, 'Every balance value needs a real comment in "why".'),
    })
    .transform((entry) => (entry as { value: z.output<T> }).value);
}

const unit = z.number().min(0).max(1);
const positive = z.number().positive();

export const CHASSIS_PARTS = [
  'frontWing',
  'rearWing',
  'floor',
  'sidepods',
  'suspension',
  'brakes',
  'gearbox',
] as const;
export const chassisPartSchema = z.enum(CHASSIS_PARTS);
export type ChassisPart = z.infer<typeof chassisPartSchema>;

const partWeights = z
  .partialRecord(chassisPartSchema, positive)
  .refine((weights) => Object.keys(weights).length > 0, 'At least one part must contribute.');

export const estimateBalanceSchema = z.strictObject({
  intervalZ: tuned(positive),
  confidenceLabels: z.strictObject({ medium: tuned(unit), high: tuned(unit) }),
  quantities: z.strictObject({
    'driver.potential': tuned(z.strictObject({ min: z.number(), max: z.number(), wideSd: positive })),
  }),
  scouting: z.strictObject({
    potentialSdAtSkill1: tuned(positive),
    potentialSdAtSkill100: tuned(positive),
    ownDriverSdFactor: tuned(unit),
  }),
});

export const decideBalanceSchema = z.strictObject({
  noiseSdAtSkill0: tuned(positive),
  noiseSdAtSkill1: tuned(positive),
  blunderChanceAtConsistency0: tuned(unit),
  blunderChanceAtConsistency1: tuned(unit),
  blunderSize: tuned(positive),
  rapportNoiseReduction: tuned(unit),
});

export const carBalanceSchema = z.strictObject({
  downforceLow: tuned(partWeights),
  downforceHigh: tuned(partWeights),
  drag: tuned(partWeights),
  dirtyAirTolerance: tuned(partWeights),
  mechanicalGrip: tuned(partWeights),
  brakingStability: tuned(partWeights),
  rideHeightSensitivity: tuned(partWeights),
  tyreManagement: tuned(partWeights),
  chassisReliability: tuned(partWeights),
  overweightKgAtRating0: tuned(positive),
  powerUnitShareOfReliability: tuned(unit),
});

export const careerBalanceSchema = z.strictObject({
  founder: z.strictObject({
    startingCapitalM: tuned(positive),
    customerSpecPenalty: tuned(
      z.strictObject({
        power: z.number().min(0),
        ersDeployment: z.number().min(0),
        fuelEfficiency: z.number().min(0),
      }),
    ),
    heritageFreeSeasons: tuned(z.number().int().min(0)),
    startingReputation: tuned(z.number().min(0).max(100)),
    pointsBySeason: tuned(z.number().int().min(1)),
    topFiveBySeason: tuned(z.number().int().min(1)),
    driverSalaryM: tuned(positive),
    driverContractSeasons: tuned(z.number().int().min(1)),
    engineDealSeasons: tuned(z.number().int().min(1)),
  }),
  startingDepartment: tuned(
    z.strictObject({ morale: z.number().min(0).max(100), workload: z.number().min(0).max(100) }),
  ),
  principalReputation: z.strictObject({
    takeover: tuned(z.number().min(0).max(100)),
    founder: tuned(z.number().min(0).max(100)),
  }),
});

export type EstimateBalance = z.output<typeof estimateBalanceSchema>;
export type DecideBalance = z.output<typeof decideBalanceSchema>;
export type CarBalance = z.output<typeof carBalanceSchema>;
export type CareerBalance = z.output<typeof careerBalanceSchema>;
