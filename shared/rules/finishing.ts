import { COURT_GEOMETRY } from '../config/balance';

/** The same rectangle used to paint the blue lane in the arena. */
export function isInPaint(p: { x: number; z: number }): boolean {
  const paint = COURT_GEOMETRY.paint;
  return p.x >= paint.minX && p.x <= paint.maxX && p.z >= paint.minZ && p.z <= paint.maxZ;
}

/** Decide from actual authoritative motion before the shot zeros velocity. */
export function isDrivingInPaint(p: { x: number; z: number; vx: number; vz: number }): boolean {
  if (!isInPaint(p)) return false;
  const dx = COURT_GEOMETRY.hoopX - p.x, dz = COURT_GEOMETRY.hoopZ - p.z;
  const distance = Math.hypot(dx, dz);
  return distance > 0.01 && (p.vx * dx + p.vz * dz) / distance >= 0.4;
}
