/**
 * The shape of a race weekend: which sessions it has and in what order (plan 5.3). Kept apart from
 * the machinery that runs them so that anything reasoning about a weekend — the tyre entry, the
 * world's invariants, the screens — can ask without pulling the simulation in behind it.
 */
import type { SessionKind } from '../types/world';

/** The sessions of each weekend format, in the order they are run. */
export const WEEKEND_SESSIONS: Record<'standard' | 'sprint', readonly SessionKind[]> = {
  standard: ['fp1', 'fp2', 'fp3', 'qualifying', 'race'],
  sprint: ['fp1', 'sprint-qualifying', 'sprint', 'qualifying', 'race'],
};

/** Whether a session is a practice one: the sessions that trade time and tyres for knowledge. */
export function isPractice(session: SessionKind): boolean {
  return session === 'fp1' || session === 'fp2' || session === 'fp3';
}

/** Whether a session is qualifying, of either kind: both set a grid and both cost soft tyres. */
export function isQualifying(session: SessionKind): boolean {
  return session === 'qualifying' || session === 'sprint-qualifying';
}

/** The practice sessions of each format, for the screens that plan them. */
export const PRACTICE_SESSIONS: Record<'standard' | 'sprint', readonly SessionKind[]> = {
  standard: WEEKEND_SESSIONS.standard.filter(isPractice),
  sprint: WEEKEND_SESSIONS.sprint.filter(isPractice),
};
