import type { PlayerSimState } from "./matchStateMachine";
import { smoothMotion, unit } from "./motionCurves";
import { COURT_GEOMETRY } from "../config/balance";
export const DUNK_STYLES = ["tomahawk", "windmill", "360", "reverse"] as const;
export type DunkStyle = (typeof DUNK_STYLES)[number];
export const DUNK_LABELS: Record<DunkStyle, string> = {
  tomahawk: "TOMAHAWK",
  windmill: "WINDMILL",
  "360": "360 SLAM",
  reverse: "REVERSE",
};
export const DUNK_RANGE_M = 3.4;
export const DUNK_TAKEOFF_SEC = 0.84;
export const DUNK_FINISH_ANGLE = -2.6;
export const DUNK_FINISH_HAND = {
  x: 0.28,
  y: 1.53 - 0.62 * Math.cos(DUNK_FINISH_ANGLE),
  z: -0.62 * Math.sin(DUNK_FINISH_ANGLE),
};
export const DUNK_HOLD_HEIGHT = 3.2 - DUNK_FINISH_HAND.y;
export function isDunkStyle(v: unknown): v is DunkStyle {
  return typeof v === "string" && DUNK_STYLES.includes(v as DunkStyle);
}
export function dunkRig(p: PlayerSimState) {
  const u = unit(p.finishElapsedSec / DUNK_TAKEOFF_SEC),
    v = unit((u - 0.12) / 0.88),
    s = smoothMotion(v);
  const twist =
    p.dunkStyle === "360"
      ? Math.PI * 2 * s
      : p.dunkStyle === "reverse"
        ? Math.PI * s
        : 0;
  // One continuous windmill sweep; a bent-elbow cock for the tomahawk.
  const arm =
    p.dunkStyle === "windmill"
      ? -0.4 + (Math.PI * 2 + DUNK_FINISH_ANGLE + 0.4) * s
      : -0.4 +
        (DUNK_FINISH_ANGLE + 0.4) * s -
        (p.dunkStyle === "tomahawk" ? 0.85 * Math.sin(Math.PI * s) : 0);
  const lowering = 1 - smoothMotion((p.finishResolutionSec - 0.34) / 0.6);
  const radius =
    0.62 - (p.dunkStyle === "tomahawk" ? 0.14 * Math.sin(Math.PI * s) ** 2 : 0);
  const visibleArm = arm * lowering;
  const guide =
    p.dunkStyle === "windmill"
      ? -0.65 - 1.0 * Math.sin(Math.PI * s)
      : p.dunkStyle === "360"
        ? -1.1 - 1.1 * Math.sin(Math.PI * s)
        : arm * 0.8;
  return {
    twist,
    arm: visibleArm,
    guideArm: guide * lowering,
    hand: {
      x: 0.28,
      y: 1.53 - radius * Math.cos(visibleArm),
      z: -radius * Math.sin(visibleArm),
    },
  };
}
export function dunkBallPosition(
  p: PlayerSimState,
  body: { x: number; y: number; z: number },
) {
  const rig = dunkRig(p),
    yaw = p.facingAngle + rig.twist;
  const hand = {
    x: body.x + Math.cos(yaw) * rig.hand.x + Math.sin(yaw) * rig.hand.z,
    y: body.y + rig.hand.y,
    z: body.z - Math.sin(yaw) * rig.hand.x + Math.cos(yaw) * rig.hand.z,
  };
  // Gather the actual dribble into the hand, avoiding a ball teleport at take-off.
  const t = smoothMotion(p.finishElapsedSec / 0.18);
  const origin = p.dunkBallStart ?? hand;
  return {
    x: origin.x + (hand.x - origin.x) * t,
    y: origin.y + (hand.y - origin.y) * t,
    z: origin.z + (hand.z - origin.z) * t,
  };
}

/** Send misses and swats away from the descending finisher, from any lane. */
export function dunkReboundPosition(
  p: PlayerSimState,
  body: { x: number; z: number },
  outcome: 'basket' | 'miss' | 'block' | null | undefined,
) {
  const t = Math.max(0, p.finishResolutionSec - 0.30);
  const dx = COURT_GEOMETRY.hoopX - body.x;
  const dz = COURT_GEOMETRY.hoopZ - body.z;
  const length = Math.hypot(dx, dz);
  const speed = outcome === 'block' ? 3.3 : outcome === 'miss' ? 2.2 : 0;
  return {
    x: COURT_GEOMETRY.hoopX + (length > 1e-6 ? dx / length : 1) * speed * t,
    z: COURT_GEOMETRY.hoopZ + (length > 1e-6 ? dz / length : 0) * speed * t,
    y: Math.max(0.18, 3.17 - 1.5 * t - 4.9 * t * t),
  };
}
