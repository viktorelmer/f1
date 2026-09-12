/**
 * The player's side of a session (docs/systems/race-control.md): who decides what, before anyone
 * has changed anything on screen. It comes from the career's delegation settings, so a weekend
 * session and a race start from the same instruction.
 */
import type { DelegationMode } from '@/sim/decide/delegation';
import type { RaceControl } from '@/sim/race/types';
import { useCareer } from './career';

/**
 * A session the player does not watch is run by the team: what was theirs to answer is handed to
 * the delegate, because nobody is on the pit wall to answer it (docs/systems/weekend-play.md).
 * Directed instructions stand — they were given in advance.
 */
export function unwatchedControl(): RaceControl {
  const control = defaultControl();
  return {
    ...control,
    strategy: { ...control.strategy, mode: hand(control.strategy.mode) },
    radio: { ...control.radio, mode: hand(control.radio.mode) },
  };
}

const hand = (mode: DelegationMode): DelegationMode => (mode === 'manual' ? 'delegated' : mode);

export function defaultControl(): RaceControl {
  const { world } = useCareer.getState();
  const mode = (area: 'race-strategy' | 'race-radio'): DelegationMode => world.career.delegation[area];
  return {
    teamId: world.career.playerTeamId,
    strategy: { mode: mode('race-strategy'), risk: 0.5, goal: 'fastest' },
    radio: { mode: mode('race-radio'), aggression: 'normal', saving: 'none' },
    plans: {},
  };
}
