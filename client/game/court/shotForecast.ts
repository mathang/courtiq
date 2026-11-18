import * as THREE from 'three';
import { COURT_GEOMETRY } from '../../../shared/config/balance';
import type { CourtPoint2D } from '../../../shared/rules/block';

const WIDTH = 3.12;
const DEPTH = 1.95;
const FLOOR_Y = 0.038;

function floorPosition(x: number, z: number): CourtPoint2D {
  return {
    x: THREE.MathUtils.clamp(x, COURT_GEOMETRY.minX + WIDTH / 2, COURT_GEOMETRY.maxX - WIDTH / 2),
    z: THREE.MathUtils.clamp(z, COURT_GEOMETRY.minZ + DEPTH / 2, COURT_GEOMETRY.maxZ - DEPTH / 2),
  };
}

export function forecastFloorPosition(attacker: CourtPoint2D): CourtPoint2D {
  const inward = attacker.x > 0 ? -1 : 1;
  return floorPosition(attacker.x + inward * 2.25, attacker.z - .95);
}

export function paintShotForecast(ctx: CanvasRenderingContext2D, percent: number): void {
  ctx.clearRect(0, 0, 512, 320);
  ctx.beginPath();
  ctx.roundRect(12, 10, 488, 300, 60);
  ctx.fillStyle = '#0a1931';
  ctx.fill();
  ctx.lineWidth = 9;
  ctx.strokeStyle = '#7eefed';
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fffef5';
  ctx.font = '900 181px system-ui, sans-serif';
  ctx.fillText(`${percent}%`, 256, 125);
  ctx.fillStyle = '#a1ffef';
  ctx.font = '850 63px system-ui, sans-serif';
  ctx.fillText('IF CORRECT', 256, 249);
}

export class ShotForecastDecal {
  private readonly canvas = document.createElement('canvas');
  private readonly texture = new THREE.CanvasTexture(this.canvas);
  private readonly context: CanvasRenderingContext2D;
  private previous: number | null = null;
  private readonly sample = new THREE.Vector3();
  public readonly mesh: THREE.Mesh;
  public screenBounds: { left: number; right: number; top: number; bottom: number } | null = null;

  constructor() {
    this.canvas.width = 512;
    this.canvas.height = 320;
    this.context = this.canvas.getContext('2d')!;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(WIDTH, DEPTH),
      new THREE.MeshBasicMaterial({
        map: this.texture, transparent: true, depthWrite: false, toneMapped: false, fog: false,
      }),
    );
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
  }

  public update(
    attacker: CourtPoint2D,
    defender: CourtPoint2D,
    percent: number | null,
    camera: THREE.PerspectiveCamera,
  ): void {
    const wasVisible = this.mesh.visible;
    this.mesh.visible = percent !== null;
    this.screenBounds = null;
    if (percent === null) return;
    camera.updateMatrixWorld();
    const inward = attacker.x > 0 ? -1 : 1;
    const positions = [
      forecastFloorPosition(attacker),
      floorPosition(attacker.x - inward * 2.25, attacker.z - .95),
      floorPosition(attacker.x + inward * 2.4, attacker.z + .9),
      floorPosition(attacker.x - inward * 2.4, attacker.z + .9),
      floorPosition(attacker.x, attacker.z - 2.45),
    ];
    const { x: previousX, z: previousZ } = this.mesh.position;
    let bestScore = Infinity;
    for (const { x, z } of positions) {
      const bounds = this.projectBounds(x, z, camera);
      const edge = Math.max(0, .035 - bounds.left) + Math.max(0, bounds.right - .965)
        + Math.max(0, .14 - bounds.top) + Math.max(0, bounds.bottom - .865);
      const distance = Math.hypot(x - attacker.x, z - attacker.z);
      const feet = Math.max(0, 1.5 - distance) + Math.max(0, 1.3 - Math.hypot(x - defender.x, z - defender.z));
      const movement = wasVisible ? Math.hypot(x - previousX, z - previousZ) : 0;
      const score = edge * 45 + feet * 2 + distance * .1 + movement * .035;
      if (score >= bestScore) continue;
      bestScore = score;
      this.screenBounds = bounds;
      this.mesh.position.set(x, FLOOR_Y, z);
    }
    if (this.previous !== percent) {
      paintShotForecast(this.context, percent);
      this.texture.needsUpdate = true;
      this.previous = percent;
    }
  }

  private projectBounds(x: number, z: number, camera: THREE.PerspectiveCamera) {
    const bounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
    for (const side of [-1, 1]) {
      for (const end of [-1, 1]) {
        const sample = this.sample.set(x + side * WIDTH / 2, FLOOR_Y, z + end * DEPTH / 2).project(camera);
        const screenX = (1 + sample.x) / 2;
        const screenY = (1 - sample.y) / 2;
        bounds.left = Math.min(bounds.left, screenX);
        bounds.right = Math.max(bounds.right, screenX);
        bounds.top = Math.min(bounds.top, screenY);
        bounds.bottom = Math.max(bounds.bottom, screenY);
      }
    }
    return bounds;
  }

  public dispose(): void {
    this.texture.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
