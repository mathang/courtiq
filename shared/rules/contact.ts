import { COURT_GEOMETRY, MOVEMENT_CONFIG } from '../config/balance';
import { isStealRecovery } from './defense';
import type { PlayerSimState } from './matchStateMachine';
import { clamp } from './timing';

type Body = Pick<PlayerSimState, 'x' | 'z' | 'vx' | 'vz' | 'defenseAction' | 'defenseRecoverySec'>;
export interface MotionTarget { x: number; z: number; response: number; }

function translate(p: Body, x: number, z: number): void {
  p.x = clamp(p.x + x, COURT_GEOMETRY.minX, COURT_GEOMETRY.maxX);
  p.z = clamp(p.z + z, COURT_GEOMETRY.minZ, COURT_GEOMETRY.maxZ);
}

/** Yielding body contact: transfer pressure, preserve sliding, and keep torsos separate. */
export function resolvePlayerContact(a: Body, b: Body, dt: number): void {
  const dx = b.x - a.x, dz = b.z - a.z, distance = Math.hypot(dx, dz);
  const preferred = MOVEMENT_CONFIG.minPlayerSeparationM;
  if (distance >= preferred) return;
  const massA = isStealRecovery(a) ? 0 : 1, massB = isStealRecovery(b) ? 0 : 1;
  const total = massA + massB;
  if (!total) return;
  // Coincident centres have a stable normal instead of leaving intersecting bodies stuck.
  const nx = distance > 1e-6 ? dx / distance : 1;
  const nz = distance > 1e-6 ? dz / distance : 0;
  const minimum = preferred - MOVEMENT_CONFIG.contactCompressionM;
  const correction = Math.max(minimum - distance, (preferred - distance) * (1 - Math.exp(-MOVEMENT_CONFIG.contactResponse * dt)));
  translate(a, -nx * correction * massA / total, -nz * correction * massA / total);
  translate(b, nx * correction * massB / total, nz * correction * massB / total);

  // Redistribute any correction blocked by a court edge to the player who can yield.
  const remaining = minimum - Math.hypot(b.x - a.x, b.z - a.z);
  if (remaining > 1e-6) {
    if (massA) translate(a, -nx * remaining, -nz * remaining);
    if (massB) translate(b, nx * remaining, nz * remaining);
  }
  const closingSpeed = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
  if (closingSpeed > 0) {
    const impulse = closingSpeed * (1 - Math.exp(-MOVEMENT_CONFIG.contactVelocityResponse * dt)) / total;
    a.vx -= nx * impulse * massA; a.vz -= nz * impulse * massA;
    b.vx += nx * impulse * massB; b.vz += nz * impulse * massB;
  }
}

/** Small motion steps keep contact responsive and prevent crossing through bodies at low FPS. */
export function stepPlayerMotion(players: [Body, Body], targets: [MotionTarget, MotionTarget], deltaSec: number): void {
  const steps = Math.max(1, Math.ceil(deltaSec / MOVEMENT_CONFIG.motionStepSec));
  const dt = deltaSec / steps;
  for (let i = 0; i < steps; i++) {
    for (const slot of [0, 1] as const) {
      const p = players[slot], target = targets[slot];
      if (isStealRecovery(p)) { p.vx = 0; p.vz = 0; continue; }
      const blend = 1 - Math.exp(-target.response * dt);
      p.vx += (target.x - p.vx) * blend; p.vz += (target.z - p.vz) * blend;
      translate(p, p.vx * dt, p.vz * dt);
    }
    resolvePlayerContact(players[0], players[1], dt);
  }
}
