/** Balance schemas for the race core (M2): tyres.json, weather.json, race.json. See balance.ts for `tuned()`. */
import { z } from 'zod';
import { tuned } from './balance';

const num = z.number();
const positive = z.number().positive();
const nonNegative = z.number().min(0);
const unit = z.number().min(0).max(1);
const range = (inner: z.ZodNumber = num) =>
  z.tuple([inner, inner]).refine(([a, b]) => a <= b, 'range must be [low, high]');

export const DRY_COMPOUNDS = ['soft', 'medium', 'hard'] as const;
export const COMPOUNDS = [...DRY_COMPOUNDS, 'inter', 'wet'] as const;
export type Compound = (typeof COMPOUNDS)[number];
export type DryCompound = (typeof DRY_COMPOUNDS)[number];

const compoundSchema = z.strictObject({
  gripOffsetS: num,
  wearPerLap: positive,
  secondsPerWear: positive,
  cliffWear: unit,
  cliffSecondsPerWear: nonNegative,
  windowC: range(),
  warmupLossS: nonNegative,
  wet: z.strictObject({ band: range(unit), belowLossS: nonNegative, aboveLossS: nonNegative }),
});

export const tyresBalanceSchema = z.strictObject({
  compounds: z.strictObject(
    Object.fromEntries(COMPOUNDS.map((c) => [c, tuned(compoundSchema)])) as Record<
      Compound,
      ReturnType<typeof tuned<typeof compoundSchema>>
    >,
  ),
  outOfWindowSPerDeg: tuned(nonNegative),
  outOfWindowWearPerDeg: tuned(nonNegative),
  offBandWearFactor: tuned(positive),
  carTyreManagementRef: tuned(positive),
  carWearPerPoint: tuned(nonNegative),
  driverTyreManagementRef: tuned(positive),
  driverWearPerPoint: tuned(nonNegative),
  fuelWearPerKg: tuned(nonNegative),
  puncture: tuned(
    z.strictObject({
      chancePerLap: unit,
      beyondCliffMultiplier: positive,
      lossS: positive,
      retireShare: unit,
    }),
  ),
});

export const weatherBalanceSchema = z.strictObject({
  timelineMinutes: tuned(z.number().int().min(60)),
  cloudStart: tuned(range(unit)),
  cloudDriftPerHourSd: tuned(nonNegative),
  trackTempCloudDropC: tuned(nonNegative),
  trackTempLagMinutes: tuned(positive),
  airTempDriftPerHourSd: tuned(nonNegative),
  humidity: tuned(z.strictObject({ range: range(), perCloud: nonNegative, inRain: z.number().max(100) })),
  windDriftPerHourSd: tuned(z.strictObject({ directionDeg: nonNegative, speedKph: nonNegative })),
  rain: tuned(
    z.strictObject({
      startWindowMin: range(nonNegative),
      durationMin: range(positive),
      intensity: range(unit),
      frontLagMinPerSector: range(nonNegative),
    }),
  ),
  rainShape: tuned(
    z.strictObject({
      rampMinutes: positive,
      cloudLeadMinutes: nonNegative,
      cloudTrailMinutes: nonNegative,
      cloudApproachPerMinute: unit,
      airCoolingPerMinuteC: nonNegative,
      startWetnessPerIntensity: unit,
      dryingBelowIntensity: unit,
    }),
  ),
  wettingPerMinute: tuned(positive),
  drying: tuned(
    z.strictObject({
      basePerMinute: nonNegative,
      perDegTrackPerMinute: nonNegative,
      perWindKphPerMinute: nonNegative,
      racingLinePerMinute: nonNegative,
    }),
  ),
  powerLossPerDegAbove25: tuned(nonNegative),
  powerLossPerHumidityPointAbove50: tuned(nonNegative),
  windStraightSPerKph: tuned(nonNegative),
  crosswindCornerSPerKph: tuned(nonNegative),
  wetSlowdownFraction: tuned(unit),
  evolution: tuned(
    z.strictObject({
      raceStartGrip: unit,
      gripPerCarLap: nonNegative,
      washPerWetnessPerMinute: nonNegative,
      maxGreenPenaltyFraction: unit,
    }),
  ),
});

