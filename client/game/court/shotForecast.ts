import * as THREE from 'three';
import { COURT_GEOMETRY } from '../../../shared/config/balance';
import type { CourtPoint2D } from '../../../shared/rules/block';

export function forecastFloorPosition(attacker: CourtPoint2D): CourtPoint2D {
  const x = THREE.MathUtils.clamp(attacker.x, COURT_GEOMETRY.minX + 1.8, COURT_GEOMETRY.maxX - 1.8);
  // Leave space between the feet and the projection, including at the check line.
  return { x, z: Math.min(COURT_GEOMETRY.maxZ + 0.45, attacker.z + 1.65) };
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
  public readonly mesh: THREE.Mesh;

  constructor() {
    this.canvas.width = 512;
    this.canvas.height = 320;
    this.context = this.canvas.getContext('2d')!;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(3.55, 2.22),
      new THREE.MeshBasicMaterial({
        map: this.texture, transparent: true, depthWrite: false, toneMapped: false, fog: false,
      }),
    );
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
  }

  public update(attacker: CourtPoint2D, percent: number | null): void {
    this.mesh.visible = percent !== null;
    if (percent === null) return;
    const { x, z } = forecastFloorPosition(attacker);
    this.mesh.position.set(x, 0.038, z);
    if (this.previous !== percent) {
      paintShotForecast(this.context, percent);
      this.texture.needsUpdate = true;
      this.previous = percent;
    }
  }

  public dispose(): void {
    this.texture.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
