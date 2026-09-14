import { z } from 'zod';
import { tuned } from './balance';

/**
 * Constants of car development (docs/systems/car-development.md): how long a part takes, what the
 * office gets through, what an upgrade is worth, and how well a team knows that before it runs it.
 */
export const RND_STAGES = ['concept', 'research', 'design', 'production', 'installed', 'validated'] as const;
export type RnDStage = (typeof RND_STAGES)[number];

/** The four stages that take work; `installed` and `validated` are states, not work. */
export const WORK_STAGES = ['concept', 'research', 'design', 'production'] as const;
export type WorkStage = (typeof WORK_STAGES)[number];

const perWorkStage = <T extends z.ZodType>(value: T) =>
  z.strictObject(Object.fromEntries(WORK_STAGES.map((s) => [s, value])) as { [P in WorkStage]: T });

const perStage = <T extends z.ZodType>(value: T) =>
  z.strictObject(Object.fromEntries(RND_STAGES.map((s) => [s, value])) as { [P in RnDStage]: T });

export const developmentBalanceSchema = z.strictObject({
  stages: tuned(
    z.strictObject({
      /** Days of work a stage takes at the reference office with a normal share of the tunnel. */
      days: perWorkStage(z.number().positive()),
      /** Share of a stage's work the wind tunnel and CFD do, rather than people. */
      atrShareOfWork: perWorkStage(z.number().min(0).max(1)),
    }),
  ),
  capacity: tuned(
    z.strictObject({
      referenceQuality: z.number().min(1).max(100),
      referenceHeadcount: z.number().positive(),
      qualityWeight: z.number().min(0).max(1),
      projectsWithoutPenalty: z.number().int().min(1),
      overloadPenalty: z.number().min(0).max(1),
      minFactor: z.number().min(0).max(1),
    }),
  ),
  gain: tuned(
    z.strictObject({
      ceilingAtReference: z.number().positive(),
      ceilingPerAeroPoint: z.number().min(0),
      aeroReference: z.number().min(1).max(100),
      ceilingPerAtrShare: z.number().min(0),
      minCeiling: z.number().min(0),
      spend: z.strictObject({ perStageM: z.number().min(0), perAtrShareM: z.number().min(0) }),
    }),
  ),
  uncertainty: tuned(
    z.strictObject({
      sdAtReference: z.number().positive(),
      sdPerAeroPoint: z.number().min(0),
      sdPerSimulatorLevel: z.number().min(0),
      sdPerAtrShare: z.number().min(0),
      minSd: z.number().positive(),
      stageSdFactor: perStage(z.number().min(0)),
    }),
  ),
  correlation: tuned(
    z.strictObject({
      /** Points of surprise on top of the team's own bias, per part. */
      noiseSd: z.number().min(0),
      /** How tightly a session of running measures what a part actually gave. */
      validationSd: z.number().positive(),
      /** How well a team knows its own tunnel before it has checked any part on track. */
      priorSd: z.number().positive(),
    }),
  ),
  philosophy: tuned(
    z.strictObject({
      matchBonus: z.number().min(0),
      mismatchPenalty: z.number().min(0).max(1),
      switchLossShare: z.number().min(0).max(1),
    }),
  ),
});

export type DevelopmentBalance = z.output<typeof developmentBalanceSchema>;
