import * as THREE from 'three';
import { COURT_GEOMETRY } from '../../../shared/config/balance';
import { MatchPhase } from '../../../shared/rules/matchStateMachine';
import { Vector3D } from '../../../shared/rules/shot';

/**
 * Renders the 3D pebbled composite-leather basketball, floor shadow projection disc,
 * pooled slow-motion / On-Fire ribbon trail spheres, and rim-impact shockwave ring.
 */
export class BallVisualController {
  public readonly group = new THREE.Group();
  public readonly ballMesh: THREE.Mesh;
  private readonly shadowMesh: THREE.Mesh;
  private readonly trailMeshes: THREE.Mesh[] = [];
  private readonly trailPositions: THREE.Vector3[] = [];
  private readonly maxTrailLength = 20;
  private trailSampleTimer = 0;

  private readonly burstRing: THREE.Mesh<
    THREE.RingGeometry,
    THREE.MeshBasicMaterial
  >;
  private burstTimer = 0;

  constructor() {
    const ballTex = this.createBasketballTexture();
    const ballGeo = new THREE.SphereGeometry(0.125, 24, 24);
    const ballMat = new THREE.MeshStandardMaterial({
      map: ballTex,
      roughness: 0.42,
      metalness: 0.04,
    });
    this.ballMesh = new THREE.Mesh(ballGeo, ballMat);
    this.ballMesh.castShadow = true;
    this.group.add(this.ballMesh);

    // Floor shadow disc directly under ball XZ so height above floor is always readable
    this.shadowMesh = new THREE.Mesh(
      new THREE.CircleGeometry(0.2, 24),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.36,
        depthWrite: false,
      })
    );
    this.shadowMesh.rotation.x = -Math.PI / 2;
    this.shadowMesh.position.y = 0.012;
    this.group.add(this.shadowMesh);

    // Pooled trail spheres for slow-motion flight & On-Fire / Combo street streaks
    const trailGeo = new THREE.SphereGeometry(0.088, 10, 10);
    for (let i = 0; i < this.maxTrailLength; i++) {
      const ratio = 1 - i / this.maxTrailLength;
      const mat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0xfdb913 : 0x38bdf8,
        transparent: true,
        opacity: ratio * 0.46,
        depthWrite: false,
      });
      const m = new THREE.Mesh(trailGeo, mat);
      m.visible = false;
      this.trailMeshes.push(m);
      this.group.add(m);
    }

    // Pooled rim-impact shockwave ring (basket celebration / swat)
    this.burstRing = new THREE.Mesh(
      new THREE.RingGeometry(0.21, 0.29, 36),
      new THREE.MeshBasicMaterial({
        color: 0xfdb913,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
    );
    this.burstRing.rotation.x = -Math.PI / 2;
    this.burstRing.position.set(
      COURT_GEOMETRY.hoopX,
      COURT_GEOMETRY.hoopY + 0.02,
      COURT_GEOMETRY.hoopZ
    );
    this.burstRing.visible = false;
    this.group.add(this.burstRing);
  }

  public triggerRimBurst(colorHex = 0xfdb913): void {
    this.burstRing.material.color.setHex(colorHex);
    this.burstTimer = 0.55;
  }

  private createBasketballTexture(): THREE.CanvasTexture {
    const W = 512;
    const H = 256;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;

    const baseGrad = ctx.createLinearGradient(0, 0, 0, H);
    baseGrad.addColorStop(0, '#d9480f');
    baseGrad.addColorStop(0.5, '#ea580c');
    baseGrad.addColorStop(1, '#c2410c');
    ctx.fillStyle = baseGrad;
    ctx.fillRect(0, 0, W, H);

    // Deterministic pebbled composite-leather grain
    for (let y = 3; y < H; y += 5) {
      for (let x = 3; x < W; x += 5) {
        const dark = (x * 7 + y * 13) % 3 === 0;
        ctx.fillStyle = dark ? 'rgba(90, 24, 6, 0.24)' : 'rgba(255, 196, 140, 0.14)';
        ctx.fillRect(x, y, 2.2, 2.2);
      }
    }

    // Deep molded black rubber channels
    ctx.strokeStyle = '#141210';
    ctx.lineWidth = 8.5;
    ctx.beginPath();
    ctx.moveTo(0, H * 0.5);
    ctx.lineTo(W, H * 0.5);
    ctx.moveTo(W * 0.5, 0);
    ctx.lineTo(W * 0.5, H);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(W * 0.25, H * 0.5, 92, -Math.PI * 0.5, Math.PI * 0.5);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(W * 0.75, H * 0.5, 92, Math.PI * 0.5, Math.PI * 1.5);
    ctx.stroke();

    // Subtle gold brand foil stamp on upper panel
    ctx.fillStyle = '#fde68a';
    ctx.font = '900 18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('COURTIQ', W * 0.25, H * 0.34);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  public update(params: {
    pos: Vector3D;
    phase: MatchPhase;
    reducedMotion: boolean;
    deltaSec: number;
    onFire?: boolean;
    comboCount?: number;
  }): void {
    const { pos, phase, reducedMotion, deltaSec } = params;
    const onFire = Boolean(params.onFire);
    const comboCount = params.comboCount ?? 0;

    this.ballMesh.position.set(pos.x, pos.y, pos.z);
    const spinRate =
      phase === 'QuestionReady' || phase === 'Duel' ? 2.4 : 8.5;
    this.ballMesh.rotation.x -= deltaSec * spinRate;

    const ballMat = this.ballMesh.material as THREE.MeshStandardMaterial;
    ballMat.emissive.setHex(onFire ? 0xff4d00 : comboCount >= 2 ? 0xf59e0b : 0x000000);
    ballMat.emissiveIntensity = onFire ? 0.32 : comboCount >= 2 ? 0.14 : 0;

    // Update floor shadow disc scale & opacity by height
    this.shadowMesh.position.set(pos.x, 0.012, pos.z);
    const heightScale = Math.max(0.45, 1.12 - pos.y * 0.14);
    this.shadowMesh.scale.setScalar(heightScale);
    (this.shadowMesh.material as THREE.MeshBasicMaterial).opacity =
      Math.max(0.12, 0.38 - pos.y * 0.06);

    // Update rim shockwave ring
    if (this.burstTimer > 0) {
      this.burstTimer = Math.max(0, this.burstTimer - deltaSec);
      if (reducedMotion || this.burstTimer <= 0) {
        this.burstRing.visible = false;
      } else {
        const progress = 1 - this.burstTimer / 0.55;
        this.burstRing.visible = true;
        this.burstRing.scale.setScalar(1 + progress * 3.4);
        this.burstRing.material.opacity = (1 - progress) * 0.78;
      }
    } else {
      this.burstRing.visible = false;
    }

    // Show pooled ball trail during slow-motion shot flight OR live On-Fire / 2x+ Combo streaks
    const streetStreak =
      phase === 'Possession' && (onFire || comboCount >= 2);
    const showTrail =
      !reducedMotion &&
      (streetStreak ||
        phase === 'QuestionReady' ||
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
    const sampleStep = streetStreak ? 0.022 : 0.032;
    if (this.trailSampleTimer >= sampleStep || this.trailPositions.length === 0) {
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
        const ratio = 1 - i / this.maxTrailLength;
        const scale = Math.max(0.22, ratio * (onFire ? 1.15 : 0.95));
        m.scale.setScalar(scale);
        const mat = m.material as THREE.MeshBasicMaterial;
        if (onFire) {
          mat.color.setHex(i % 2 === 0 ? 0xff6b00 : 0xffd15c);
          mat.opacity = ratio * 0.56;
        } else {
          mat.color.setHex(i % 2 === 0 ? 0xfdb913 : 0x38bdf8);
          mat.opacity = ratio * 0.42;
        }
      } else {
        m.visible = false;
      }
    }
  }
}
