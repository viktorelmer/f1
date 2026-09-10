import { gameDate } from '@/sim/types/game-date';

/**
 * Mock data for the top bar (plan rule 7: every screen exists on mock data before it is wired
 * to state). Replaced by the career state once the day tick and finances exist (M5, M7).
 */
export const topBarMock = {
  date: gameDate(2027, 2, 22),
  // Event and track names are pack content (fictional, section 10.1); pack localisation is an M1 question.
  nextEvent: { name: 'Pre-season test · Al-Rimal', daysAway: 3 },
  budgetMillions: 142.6,
  constructorsPosition: 6,
} as const;
