import * as THREE from 'three';
import { COURT_GEOMETRY } from '../../../shared/config/balance';
import { MatchPhase, PlayerSimState } from '../../../shared/rules/matchStateMachine';
import { Vector3D } from '../../../shared/rules/shot';

/**
 * Fixed elevated sideline/broadcast 3D camera controller (Section 17).
 * Keeps attacker, defender, ball, and basket readable at all times,
 * and subtly eases towards the slow-motion question duel while keeping the
 * court action framed in the upper viewport above the HTML question panel.
 * Respects reducedMotion by holding a steady broadcast view when enabled.
 */
export class CourtCameraController {
  public readonly camera: THREE.PerspectiveCamera;
  private currentPos = new THREE.Vector3(0, 8.6, 11.4);
  private currentLookAt = new THREE.Vector3(0, 1.5, -1.6);

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(44, aspect, 0.1, 120);
    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLookAt);
  }

  public resize(width: number, height: number): void {
    this.camera.aspect = Math.max(0.5, width / Math.max(1, height));
    // Slightly widen FOV on narrow portrait screens so full half-court width stays visible
    this.camera.fov = this.camera.aspect < 1.0 ? 56 : 44;
    this.camera.updateProjectionMatrix();
  }

  public update(params: {
    phase: MatchPhase;
    players: [PlayerSimState, PlayerSimState];
    ballPos: Vector3D;
    reducedMotion: boolean;
    deltaSec: number;
  }): void {
    const { phase, players, ballPos, reducedMotion, deltaSec } = params;

    if (reducedMotion) {
      // Static, rock-steady elevated broadcast framing
      this.currentPos.set(0, 8.8, 11.6);
      this.currentLookAt.set(0, 1.35, -1.7);
      this.camera.position.copy(this.currentPos);
      this.camera.lookAt(this.currentLookAt);
      return;
    }

    const midPlayerX = (players[0].x + players[1].x) * 0.5;
    const midPlayerZ = (players[0].z + players[1].z) * 0.5;

    let targetPos: THREE.Vector3;
    let targetLook: THREE.Vector3;

    if (phase === 'QuestionReady' || phase === 'Duel') {
      // Signature question moment: ease subtly towards the mid-air duel,
      // shifting lookAt slightly downward so the players, ball, and hoop sit cleanly
      // in the upper 58% of the screen above the lower HTML question panel!
      const focusX = (ballPos.x * 0.55 + COURT_GEOMETRY.hoopX * 0.45) * 0.65;
      const focusZ = (ballPos.z * 0.5 + COURT_GEOMETRY.hoopZ * 0.5);
      targetPos = new THREE.Vector3(
        focusX * 1.15 + 1.4,
        7.4,
        Math.max(8.8, focusZ + 11.2)
      );
      targetLook = new THREE.Vector3(
        focusX * 0.5,
        Math.max(1.2, ballPos.y * 0.52 - 0.55),
        focusZ - 0.6
      );
    } else if (phase === 'Resolution') {
      targetPos = new THREE.Vector3(
        ballPos.x * 0.65,
        7.8,
        Math.max(9.4, ballPos.z + 11.6)
      );
      targetLook = new THREE.Vector3(
        ballPos.x * 0.35,
        Math.max(1.6, ballPos.y * 0.65),
        COURT_GEOMETRY.hoopZ * 0.65 + ballPos.z * 0.35
      );
    } else {
      // Standard Possession / Lobby / Feedback broadcast framing
      targetPos = new THREE.Vector3(
        midPlayerX * 0.42,
        8.6,
        Math.max(10.8, midPlayerZ + 9.6)
      );
      targetLook = new THREE.Vector3(
        midPlayerX * 0.28,
        1.55,
        (midPlayerZ + COURT_GEOMETRY.hoopZ) * 0.45
      );
    }

    const lerpFactor = 1 - Math.exp(-deltaSec * 4.2);
    this.currentPos.lerp(targetPos, lerpFactor);
    this.currentLookAt.lerp(targetLook, lerpFactor);

    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLookAt);
  }
}
