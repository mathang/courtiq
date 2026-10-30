import * as THREE from 'three';
import { MatchPhase } from '../../../shared/rules/matchStateMachine';
import { Vector3D } from '../../../shared/rules/shot';

/**
 * Renders the 3D basketball, floor shadow projection disc, and pooled slow-motion
 * ribbon/trail particles (Sections 9, 17 & 20).
 */
export class BallVisualController {
  public readonly group = new THREE.Group();
  public readonly ballMesh: THREE.Mesh;
  private readonly shadowMesh: THREE.Mesh;
  private readonly trailMeshes: THREE.Mesh[] = [];
  private readonly trailPositions: THREE.Vector3[] = [];
  private readonly maxTrailLength = 18;
  private trailSampleTimer = 0;

  constructor() {
    const ballTex = this.createBasketballTexture();
    const ballGeo = new THREE.SphereGeometry(0.125, 20, 20);
    const ballMat = new THREE.MeshStandardMaterial({
      map: ballTex,
      roughness: 0.45,
      metalness: 0.05,
    });
    this.ballMesh = new THREE.Mesh(ballGeo, ballMat);
    this.ballMesh.castShadow = true;
    this.group.add(this.ballMesh);

    // Floor shadow disc directly under ball XZ so height above floor is always readable
    this.shadowMesh = new THREE.Mesh(
      new THREE.CircleGeometry(0.2, 20),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.42,
      })
    );
    this.shadowMesh.rotation.x = -Math.PI / 2;
    this.shadowMesh.position.y = 0.012;
    this.group.add(this.shadowMesh);

    // Pooled trail spheres for the slow-motion question flight (Section 20: pool particles)
    const trailGeo = new THREE.SphereGeometry(0.085, 8, 8);
    for (let i = 0; i < this.maxTrailLength; i++) {
      const ratio = 1 - i / this.maxTrailLength;
      const mat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0xfdb913 : 0x38bdf8,
        transparent: true,
        opacity: ratio * 0.42,
      });
      const m = new THREE.Mesh(trailGeo, mat);
      m.visible = false;
      this.trailMeshes.push(m);
      this.group.add(m);
    }
  }

  private createBasketballTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#ea580c';
    ctx.fillRect(0, 0, 256, 128);

    // Black seams
    ctx.strokeStyle = '#1c1917';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(0, 64);
    ctx.lineTo(256, 64);
    ctx.moveTo(128, 0);
    ctx.lineTo(128, 128);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(64, 64, 46, -Math.PI * 0.5, Math.PI * 0.5);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(192, 64, 46, Math.PI * 0.5, Math.PI * 1.5);
    ctx.stroke();

    return new THREE.CanvasTexture(canvas);
  }

  public update(params: {
    pos: Vector3D;
    phase: MatchPhase;
    reducedMotion: boolean;
    deltaSec: number;
  }): void {
    const { pos, phase, reducedMotion, deltaSec } = params;

    this.ballMesh.position.set(pos.x, pos.y, pos.z);
    // Continue subtle backspin rotation during slow-motion question flight
    const spinRate =
      phase === 'QuestionReady' || phase === 'Duel' ? 2.4 : 8.5;
    this.ballMesh.rotation.x -= deltaSec * spinRate;

    // Update floor shadow disc scale & opacity by height
    this.shadowMesh.position.set(pos.x, 0.012, pos.z);
    const heightScale = Math.max(0.45, 1.15 - pos.y * 0.14);
    this.shadowMesh.scale.setScalar(heightScale);
    (this.shadowMesh.material as THREE.MeshBasicMaterial).opacity =
      Math.max(0.14, 0.48 - pos.y * 0.07);

    // Show pooled ball trail during QuestionReady, Duel, and Resolution (unless reducedMotion is enabled)
    const showTrail =
      !reducedMotion &&
      (phase === 'QuestionReady' ||
        phase === 'Duel' ||
        phase === 'Resolution');

    if (!showTrail) {
      this.trailPositions.length = 0;
      for (const m of this.trailMeshes) {
        m.visible = false;
      }
      return;
    }

    this.trailSampleTimer += deltaSec;
    if (this.trailSampleTimer >= 0.035 || this.trailPositions.length === 0) {
      this.trailSampleTimer = 0;
      this.trailPositions.unshift(new THREE.Vector3(pos.x, pos.y, pos.z));
      if (this.trailPositions.length > this.maxTrailLength) {
        this.trailPositions.pop();
      }
    }

    for (let i = 0; i < this.maxTrailLength; i++) {
      const m = this.trailMeshes[i];
      const tp = this.trailPositions[i];
      if (tp) {
        m.visible = true;
        m.position.copy(tp);
        const scale = Math.max(0.25, 1 - i / this.maxTrailLength);
        m.scale.setScalar(scale);
      } else {
        m.visible = false;
      }
    }
  }
}
