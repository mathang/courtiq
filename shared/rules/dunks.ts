import type { PlayerSimState } from './matchStateMachine';
export const DUNK_STYLES = ['tomahawk', 'windmill', '360', 'reverse'] as const;
export type DunkStyle = typeof DUNK_STYLES[number];
export const DUNK_LABELS: Record<DunkStyle, string> = { tomahawk: 'TOMAHAWK', windmill: 'WINDMILL', '360': '360 SLAM', reverse: 'REVERSE' };
export const DUNK_RANGE_M = 3.4;
export const DUNK_TAKEOFF_SEC = 0.84;
export function isDunkStyle(v: unknown): v is DunkStyle { return typeof v === 'string' && DUNK_STYLES.includes(v as DunkStyle); }
const smooth = (t: number) => t * t * (3 - 2 * t);
export function dunkRig(p: PlayerSimState) {
  const u = Math.min(1, p.finishElapsedSec / DUNK_TAKEOFF_SEC);
  const v = Math.max(0, (u - 0.12) / 0.88);
  const s = smooth(v);
  const twist = p.dunkStyle === '360' ? Math.PI * 2 * s : p.dunkStyle === 'reverse' ? Math.PI * s : 0;
  const arm = p.dunkStyle === 'windmill' ? -0.4 - (3 * Math.PI - 0.4) * s :
    -0.4 + (-Math.PI + 0.4) * s - (p.dunkStyle === 'tomahawk' ? 0.95 * Math.sin(v * Math.PI) : 0);
  const lowering = p.finishResolutionSec > 0.34 ? Math.max(0, 1 - (p.finishResolutionSec - 0.34) / 0.6) : 1;
  return { twist, arm: arm * lowering, guideArm: (p.dunkStyle === 'windmill' ? -1.1 : arm) * lowering,
    hand: { x: 0.28, y: 1.53 - 0.62 * Math.cos(arm), z: -0.62 * Math.sin(arm) } };
}
export function dunkBallPosition(p: PlayerSimState, body: { x: number; y: number; z: number }) {
  const rig = dunkRig(p), yaw = p.facingAngle + rig.twist;
  const hand = { x: body.x + Math.cos(yaw) * rig.hand.x + Math.sin(yaw) * rig.hand.z,
    y: body.y + rig.hand.y, z: body.z - Math.sin(yaw) * rig.hand.x + Math.cos(yaw) * rig.hand.z };
  // Gather the actual dribble into the hand, avoiding a ball teleport at take-off.
  const t = smooth(Math.min(1, p.finishElapsedSec / 0.18));
  const origin = p.dunkBallStart ?? hand;
  return { x: origin.x + (hand.x - origin.x) * t, y: origin.y + (hand.y - origin.y) * t, z: origin.z + (hand.z - origin.z) * t };
}
