import {
  carBalanceSchema,
  careerBalanceSchema,
  decideBalanceSchema,
  estimateBalanceSchema,
} from '@/data/schema/balance';
import car from './car.json';
import career from './career.json';
import decide from './decide.json';
import estimate from './estimate.json';

/**
 * All balance constants, validated and unwrapped from `{ value, why }` once at load. A file that
 * is missing a comment or a value fails here, before any system runs.
 */
export const balance = {
  estimate: estimateBalanceSchema.parse(estimate),
  decide: decideBalanceSchema.parse(decide),
  car: carBalanceSchema.parse(car),
  career: careerBalanceSchema.parse(career),
};

export type Balance = typeof balance;
