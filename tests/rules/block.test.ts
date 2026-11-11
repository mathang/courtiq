import { describe, expect, it } from 'vitest';
import { evaluateBlockEligibilityAtRelease } from '../../shared/rules/block';

describe('Block eligibility rules at shot release (Section 8)', () => {
  it('marks defender eligible within the forgiving 2.6m range, facing shooter, in contesting cone, and in bounds', () => {
    const res = evaluateBlockEligibilityAtRelease({
      shooterPos: { x: 0, z: 0 },
      defenderPos: { x: 0, z: -1.4 },
      defenderFacingAngle: 0, // Facing +Z towards (0,0)
    });
    expect(res.eligible).toBe(true);
    expect(res.reason).toBe('eligible');
    expect(res.distanceM).toBeCloseTo(1.4, 4);
  });

  it('rejects block when defender is out of range (> 2.6m)', () => {
    const res = evaluateBlockEligibilityAtRelease({
      shooterPos: { x: 0, z: 0 },
      defenderPos: { x: 0, z: -2.7 },
      defenderFacingAngle: 0,
    });
    expect(res.eligible).toBe(false);
    expect(res.withinRange).toBe(false);
    expect(res.reason).toBe('out-of-range');
  });

  it('rejects block when defender is facing away from the shooter', () => {
    const res = evaluateBlockEligibilityAtRelease({
      shooterPos: { x: 0, z: 0 },
      defenderPos: { x: 0, z: -1.2 },
      defenderFacingAngle: Math.PI, // Facing -Z away from shooter
    });
    expect(res.eligible).toBe(false);
    expect(res.facingShooter).toBe(false);
    expect(res.reason).toBe('not-facing-shooter');
  });

  it('rejects block when defender is standing directly behind the shooter away from the basket', () => {
    const res = evaluateBlockEligibilityAtRelease({
      shooterPos: { x: 0, z: 0 },
      defenderPos: { x: 0, z: 1.3 }, // Behind shooter (hoop is at z = -5.25)
      defenderFacingAngle: Math.PI,  // Facing shooter, but behind shooter's back
    });
    expect(res.eligible).toBe(false);
    expect(res.inContestPosition).toBe(false);
    expect(res.reason).toBe('poor-contest-angle');
  });

  it('rejects block when a player is outside playable court bounds', () => {
    const res = evaluateBlockEligibilityAtRelease({
      shooterPos: { x: 0, z: 0 },
      defenderPos: { x: 9.0, z: 0 },
      defenderFacingAngle: -Math.PI / 2,
    });
    expect(res.eligible).toBe(false);
    expect(res.insideCourt).toBe(false);
    expect(res.reason).toBe('out-of-bounds');
  });
});
