import {
  carBalanceSchema,
  careerBalanceSchema,
  decideBalanceSchema,
  estimateBalanceSchema,
} from '@/data/schema/balance';
import { raceBalanceSchema, tyresBalanceSchema, weatherBalanceSchema } from '@/data/schema/race-balance';
import { weekendBalanceSchema } from '@/data/schema/weekend-balance';
import car from './car.json';
import career from './career.json';
import decide from './decide.json';
import estimate from './estimate.json';
import race from './race.json';
import tyres from './tyres.json';
import weather from './weather.json';
import weekend from './weekend.json';

/**
 * All balance constants, validated and unwrapped from `{ value, why }` once at load. A file that
 * is missing a comment or a value fails here, before any system runs.
 */
export const balance = {
  estimate: estimateBalanceSchema.parse(estimate),
  decide: decideBalanceSchema.parse(decide),
  car: carBalanceSchema.parse(car),
  career: careerBalanceSchema.parse(career),
  race: raceBalanceSchema.parse(race),
  tyres: tyresBalanceSchema.parse(tyres),
  weather: weatherBalanceSchema.parse(weather),
  weekend: weekendBalanceSchema.parse(weekend),
};

export type Balance = typeof balance;
