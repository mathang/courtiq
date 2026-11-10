import type { PlayerSimState } from "./matchStateMachine";
import { STREET_MOVES } from "./streetMoves";
import { smoothMotion, unit } from "./motionCurves";

/** One shared bounce/hand path for solo, both online transports and the preview. */
export function dribbleBallPosition(p: PlayerSimState, elapsedSec: number) {
  const u = p.streetMove
    ? unit(p.moveElapsedSec / STREET_MOVES[p.streetMove].duration)
    : 0;
  const side =
    p.streetMove === "crossover" || p.streetMove === "eurostep"
      ? Math.cos(u * Math.PI) * p.moveSide
      : 1;
  const yaw =
    p.facingAngle +
    (p.streetMove === "spin" ? p.moveSide * smoothMotion(u) * Math.PI * 2 : 0);
  return {
    x: p.x + Math.sin(yaw) * 0.28 + Math.cos(yaw) * 0.34 * side,
    y:
      p.animState === "dribble"
        ? Math.abs(Math.sin(elapsedSec * 7.5)) * 0.65 + 0.24
        : 1.15,
    z: p.z + Math.cos(yaw) * 0.28 - Math.sin(yaw) * 0.34 * side,
  };
}
