import type { BlockEligibilitySnapshot } from './block';
import { canStealBall } from './defense';
import type { PlayerSimState } from './matchStateMachine';

/**
 * Plain-language reason a question block is or is not available at release.
 * The snapshot is frozen at release; this only explains it, it never changes it.
 */
export type BlockAvailability =
  | 'swat'
  | 'eligible'
  | 'too-far'
  | 'off-balance'
  | 'reaching'
  | 'beaten'
  | 'out-of-bounds';

export function classifyBlockAvailability(
  eligibility: Pick<BlockEligibilitySnapshot, 'eligible' | 'reason'> & { disabledBy?: 'off-balance' | 'reaching' },
  physicalBlock = false,
): BlockAvailability {
  if (physicalBlock) return 'swat';
  if (eligibility.eligible) return 'eligible';
  switch (eligibility.reason) {
    case 'out-of-range': return 'too-far';
    case 'rule-disabled': return eligibility.disabledBy === 'reaching' ? 'reaching' : 'off-balance';
    case 'poor-contest-angle':
    case 'not-facing-shooter': return 'beaten';
    case 'out-of-bounds': return 'out-of-bounds';
    default: return 'too-far';
  }
}

/** One short, role-aware line for the question card. */
export function describeQuestionBlock(params: {
  eligibility: Pick<BlockEligibilitySnapshot, 'eligible' | 'reason' | 'distanceM'> & { disabledBy?: 'off-balance' | 'reaching' };
  physicalBlock: boolean;
  youAreAttacker: boolean;
}): string {
  const kind = classifyBlockAvailability(params.eligibility, params.physicalBlock);
  const metres = Number.isFinite(params.eligibility.distanceM) ? `${params.eligibility.distanceM.toFixed(1)}m` : '';
  if (params.youAreAttacker) {
    switch (kind) {
      case 'swat': return '🛡️ Swatted at take-off • your answer still counts';
      case 'eligible': return '🛡️ Contested • answer correctly first';
      case 'too-far': return `📏 Open shot • defender too far to block${metres ? ` (${metres})` : ''}`;
      case 'off-balance': return '🌀 Defender off balance • no block';
      case 'reaching': return '✋ Defender reached for a steal • no block';
      case 'beaten': return '↩️ Defender beaten • no block';
      default: return '📏 No block this shot';
    }
  }
  switch (kind) {
    case 'swat': return '🛡️ Swat connected • your answer still counts';
    case 'eligible': return '🛡️ In block range • answer first to block';
    case 'too-far': return `📏 Too far to block${metres ? ` (${metres} > 2.6m)` : ''}`;
    case 'off-balance': return '🌀 Off balance from the trick • no block';
    case 'reaching': return '✋ You reached for a steal • no block';
    case 'beaten': return '↩️ Beaten • behind the shooter';
    default: return '📏 No block this shot';
  }
}

/**
 * True when the ball-handler is carrying an unprotected live dribble straight at a
 * set, ready defender who could strip it right now. Used only for a coaching cue;
 * it never changes the steal rule.
 */
export function isDrivingIntoSetDefender(
  attacker: PlayerSimState,
  defender: PlayerSimState,
  ball: { x: number; y: number; z: number },
): boolean {
  if (attacker.finishKind || attacker.streetMove) return false;
  if (defender.defenseRecoverySec > 0 || defender.wrongFootSec > 0 || defender.defenseCooldownSec > 0) return false;
  const dx = defender.x - attacker.x, dz = defender.z - attacker.z;
  const distance = Math.hypot(dx, dz);
  if (distance > 1.35 || distance < 1e-3) return false;
  const speed = Math.hypot(attacker.vx, attacker.vz);
  // Moving into the defender (or pinned against them) rather than past them.
  const pinned = distance < 0.9;
  if (speed <= 0.8 && !pinned) return false;
  const closing = speed > 0.8 ? (attacker.vx * dx + attacker.vz * dz) / (speed * distance) : 1;
  if (closing < 0.6) return false;
  return canStealBall(defender, attacker, ball);
}