export const raceBalanceSchema = z.strictObject({
  car: tuned(
    z.strictObject({
      referenceScore: positive,
      paceSensitivity: positive,
      weights: z.strictObject({
        aeroBase: nonNegative,
        aeroPerSensitivity: nonNegative,
        powerBase: nonNegative,
        powerPerSensitivity: nonNegative,
        mechanicalBase: nonNegative,
        mechanicalPerLowSpeedShare: nonNegative,
        brakingBase: nonNegative,
        brakingPerBrakeWear: nonNegative,
      }),
      powerMix: z.strictObject({ power: nonNegative, ers: nonNegative, lowDrag: nonNegative }),
    }),
  ),
  weightSPerKgPer90s: tuned(nonNegative),
  driver: tuned(
    z.strictObject({
      referencePace: positive,
      paceSensitivity: nonNegative,
      formSensitivity: nonNegative,
      moraleSensitivity: nonNegative,
      wetSkillSensitivity: nonNegative,
    }),
  ),
  lapNoiseSd: tuned(z.strictObject({ atConsistency100: nonNegative, atConsistency60: nonNegative })),
  fatigue: tuned(
    z.strictObject({
      perLap: nonNegative,
      perDegAbove25: nonNegative,
      perHighSpeedCorner: nonNegative,
      staminaRef: positive,
      staminaPerPoint: nonNegative,
      freeUpTo: nonNegative,
      paceSPer10: nonNegative,
      mistakeFactorPer10: nonNegative,
    }),
  ),
  mistakes: tuned(
    z.strictObject({
      chancePerLapAt85: unit,
      perConsistencyPoint: nonNegative,
      wetMultiplier: nonNegative,
      gripDeficitMultiplierPerS: nonNegative,
      minorLossS: range(nonNegative),
      spinShare: unit,
      spinLossS: range(nonNegative),
      crashShareOfSpins: unit,
      minChancePerLap: unit,
      crashShareProfileBase: nonNegative,
      crashShareProfilePer: nonNegative,
    }),
  ),
  start: tuned(
    z.strictObject({
      gridSlotS: nonNegative,
      dirtySideS: nonNegative,
      standingStartLossS: nonNegative,
      skillRef: positive,
      skillSPerPoint: nonNegative,
      spreadSd: nonNegative,
      badLaunchChance: unit,
      badLaunchLossS: nonNegative,
      lap1ContactChance: unit,
    }),
  ),
  traffic: tuned(
    z.strictObject({
      minGapS: positive,
      dirtyAirWindowS: positive,
      dirtyAirLossS: nonNegative,
      slipstreamWindowS: positive,
      slipstreamGainS: nonNegative,
      lappedLossS: nonNegative,
      lapperLossS: nonNegative,
      toleranceRef: positive,
      lossPerTolerancePoint: nonNegative,
      dirtyAirAeroBase: nonNegative,
    }),
  ),
  drs: tuned(
    z.strictObject({
      gainS: nonNegative,
      referenceZoneShare: positive,
      windowS: positive,
      enabledFromLap: z.number().int().min(1),
      disabledLapsAfterRestart: z.number().int().min(0),
    }),
  ),
  overtaking: tuned(
    z.strictObject({
      base: num,
      perPaceS: num,
      drs: num,
      outsideDrsZone: num,
      perRacecraft: num,
      perWearDifference: num,
      perDifficulty: num,
      lap1Bonus: num,
      ersAttack: num,
      successMarginS: nonNegative,
      defenseLossS: nonNegative,
      failedAttackerLossS: nonNegative,
      failedDefenderLossS: nonNegative,
      outsideDrsMinAdvantageS: nonNegative,
      paceAdvantageCapS: positive,
      contactChance: unit,
      minAttackChance: unit,
      paceMemory: unit,
      defenceReportLaps: positive,
    }),
  ),
  ers: tuned(
    z.strictObject({
      referenceDeployment: positive,
      harvestPerLap: unit,
      attackCost: unit,
    }),
  ),
  fuel: tuned(
    z.strictObject({
      efficiencyRef: positive,
      consumptionPerPoint: nonNegative,
      marginKg: nonNegative,
      safetyZ: nonNegative,
    }),
  ),
  pit: tuned(
    z.strictObject({
      stationaryBaseS: positive,
      crewRef: positive,
      crewSPerPoint: nonNegative,
      stationarySd: nonNegative,
      slowStopChance: unit,
      slowStopLossS: range(nonNegative),
      safetyCarLossFactor: unit,
      virtualSafetyCarLossFactor: unit,
      minStationaryS: positive,
      crewWithoutChiefMechanic: z.number().min(1).max(100),
    }),
  ),
  reliability: tuned(
    z.strictObject({
      failureScale: unit,
      partialShare: unit,
      partialLossS: nonNegative,
      powerUnitShare: unit,
    }),
  ),
  damage: tuned(z.strictObject({ contactLossS: nonNegative, retireShare: unit, punctureShare: unit })),
  stewards: tuned(z.strictObject({ penaltyChance: unit, penaltyS: nonNegative })),
  sprint: tuned(z.strictObject({ distanceShare: unit })),
  raceControl: tuned(
    z.strictObject({
      crashSafetyCarBase: unit,
      crashSafetyCarPerProfile: unit,
      stoppedCarVscBase: unit,
      stoppedCarVscPerProfile: unit,
      stoppedCarSafetyCarPerProfile: unit,
      contactSafetyCarPerProfile: unit,
      backgroundIncidentsPerRace: nonNegative,
      reactionS: range(nonNegative),
      safetyCarLaps: range(z.number().int().min(1)),
      virtualSafetyCarLaps: range(z.number().int().min(1)),
      safetyCarLapFactor: z.number().min(1),
      virtualSafetyCarLapFactor: z.number().min(1),
      catchUpFactor: z.number().min(1),
      bunchGapS: positive,
      catchUpBeyondGaps: positive,
      neutralisedWearFactor: unit,
      neutralisedFuelFactor: unit,
    }),
  ),
  radio: tuned(
    z.strictObject({
      pace: z.strictObject(
        Object.fromEntries(
          ['push', 'neutral', 'save-tyres', 'save-fuel'].map((m) => [
            m,
            z.strictObject({ lapS: num, wear: positive, fuel: positive, mistakes: positive }),
          ]),
        ) as Record<
          'push' | 'neutral' | 'save-tyres' | 'save-fuel',
          z.ZodObject<{ lapS: z.ZodNumber; wear: z.ZodNumber; fuel: z.ZodNumber; mistakes: z.ZodNumber }>
        >,
      ),
      ers: z.strictObject(
        Object.fromEntries(
          ['attack', 'balanced', 'harvest'].map((m) => [
            m,
            z.strictObject({ lapS: num, batteryPerLap: num }),
          ]),
        ) as Record<
          'attack' | 'balanced' | 'harvest',
          z.ZodObject<{ lapS: z.ZodNumber; batteryPerLap: z.ZodNumber }>
        >,
      ),
      aggression: z.strictObject(
        Object.fromEntries(
          ['calm', 'normal', 'aggressive'].map((m) => [
            m,
            z.strictObject({ attack: num, defence: num, contact: positive }),
          ]),
        ) as Record<
          'calm' | 'normal' | 'aggressive',
          z.ZodObject<{ attack: z.ZodNumber; defence: z.ZodNumber; contact: z.ZodNumber }>
        >,
      ),
      battleGapS: positive,
      lowBattery: unit,
      riskToAggression: range(unit),
      fuelShortfallKg: nonNegative,
      engineerScoreScaleS: positive,
      battlePushBias: nonNegative,
      savingGoalBias: nonNegative,
    }),
  ),
  teamOrders: tuned(
    z.strictObject({
      swapWindowS: positive,
      yieldLossS: nonNegative,
      compliance: z.strictObject({
        base: num,
        perLoyalty: num,
        perEgo: num,
        perMorale: num,
        whenFaster: num,
        whenPointsAtStake: num,
      }),
    }),
  ),
  segments: tuned(
    z.strictObject({
      minShare: unit,
      maxShare: unit,
      brakingAfterStraightM: positive,
    }),
  ),
  motion: tuned(
    z.strictObject({
      sampleM: positive,
      curvatureWindowM: positive,
      lateralAccelMs2: positive,
      accelMs2: positive,
      brakeMs2: positive,
      maxSpeedKph: positive,
    }),
  ),
  strategy: tuned(
    z.strictObject({
      planScoreScaleS: positive,
      pitCallScoreScaleS: positive,
      // The plan search (strategy.ts, bestCompletion) looks at up to two stops.
      maxStops: z.number().int().min(1).max(2),
      wetnessReviewStep: unit,
      safetyCarWindowLaps: z.number().int().min(0),
      riskStopBias: nonNegative,
      minStintLaps: z.number().int().min(1),
      dryBelowWetness: unit,
      candidateWindowS: positive,
      trackPositionCostPerStopS: nonNegative,
      goalStopBias: nonNegative,
      pitWindowS: positive,
      forecast: z.strictObject({
        sdBase: positive,
        sdPerRemainingShare: nonNegative,
        sdFactorAtSkill0: positive,
        sdFactorAtSkill1: positive,
        recentLaps: z.number().int().min(1),
        pairScaleS: positive,
        pairScalePerLapS: nonNegative,
      }),
    }),
  ),
});

export type TyresBalance = z.output<typeof tyresBalanceSchema>;
export type WeatherBalance = z.output<typeof weatherBalanceSchema>;
export type RaceBalance = z.output<typeof raceBalanceSchema>;
export type CompoundSpec = z.output<typeof compoundSchema>;
