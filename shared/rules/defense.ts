import type { PlayerSimState } from './matchStateMachine';
import { STREET_MOVES, type StreetMove } from './streetMoves';

export type DefenseAction = 'swipe' | 'jump';
export const DEFENSE_CONFIG = {
  swipeContactSec: 0.12,
  swipeRecoverySec: 1.0,
  swipeCooldownSec: 1.35,
  swipeReachM: 1.45,
  overexposedExtraReachM: 0.20,
  jumpDurationSec: 0.88,
  jumpCooldownSec: 0.95,
  jumpSteeringMultiplier: 0.72,
  blockWindowStartSec: 0.02,
  blockWindowEndSec: 0.84,
  jumpActiveStartSec: 0.02,
  jumpActiveEndSec: 0.86,
} as const;

/** Only a committed steal swipe roots movement; jumps and being wrong-footed do not. */
export function isStealRecovery(p: Pick<PlayerSimState, 'defenseAction' | 'defenseRecoverySec'>): boolean {
  return p.defenseAction === 'swipe' && p.defenseRecoverySec > 0;
}

export function isDefenseAction(v: unknown): v is DefenseAction {
  return v === 'swipe' || v === 'jump';
}

export function canStealBall(
  defender: PlayerSimState,
  attacker: PlayerSimState,
  ball: { x: number; y: number; z: number },
): boolean {
  const overexposed = (attacker.trickOverexposedSec ?? 0) > 0;
  const maxReach =
    DEFENSE_CONFIG.swipeReachM + (overexposed ? DEFENSE_CONFIG.overexposedExtraReachM : 0);
  const dx = ball.x - defender.x;
  const dz = ball.z - defender.z;
  const reach = Math.hypot(dx, dz);
  const facing =
    (Math.sin(defender.facingAngle) * dx + Math.cos(defender.facingAngle) * dz) /
    Math.max(0.001, reach);

  if (reach > maxReach || facing < 0.4 || ball.y > 1.35) {
    return false;
  }

  // If the attacker over-dribbled / spammed into a waiting defender, ball protection is lost!
  if (overexposed) {
    return true;
  }

  // Clean separation moves protect the handle:
  // - Spin & Eurostep tuck/body-shield the ball throughout the move.
  // - Crossover & Stepback protect the ball during their explosive separation window
  //   unless initiated chest-to-chest (< 0.72m body center distance).
  if (attacker.streetMove === 'spin' || attacker.streetMove === 'eurostep') {
    return false;
  }
  if (attacker.streetMove === 'crossover' || attacker.streetMove === 'stepback') {
    const duration = STREET_MOVES[attacker.streetMove].duration;
    const progress = attacker.moveElapsedSec / duration;
    const bodyDist = Math.hypot(attacker.x - defender.x, attacker.z - defender.z);
    if (progress <= 0.88 && bodyDist >= 0.72) {
      return false;
    }
  }

  return true;
}

/**
 * Wrong-foot ("ankle breaker") duration caused by a trick, graded by spacing.
 * A defender crowding within steal reach takes the full freeze; one keeping a
 * cushion takes proportionally less, and none at 2.55m+. Crowding therefore buys
 * steal chances at the risk of being broken, while a cushion keeps balance (and
 * question-block eligibility up to 2.6m) at the cost of conceding space.
 */
export const ANKLE_BREAK_CONFIG = {
  fullFreezeWithinM: DEFENSE_CONFIG.swipeReachM,
  noFreezeBeyondM: 2.55,
  chainBonusSec: 0.08,
  /** Below this fraction of the full freeze there is no "ANKLE BREAKER" callout. */
  calloutFraction: 0.6,
  /** After a wrong-foot ends, the defender cannot be re-broken for this long. */
  settleSec: 0.45,
} as const;

export function trickWrongFootSec(move: StreetMove, distanceM: number, isChain: boolean): number {
  const { fullFreezeWithinM, noFreezeBeyondM, chainBonusSec } = ANKLE_BREAK_CONFIG;
  if (!(distanceM < noFreezeBeyondM)) return 0;
  const full = (move === 'spin' ? 0.44 : move === 'crossover' ? 0.36 : 0.32) + (isChain ? chainBonusSec : 0);
  const closeness = Math.min(1, Math.max(0, (noFreezeBeyondM - distanceM) / (noFreezeBeyondM - fullFreezeWithinM)));
  return full * closeness;
}

export function isFullAnkleBreak(move: StreetMove, distanceM: number, isChain: boolean): boolean {
  const full = trickWrongFootSec(move, 0, isChain);
  return full > 0 && trickWrongFootSec(move, distanceM, isChain) >= full * ANKLE_BREAK_CONFIG.calloutFraction;
}
