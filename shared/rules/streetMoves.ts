import { DUNK_TAKEOFF_SEC, DUNK_FINISH_HAND, DUNK_HOLD_HEIGHT } from "./dunks";
import { COURT_GEOMETRY } from "../config/balance";
import type { PlayerSimState } from "./matchStateMachine";
import { motionCurve, smoothMotion } from "./motionCurves";

export type StreetMove = "crossover" | "spin" | "eurostep" | "stepback";
export const STREET_MOVES: Record<
  StreetMove,
  { label: string; duration: number; speed: number; cost: number }
> = {
  crossover: { label: "CROSSOVER", duration: 0.34, speed: 9.8, cost: 0.16 },
  spin: { label: "SPIN MOVE", duration: 0.48, speed: 8.8, cost: 0.22 },
  eurostep: { label: "EUROSTEP", duration: 0.56, speed: 8.4, cost: 0.22 },
  stepback: { label: "STEP BACK", duration: 0.32, speed: 9.2, cost: 0.18 },
};
export function isStreetMove(value: unknown): value is StreetMove {
  return typeof value === "string" && Object.hasOwn(STREET_MOVES, value);
}

// Shared by the authoritative ball position and the character rig: hands and ball
// follow the same take-off, suspended question moment, finish and landing.
export function getAirPose(p: PlayerSimState): {
  x: number;
  y: number;
  z: number;
  progress: number;
} {
  if (!p.finishKind) {
    const jump =
      p.defenseAction === "jump"
        ? Math.sin(Math.min(1, p.defenseElapsedSec / 0.88) * Math.PI) ** 2
        : 0;
    return {
      x: p.x + (p.defenseTargetX - p.x) * jump * 0.85,
      y: jump * 1.25,
      z: p.z + (p.defenseTargetZ - p.z) * jump * 0.85,
      progress: jump,
    };
  }
  const t = p.finishElapsedSec;
  if (p.finishKind === "jump") {
    return {
      x: p.x,
      z: p.z,
      y: t < 0.8 ? Math.sin((Math.PI * t) / 0.8) ** 2 * 0.48 : 0,
      progress: Math.min(1, t / 0.8),
    };
  }
  const r = p.finishResolutionSec;
  const takeoff = Math.min(1, t / DUNK_TAKEOFF_SEC);
  const finish = r < 0 ? 0 : Math.min(1, r / 0.3);
  const closeLaunch =
    Math.hypot(COURT_GEOMETRY.hoopX - p.x, COURT_GEOMETRY.hoopZ - p.z) < 0.8;
  const progress = closeLaunch
    ? smoothMotion(t / 0.22)
    : smoothMotion(takeoff) * 0.64 + smoothMotion(finish) * 0.36;
  const dx = COURT_GEOMETRY.hoopX - p.x;
  const dz = COURT_GEOMETRY.hoopZ - p.z;
  const landing = r < 0.3 ? 0 : smoothMotion((r - 0.3) / 0.48);
  const yaw = p.facingAngle + (p.dunkStyle === "reverse" ? Math.PI : 0);
  const handX =
    Math.cos(yaw) * DUNK_FINISH_HAND.x + Math.sin(yaw) * DUNK_FINISH_HAND.z;
  const handZ =
    -Math.sin(yaw) * DUNK_FINISH_HAND.x + Math.cos(yaw) * DUNK_FINISH_HAND.z;
  return {
    x: p.x + (dx - handX) * progress,
    z: p.z + (dz - handZ) * progress,
    y:
      motionCurve(Math.min(t, DUNK_TAKEOFF_SEC), [
        [0, 0, 0],
        [0.1, -0.13, 0],
        [0.23, 0.55, 6.0],
        [0.48, 1.8, 0],
        [DUNK_TAKEOFF_SEC, DUNK_HOLD_HEIGHT, 0],
      ]) *
      (1 - landing),
    progress,
  };
}
