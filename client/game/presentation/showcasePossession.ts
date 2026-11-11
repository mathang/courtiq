import type {
  PlayerMoveInput,
  PlayerSimState,
  MatchPhase,
} from "../../../shared/rules/matchStateMachine";
/** An interruptible opening possession, using the same inputs as normal play. */
export class ShowcasePossession {
  public active = true;
  private elapsed = 0;
  private cut = false;
  private chained = false;
  public next(
    players: [PlayerSimState, PlayerSimState],
    phase: MatchPhase,
    attacker: 0 | 1,
    dt: number,
    user: PlayerMoveInput,
  ): PlayerMoveInput | null {
    if (!this.active) return null;
    if (
      phase !== "Possession" ||
      attacker !== 0 ||
      user.moveX ||
      user.moveZ ||
      user.shoot ||
      user.dunk ||
      user.trick ||
      user.defense
    ) {
      this.active = false;
      return null;
    }
    this.elapsed += dt;
    const p = players[0],
      distance = Math.hypot(p.x, p.z + 5.25);
    if (distance < 3.18 && (!p.streetMove || p.moveElapsedSec >= 0.32)) {
      this.active = false;
      return {
        moveX: 0,
        moveZ: 0,
        sprint: true,
        shoot: false,
        dunk: true,
        dunkStyle: "windmill",
      };
    }
    const targetX = distance > 4 ? 1.65 : 0.25;
    const dx = targetX - p.x,
      dz = -4.6 - p.z,
      length = Math.hypot(dx, dz) || 1;
    const input: PlayerMoveInput =
      this.elapsed < 0.23
        ? { moveX: 1, moveZ: 0, sprint: true, shoot: false }
        : {
            moveX: dx / length,
            moveZ: dz / length,
            sprint: true,
            shoot: false,
          };
    if (distance < 5.05 && !this.cut) {
      input.trick = "crossover";
      this.cut = true;
    } else if (
      this.cut &&
      !this.chained &&
      distance < 4.15 &&
      ((p.streetMove === "crossover" && p.moveElapsedSec >= 0.25) ||
        (!p.streetMove && p.trickCombo >= 1))
    ) {
      input.trick = "spin";
      this.chained = true;
    }
    if (this.elapsed > 5) {
      input.shoot = true;
      this.active = false;
    }
    return input;
  }
}
