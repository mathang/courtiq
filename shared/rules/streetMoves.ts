import { COURT_GEOMETRY } from '../config/balance';
import type { PlayerSimState } from './matchStateMachine';

export type StreetMove = 'crossover' | 'spin' | 'eurostep' | 'stepback';
export const STREET_MOVES: Record<StreetMove, { label: string; duration: number; speed: number; cost: number }> = {
  crossover: { label: 'CROSSOVER', duration: 0.34, speed: 9.8, cost: 0.16 },
  spin: { label: 'SPIN MOVE', duration: 0.48, speed: 8.8, cost: 0.22 },
  eurostep: { label: 'EUROSTEP', duration: 0.56, speed: 8.4, cost: 0.22 },
  stepback: { label: 'STEP BACK', duration: 0.32, speed: 9.2, cost: 0.18 },
};
export function isStreetMove(value: unknown): value is StreetMove {
  return typeof value === 'string' && Object.hasOwn(STREET_MOVES, value);
}

// Shared by the authoritative ball position and the character rig: hands and ball
// follow the same take-off, suspended question moment, finish and landing.
export function getAirPose(p: PlayerSimState): { x: number; y: number; z: number; progress: number } {
  if (!p.finishKind) return { x: p.x, y: 0, z: p.z, progress: 0 };
  const t = p.finishElapsedSec;
  if (p.finishKind === 'jump') {
    return { x: p.x, z: p.z, y: t < 0.8 ? Math.sin(Math.PI * t / 0.8) * 0.48 : 0, progress: Math.min(1, t / 0.8) };
  }
  const r = p.finishResolutionSec;
  const takeoff = Math.min(1, t / 0.62);
  const finish = r < 0 ? 0 : Math.min(1, r / 0.30);
  const progress = takeoff * 0.64 + finish * 0.36;
  const dx = COURT_GEOMETRY.hoopX - p.x;
  const dz = COURT_GEOMETRY.hoopZ - p.z;
  const len = Math.hypot(dx, dz) || 1;
  const landing = r < 0.30 ? 0 : Math.min(1, (r - 0.30) / 0.48);
  return {
    x: p.x + (dx - dx / len * 0.22) * progress,
    z: p.z + (dz - dz / len * 0.22) * progress,
    y: (takeoff < 0.25 ? -Math.sin(takeoff / 0.25 * Math.PI) * 0.12 : Math.sin((takeoff - 0.25) / 0.75 * Math.PI / 2) * 1.05) * (1 - landing),
    progress,
  };
}
