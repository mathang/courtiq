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
  const tripleThreat = p.animState !== "dribble" && !p.streetMove;
  const forward = tripleThreat ? 0.31 : 0.28;
  const lateral = tripleThreat ? 0.2 : 0.34;
  return {
    x: p.x + Math.sin(yaw) * forward + Math.cos(yaw) * lateral * side,
    y:
      p.animState === "dribble"
        ? Math.abs(Math.sin(elapsedSec * 7.5)) * 0.65 + 0.24
        : 1.07,
    z: p.z + Math.cos(yaw) * forward - Math.sin(yaw) * lateral * side,
  };
}
