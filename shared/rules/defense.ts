import type { PlayerSimState } from './matchStateMachine';
export type DefenseAction = 'swipe' | 'jump';
export const DEFENSE_CONFIG = { swipeContactSec: 0.12, swipeRecoverySec: 1, swipeCooldownSec: 1.35,
  swipeReachM: 1.45, jumpDurationSec: 0.88, jumpCooldownSec: 1.15, blockWindowStartSec: 0.10, blockWindowEndSec: 0.72 } as const;
export function isDefenseAction(v: unknown): v is DefenseAction { return v === 'swipe' || v === 'jump'; }
export function canStealBall(defender: PlayerSimState, attacker: PlayerSimState, ball: { x: number; y: number; z: number }): boolean {
  const dx = ball.x - defender.x, dz = ball.z - defender.z;
  const reach = Math.hypot(dx, dz);
  const facing = (Math.sin(defender.facingAngle) * dx + Math.cos(defender.facingAngle) * dz) / Math.max(0.001, reach);
  return reach <= DEFENSE_CONFIG.swipeReachM && facing >= 0.4 && ball.y <= 1.35 &&
    attacker.streetMove !== 'spin' && attacker.streetMove !== 'eurostep';
}
