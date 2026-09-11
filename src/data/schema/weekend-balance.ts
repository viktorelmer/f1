import { z } from 'zod';
import { tuned } from './balance';

/**
 * Constants of the race weekend outside the race itself (docs/systems/weekend.md): how long a
 * session is, what each run programme costs, and how much a team learns from running.
 */
const positive = z.number().positive();
const nonNegative = z.number().min(0);
const unit = z.number().min(0).max(1);

export const PROGRAMMES = ['setup', 'long-run', 'qualifying-sim', 'fuel-calibration', 'rookie'] as const;
export type ProgrammeKind = (typeof PROGRAMMES)[number];

const exhaustive = <T extends z.ZodType>(keys: readonly string[], value: T) =>
  z.strictObject(Object.fromEntries(keys.map((k) => [k, value])));

export const weekendBalanceSchema = z.strictObject({
  session: tuned(
    z.strictObject({
      practiceMinutes: positive,
      outLapShare: unit,
      inLapShare: unit,
      boxMinutes: nonNegative,
    }),
  ),
  programmes: tuned(
    exhaustive(PROGRAMMES, z.strictObject({ laps: z.number().int().min(1), fresh: z.boolean() })),
  ),
  fuel: tuned(z.strictObject({ longRunKg: positive, qualifyingKg: positive, defaultKg: positive })),
  setup: tuned(
    z.strictObject({
      rawLossS: positive,
      lapScale: positive,
      engineerRef: positive,
      floorAtRef: nonNegative,
      floorPerPoint: nonNegative,
    }),
  ),
  qualifying: tuned(
    z.strictObject({
      partMinutes: z.tuple([positive, positive, positive]),
      knockedOut: z.number().int().min(1),
      fuelKg: positive,
      pitExitS: nonNegative,
      outLapFactor: z.number().min(1),
      gripAtStart: unit,
      evolutionGainFraction: unit,
      runWindows: z.array(unit).min(2),
      windowSpreadS: nonNegative,
      safetyValueS: nonNegative,
      roomValueS: nonNegative,
      trafficWindowS: positive,
      trafficLossS: nonNegative,
      maxTrafficShare: unit,
    }),
  ),
  scouting: tuned(
    z.strictObject({
      sdBaseS: positive,
      departmentRef: positive,
      sdPerDepartmentPoint: nonNegative,
      minSdFactor: unit,
      hidingBiasS: nonNegative,
      hidingAppetite: unit,
      hidingFuelKg: nonNegative,
      hidingLearningShare: unit,
    }),
  ),
  learning: tuned(
    z.strictObject({
      degradationSdBase: positive,
      fuelSdBase: positive,
      departmentRef: positive,
      sdPerDepartmentPoint: nonNegative,
      minSdFactor: unit,
      priorDegradationSd: positive,
      priorFuelSd: positive,
    }),
  ),
});

export type WeekendBalance = z.output<typeof weekendBalanceSchema>;
