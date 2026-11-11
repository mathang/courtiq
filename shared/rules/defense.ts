import type { PlayerSimState } from './matchStateMachine';
import { STREET_MOVES } from './streetMoves';

export type DefenseAction = 'swipe' | 'jump';
export const DEFENSE_CONFIG = {
  swipeContactSec: 0.12,
  swipeRecoverySec: 1.0,
  swipeCooldownSec: 1.35,
  swipeReachM: 1.45,
  overexposedExtraReachM: 0.20,
  jumpDurationSec: 0.88,
  jumpCooldownSec: 0.95,
  blockWindowStartSec: 0.02,
  blockWindowEndSec: 0.84,
  jumpActiveStartSec: 0.02,
  jumpActiveEndSec: 0.86,
} as const;

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
