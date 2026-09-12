/**
 * Practice on the clock (docs/systems/weekend-play.md). The session is computed whole in
 * milliseconds and then played back over its hour: `practiceFrameAt(replay, t)` is pure and says
 * what the garage sees at second `t` — who is out, on what, how many laps they have, and what the
 * team believes so far.
 *
 * The same shape as the race (`race/replay.ts`), for the same reason: the screen draws a frame, it
 * does not run a simulation.
 */
import { balance } from '@/data/balance';
import type { Compound } from '@/data/schema/race-balance';
import type { ProgrammeKind } from '@/data/schema/weekend-balance';
import type { DriverId, TeamId, WeekendKnowledge } from '../types/world';
import type { PracticeLap, PracticeResult, PracticeRunRecord } from './practice';

export type PracticeReplay = {
  result: PracticeResult;
  /** Every lap of the session in the order the timing screen saw them. */
  laps: readonly PracticeLap[];
  runs: readonly PracticeRunRecord[];
  /** What the teams learned, in the order the runs came back — cars run their queues in parallel. */
  knowledgeAt: PracticeResult['knowledgeAt'];
  durationS: number;
};

/** What one car is doing at a moment of the session. */
export type PracticeCarFrame = {
  driverId: DriverId;
  teamId: TeamId;
  /** In the garage between runs, out on track, or finished for the session. */
  state: 'garage' | 'out' | 'done';
  programme: ProgrammeKind | null;
  compound: Compound | null;
  lapsDone: number;
  bestLapS: number | null;
  /** Minutes of the hour this car has used by now. */
  minutesUsed: number;
};

export type PracticeFrame = {
  timeS: number;
  durationS: number;
  finished: boolean;
  /** The timing board: best lap first, cars yet to set one at the back. */
  cars: PracticeCarFrame[];
  /** Laps set so far, oldest first — the session's feed. */
  laps: readonly PracticeLap[];
  /** What each team believes at this moment: the estimates narrowing as runs come back. */
  knowledge: Record<TeamId, WeekendKnowledge>;
};

export function buildPracticeReplay(result: PracticeResult): PracticeReplay {
  const laps = [...result.laps].sort((a, b) => a.atS - b.atS);
  const runs = [...result.runs].sort((a, b) => a.outAtS - b.outAtS);
  const last = Math.max(0, ...runs.map((r) => r.endS));
  return {
    result,
    laps,
    runs,
    knowledgeAt: [...result.knowledgeAt].sort((a, b) => a.atS - b.atS),
    // The hour is the hour, even if the last car crossed the line a moment after it.
    durationS: Math.max(balance.weekend.session.practiceMinutes * 60, last),
  };
}

export function practiceFrameAt(replay: PracticeReplay, timeS: number): PracticeFrame {
  const t = Math.max(0, Math.min(replay.durationS, timeS));
  const { result } = replay;
  const done = replay.laps.filter((l) => l.atS <= t);

  const cars: PracticeCarFrame[] = result.session.classification.map((car) => {
    const mine = done.filter((l) => l.driverId === car.driverId);
    const runs = replay.runs.filter((r) => r.driverId === car.driverId);
    const current = runs.find((r) => r.outAtS <= t && t < r.endS);
    const ahead = runs.some((r) => r.outAtS > t);
    return {
      driverId: car.driverId,
      teamId: car.teamId,
      state: current ? 'out' : ahead ? 'garage' : 'done',
      programme: current?.programme ?? null,
      compound: current?.compound ?? null,
      lapsDone: mine.length,
      bestLapS: mine.length > 0 ? Math.min(...mine.map((l) => l.timeS)) : null,
      // In the garage the clock stands where the last run left it; on track it runs with the car.
      minutesUsed: Math.min(
        result.minutes[car.driverId] ?? 0,
        current ? t / 60 : (runs.filter((r) => r.endS <= t).at(-1)?.endS ?? 0) / 60,
      ),
    };
  });
  cars.sort((a, b) => (a.bestLapS ?? Infinity) - (b.bestLapS ?? Infinity));

  const knowledge: Record<TeamId, WeekendKnowledge> = { ...result.startedWith };
  for (const entry of replay.knowledgeAt) {
    if (entry.atS > t) break;
    knowledge[entry.teamId] = entry.knowledge;
  }

  return {
    timeS: t,
    durationS: replay.durationS,
    finished: t >= replay.durationS,
    cars,
    laps: done,
    knowledge,
  };
}
