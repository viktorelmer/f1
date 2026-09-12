/** Small helpers the weekend-session screens share: the clock, and what a queue costs. */
import { balance } from '@/data/balance';
import type { ProgrammeKind } from '@/data/schema/weekend-balance';
import type { Run } from '@/sim/weekend/practice';

/** A session clock reads in minutes and seconds: "41:12". */
export function mmss(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** The tyre a programme normally goes out on; the player changes the programme, not the set. */
export function compoundFor(kind: ProgrammeKind) {
  return kind === 'qualifying-sim'
    ? ('soft' as const)
    : kind === 'long-run'
      ? ('medium' as const)
      : ('hard' as const);
}

/**
 * Roughly what a queue of programmes costs in minutes — the same arithmetic the session runs on, at
 * a typical lap time, so the bar is honest without pretending to know this track to the second.
 */
export function minutesOf(runs: readonly Run[]): number {
  const w = balance.weekend;
  const lapS = 90;
  return runs.reduce((total, run) => {
    const laps = w.programmes[run.programme]?.laps ?? 0;
    return total + w.session.boxMinutes + ((w.session.outLapShare + w.session.inLapShare + laps) * lapS) / 60;
  }, 0);
}
