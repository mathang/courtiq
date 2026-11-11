import * as THREE from "three";
import { COURT_GEOMETRY } from "../../../shared/config/balance";
import type {
  MatchPhase,
  PlayerSimState,
} from "../../../shared/rules/matchStateMachine";
import type { Vector3D } from "../../../shared/rules/shot";
import { getAirPose } from "../../../shared/rules/streetMoves";

/** A possession director using airborne actors and the space above the question. */
export class CourtCameraController {
  public readonly camera: THREE.PerspectiveCamera;
  private fittingCamera: THREE.PerspectiveCamera;
  private currentPos = new THREE.Vector3(2.3, 7.8, 12.5);
  private currentLookAt = new THREE.Vector3(0, 1.1, -1.3);
  private width = 1280;
  private height = 720;
  private viewCenter = 0.5;
  private mode = "broadcast";
  private shotSide = 1;
  private wasFinishing = false;
  private impact = 0;
  private subjects: THREE.Vector3[] = [];
  private safeRect = { top: 0.12, bottom: 0.9 };

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(44, aspect, 0.1, 120);
    this.fittingCamera = this.camera.clone();
    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLookAt);
  }
  public resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.camera.aspect = this.width / this.height;
    this.camera.fov = this.camera.aspect < 1 ? 54 : 43;
    this.camera.updateProjectionMatrix();
  }
  public triggerImpact(kind: "basket" | "block" | "miss"): void {
    this.impact = kind === "basket" ? 0.65 : kind === "block" ? 0.45 : 0.22;
  }
  private compose(camera: THREE.PerspectiveCamera, center: number): void {
    camera.setViewOffset(
      this.width,
      this.height,
      0,
      (0.5 - center) * this.height,
      this.width,
      this.height,
    );
  }
  public update(params: {
    phase: MatchPhase;
    players: [PlayerSimState, PlayerSimState];
    ballPos: Vector3D;
    attackerSlot?: 0 | 1;
    reducedMotion: boolean;
    deltaSec: number;
    safeTop?: number;
    safeBottom?: number;
  }): void {
    const { phase, players, ballPos, reducedMotion } = params;
    const dt = THREE.MathUtils.clamp(params.deltaSec, 0, 0.1);
    const attacker = players[params.attackerSlot ?? 0],
      defender = players[(params.attackerSlot ?? 0) === 0 ? 1 : 0];
    const shot = Boolean(attacker.finishKind);
    const duel = phase === "QuestionReady" || phase === "Duel";
    const attackPose = getAirPose(attacker),
      defendPose = getAirPose(defender);
    const approach =
      phase === "Possession" &&
      Math.hypot(attacker.x, attacker.z - COURT_GEOMETRY.hoopZ) < 4.1;
    this.safeRect = {
      top: params.safeTop ?? 0.12,
      bottom: duel ? (params.safeBottom ?? 0.55) : 0.9,
    };
    if (shot && !this.wasFinishing) {
      const end = getAirPose({
        ...attacker,
        finishElapsedSec: 0.84,
        finishResolutionSec: 0.3,
      });
      this.shotSide =
        Math.abs(end.x) > 0.06 ? Math.sign(end.x) : Math.sign(attacker.x) || 1;
    }
    this.wasFinishing = shot;
    if (reducedMotion) {
      this.mode = "steady";
      this.impact = 0;
      this.viewCenter = 0.5;
      this.currentPos.set(0, 8.8, 11.6);
      this.currentLookAt.set(0, 1.35, -1.7);
      this.camera.clearViewOffset();
      this.camera.position.copy(this.currentPos);
      this.camera.lookAt(this.currentLookAt);
      this.camera.fov = this.camera.aspect < 1 ? 56 : 44;
      this.camera.updateProjectionMatrix();
      return;
    }
    const midX = (players[0].x + players[1].x) * 0.5,
      midZ = (players[0].z + players[1].z) * 0.5;
    let look = new THREE.Vector3(
      midX * 0.55,
      1.05,
      (midZ + COURT_GEOMETRY.hoopZ) * 0.43,
    );
    let position = new THREE.Vector3(
      2.2 + midX * 0.38,
      7.6,
      Math.max(9.2, midZ + 9.0),
    );
    this.mode = approach ? "drive" : "broadcast";
    if (approach) {
      const comboEnergy = attacker.onFire
        ? 0.45
        : attacker.trickCombo >= 2
          ? 0.28
          : 0;
      look.set(
        attacker.x * 0.42,
        1.14 + comboEnergy * 0.12,
        (attacker.z + COURT_GEOMETRY.hoopZ) * 0.5,
      );
      position.set(
        2.8 + attacker.x * 0.34,
        6.9 - comboEnergy * 0.55,
        8.5 - comboEnergy * 0.45,
      );
    }
    if (shot && (duel || phase === "Resolution")) {
      this.mode = duel
        ? attacker.finishElapsedSec < 0.84
          ? "gather"
          : "hang"
        : "finish";
      look.set(
        attackPose.x * 0.4,
        Math.max(1.35, attackPose.y + 1.0),
        COURT_GEOMETRY.hoopZ + 0.25,
      );
      position.set(this.shotSide * 4.85, 4.78, 3.05);
    } else if (phase === "Feedback") {
      this.mode = "recovery";
    }
    const points: THREE.Vector3[] = [];
    const include = (pose: { x: number; y: number; z: number }) => {
      points.push(
        new THREE.Vector3(pose.x, Math.max(0.04, pose.y + 0.03), pose.z),
      );
      points.push(new THREE.Vector3(pose.x, pose.y + 2.12, pose.z));
    };
    include(attackPose);
    if (
      !shot ||
      Math.hypot(defendPose.x - attackPose.x, defendPose.z - attackPose.z) < 2.8
    )
      include(defendPose);
    points.push(
      new THREE.Vector3(COURT_GEOMETRY.hoopX, 3.45, COURT_GEOMETRY.hoopZ),
    );
    if (shot)
      points.push(new THREE.Vector3(ballPos.x, ballPos.y + 0.16, ballPos.z));
    this.subjects = points;
    const center = duel
      ? (this.safeRect.top + this.safeRect.bottom) * 0.5
      : 0.5;
    const baseFov = this.camera.aspect < 1 ? 54 : 43;
    const direction = position.clone().sub(look).normalize();
    let distance = position.distanceTo(look);
    const test = this.fittingCamera;
    test.aspect = this.camera.aspect;
    test.fov = baseFov;
    this.compose(test, center);
    for (let i = 0; i < 18; i++) {
      test.position.copy(look).addScaledVector(direction, distance);
      test.lookAt(look);
      test.updateMatrixWorld(true);
      const fit = points.every((p) => {
        const n = p.clone().project(test);
        const x = (n.x + 1) * 0.5,
          y = (1 - n.y) * 0.5;
        return (
          x > 0.065 &&
          x < 0.935 &&
          y > this.safeRect.top + 0.015 &&
          y < this.safeRect.bottom - 0.015
        );
      });
      if (fit) break;
      distance *= 1.1;
    }
    position.copy(look).addScaledVector(direction, distance);
    const rate = duel || phase === "Resolution" ? 5.8 : 3.8;
    const alpha = 1 - Math.exp(-dt * rate);
    this.currentPos.lerp(position, alpha);
    this.currentLookAt.lerp(look, alpha);
    this.viewCenter = THREE.MathUtils.damp(this.viewCenter, center, 8, dt);
    this.impact = THREE.MathUtils.damp(this.impact, 0, 15, dt);
    this.camera.fov = THREE.MathUtils.damp(
      this.camera.fov,
      baseFov + this.impact,
      10,
      dt,
    );
    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLookAt);
    this.compose(this.camera, this.viewCenter);
    this.camera.updateMatrixWorld(true);
  }
  public snapshot() {
    return {
      mode: this.mode,
      position: this.camera.position.toArray(),
      fov: +this.camera.fov.toFixed(2),
      safeRect: this.safeRect,
      subjects: this.subjects.map((p) => {
        const n = p.clone().project(this.camera);
        return {
          x: +((n.x + 1) * 0.5).toFixed(3),
          y: +((1 - n.y) * 0.5).toFixed(3),
        };
      }),
    };
  }
}
