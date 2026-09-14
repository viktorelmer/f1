import { z } from 'zod';
import { tuned } from './balance';
import { SETUP_PARAMETERS } from './pack';

/**
 * Constants of the car's setup (docs/systems/setup.md): what a wrong slider costs a lap, where the
 * optimum moves with the conditions, who may touch which slider, and how well the engineer can say
 * where that optimum is.
 */
const perParameter = <T extends z.ZodType>(value: T) =>
  z.strictObject(
    Object.fromEntries(SETUP_PARAMETERS.map((p) => [p, value])) as {
      [P in (typeof SETUP_PARAMETERS)[number]]: T;
    },
  );

export const setupBalanceSchema = z.strictObject({
  loss: tuned(
    z.strictObject({
      /** Seconds a lap this parameter costs at full deviation. */
      seconds: perParameter(z.number().min(0)),
      /** Points of the 0..100 scale that count as full deviation. */
      tolerance: z.number().positive(),
      /** Share of the tolerance that costs nothing: the window, not its centre. */
      plateau: z.number().min(0).max(1),
      exponent: z.number().min(1).max(4),
    }),
  ),
  ideal: tuned(
    z.strictObject({
      referenceTrackTempC: z.number(),
      windReferenceKph: z.number().min(0),
      /** Points the optimum moves per °C of track temperature over the reference. */
      perTrackTempC: perParameter(z.number()),
      perWindKph: perParameter(z.number()),
      /** Points the optimum moves on a fully wet track. */
      perWetness: perParameter(z.number()),
    }),
  ),
  access: tuned(
    z.strictObject({
      mechanicEngineer: z.number().min(0).max(100),
      mechanicSimulator: z.number().int().min(1).max(5),
      fineEngineer: z.number().min(0).max(100),
      fineSimulator: z.number().int().min(1).max(5),
      fineFeedback: z.number().min(0).max(100),
    }),
  ),
  reading: tuned(
    z.strictObject({
      baseSd: z.number().positive(),
      perEngineerPoint: z.number().min(0),
      engineerRef: z.number().min(0).max(100),
      perSimulatorLevel: z.number().min(0),
      perFeedbackPoint: z.number().min(0),
      feedbackRef: z.number().min(0).max(100),
      lapScale: z.number().positive(),
      minSd: z.number().positive(),
    }),
  ),
  feedback: tuned(
    z.strictObject({
      noticeableDeviation: z.number().min(0),
      wrongCauseAtRef: z.number().min(0).max(1),
      perFeedbackPoint: z.number().min(0),
      minWrongCause: z.number().min(0).max(1),
    }),
  ),
});

export type SetupBalance = z.output<typeof setupBalanceSchema>;
