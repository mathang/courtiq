import type {
  MatchPhase,
  PlayerSimState,
} from "../../../shared/rules/matchStateMachine";
import type { Vector3D } from "../../../shared/rules/shot";
export type PossessionCue =
  | "bounce"
  | "cut"
  | "swipe"
  | "gather"
  | "takeoff"
  | "basket"
  | "block"
  | "miss"
  | "land";
/** Edge-triggered visual contacts, independent of question answers and scoring. */
export class PossessionCueTracker {
  private lastY: number | null = null;
  private velocity = 0;
  private floorLatch = false;
  private phase: MatchPhase = "Lobby";
  private move: string | null = null;
  private swipe: string | null = null;
  private finishTime = -1;
  private takeoff = false;
  private impact = false;
  private landed = false;
  public reset() {
    this.lastY = null;
    this.velocity = 0;
    this.floorLatch = false;
    this.phase = "Lobby";
    this.move = this.swipe = null;
    this.finishTime = -1;
    this.takeoff = this.impact = this.landed = false;
  }
  public update(
    phase: MatchPhase,
    players: [PlayerSimState, PlayerSimState],
    attacker: 0 | 1,
    ball: Vector3D,
    paused = false,
  ): PossessionCue[] {
    const cues: PossessionCue[] = [],
      p = players[attacker],
      d = players[attacker === 0 ? 1 : 0];
    if (phase === "Lobby" || phase === "MatchEnd") {
      this.reset();
      return [];
    }
    if (paused) {
      this.lastY = null;
      this.velocity = 0;
      this.phase = phase;
      this.finishTime = p.finishKind ? p.finishElapsedSec : -1;
      this.takeoff = p.finishElapsedSec >= 0.16;
      this.impact = p.finishResolutionSec >= 0.3;
      this.landed = p.finishResolutionSec >= 0.78;
      this.move = p.streetMove;
      this.swipe = d.defenseAction;
      return [];
    }
    if (phase === "Possession") {
      if (this.phase !== "Possession") {
        this.lastY = null;
        this.floorLatch = ball.y < 0.38;
      }
      const dy = this.lastY === null ? 0 : ball.y - this.lastY;
      if (ball.y > 0.55) this.floorLatch = false;
      if (
        this.lastY !== null &&
        !this.floorLatch &&
        (ball.y < 0.285 || (this.velocity < 0 && dy > 0 && this.lastY < 0.38))
      ) {
        cues.push("bounce");
        this.floorLatch = true;
      }
      this.velocity = dy;
      this.lastY = ball.y;
      if (p.streetMove && p.streetMove !== this.move) cues.push("cut");
      if (d.defenseAction === "swipe" && this.swipe !== "swipe")
        cues.push("swipe");
      this.move = p.streetMove;
      this.swipe = d.defenseAction;
    } else this.lastY = null;
    if (p.finishKind) {
      if (this.finishTime < 0 || p.finishElapsedSec < this.finishTime) {
        this.takeoff = this.impact = this.landed = false;
        cues.push("gather");
      }
      if (!this.takeoff && p.finishElapsedSec >= 0.16) {
        this.takeoff = true;
        cues.push("takeoff");
      }
      if (
        p.finishKind === "dunk" &&
        !this.impact &&
        p.finishResolutionSec >= 0.3
      ) {
        this.impact = true;
        cues.push(p.finishOutcome ?? "miss");
      }
      if (!this.landed && p.finishResolutionSec >= 0.78) {
        this.landed = true;
        cues.push("land");
      }
      this.finishTime = p.finishElapsedSec;
    } else {
      this.finishTime = -1;
      this.takeoff = this.impact = this.landed = false;
    }
    this.phase = phase;
    return cues;
  }
}
