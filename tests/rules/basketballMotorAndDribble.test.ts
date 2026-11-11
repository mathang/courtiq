import { describe, expect, it } from 'vitest';
import { BUNDLED_QUESTION_PACKS } from '../../content/packRegistry';
import { COURT_GEOMETRY } from '../../shared/config/balance';
import { AuthoritativeMatchEngine, PlayerMoveInput } from '../../shared/rules/matchStateMachine';

const NEUTRAL: PlayerMoveInput = { moveX: 0, moveZ: 0, sprint: false, shoot: false };

function createMatch(seed = 101) {
  const engine = new AuthoritativeMatchEngine({
    matchId: 'motor-dribble',
    mode: 'solo',
    pack: BUNDLED_QUESTION_PACKS[0],
    roomPresetId: 'standard',
    sessionLengthId: 'quick',
    player0: { id: 'p0', pseudonym: 'Attacker' },
    player1: { id: 'p1', pseudonym: 'Defender', isAi: false },
    seed,
  });
  engine.startMatch();
  return engine;
}

function angleDiffRad(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

describe('Basketball motor: directional defense, cuts, hard stops & ball continuity', () => {
  it('keeps a retreating or laterally sliding defender oriented to the ball-handler and block-eligible', () => {
    const e = createMatch(1);
    e.players[0].x = 0;
    e.players[0].z = 1.2;
    e.players[1].x = 0;
    e.players[1].z = 0.2;

    // Defender retreats toward the basket while attacker drives forward
    for (let i = 0; i < 24; i++) {
      e.step(1000 / 60, [
        { ...NEUTRAL, moveZ: -1 },
        { ...NEUTRAL, moveZ: -1 },
      ]);
    }
    const toAttacker = Math.atan2(
      e.players[0].x - e.players[1].x,
      e.players[0].z - e.players[1].z,
    );
    expect(angleDiffRad(e.players[1].facingAngle, toAttacker)).toBeLessThan(Math.PI * 0.45);
    const retreatElig = e.getLiveBlockEligibility();
    expect(retreatElig.eligible).toBe(true);
    expect(retreatElig.reason).toBe('eligible');

    // Defender slides laterally to mirror a wing move
    for (let i = 0; i < 24; i++) {
      e.step(1000 / 60, [
        { ...NEUTRAL, moveX: 1 },
        { ...NEUTRAL, moveX: 1 },
      ]);
    }
    const toAttackerWing = Math.atan2(
      e.players[0].x - e.players[1].x,
      e.players[0].z - e.players[1].z,
    );
    expect(angleDiffRad(e.players[1].facingAngle, toAttackerWing)).toBeLessThan(Math.PI * 0.45);
    expect(e.getLiveBlockEligibility().eligible).toBe(true);
  });

  it('transitions smoothly through a lateral/retreat dribble into a hard stop without facing or ball teleports', () => {
    const e = createMatch(2);
    let prevBall = e.getBallPosition3D();
    let prevFacing = e.players[0].facingAngle;
    let maxBallStepOnStop = 0;
    let maxFacingStepOnStop = 0;

    for (let i = 0; i < 50; i++) {
      const inp = i < 30 ? { ...NEUTRAL, moveX: 1, moveZ: 0.6 } : NEUTRAL;
      e.step(1000 / 60, [inp, NEUTRAL]);
      const ball = e.getBallPosition3D();
      const ballStep = Math.hypot(
        ball.x - prevBall.x,
        ball.y - prevBall.y,
        ball.z - prevBall.z,
      );
      const facingStep = angleDiffRad(e.players[0].facingAngle, prevFacing);
      if (i >= 30) {
        maxBallStepOnStop = Math.max(maxBallStepOnStop, ballStep);
        maxFacingStepOnStop = Math.max(maxFacingStepOnStop, facingStep);
      }
      prevBall = ball;
      prevFacing = e.players[0].facingAngle;
    }

    // Previously snapped 135.3 deg (2.36 rad) and 0.782m in a single 16.7ms frame
    expect(maxFacingStepOnStop).toBeLessThan(0.45);
    expect(maxBallStepOnStop).toBeLessThan(0.18);
  });

  it.each([1, -1] as const)(
    'crosses the ball continuously across the body (moveX=%i) and keeps the new carrying hand afterward',
    (moveX) => {
      const e = createMatch(3);
      e.players[1].x = 5; // Uncontested lane
      for (let i = 0; i < 15; i++) {
        e.step(1000 / 60, [{ ...NEUTRAL, moveZ: -1 }, NEUTRAL]);
      }

      const sideCoord = () => {
        const p = e.players[0];
        const b = e.getBallPosition3D();
        const rightX = Math.cos(p.facingAngle);
        const rightZ = -Math.sin(p.facingAngle);
        return (b.x - p.x) * rightX + (b.z - p.z) * rightZ;
      };

      const sideBefore = sideCoord();
      let prevBall = e.getBallPosition3D();
      let maxBallStep = 0;

      for (let i = 0; i < 42; i++) {
        const inp: PlayerMoveInput =
          i === 0
            ? { ...NEUTRAL, moveX, moveZ: -1, trick: 'crossover' }
            : { ...NEUTRAL, moveZ: -1 };
        e.step(1000 / 60, [inp, NEUTRAL]);
        const b = e.getBallPosition3D();
        maxBallStep = Math.max(
          maxBallStep,
          Math.hypot(b.x - prevBall.x, b.y - prevBall.y, b.z - prevBall.z),
        );
        prevBall = b;
      }

      const sideAfter = sideCoord();
      // Previously snapped 0.648m on entry (moveX=-1) and 0.502m on exit (moveX=+1), snapping back to +1
      expect(maxBallStep).toBeLessThan(0.24);
      expect(Math.sign(sideAfter)).toBe(-Math.sign(sideBefore));
      expect(Math.abs(sideAfter)).toBeGreaterThan(0.2);
    },
  );

  it('protects the dribble away from a closely shading defender while moving', () => {
    const e = createMatch(4);
    // Attacker at (0, 2.4) facing hoop (-Z), defender shading closely on world -X (attacker +sideCoord)
    e.players[0].x = 0;
    e.players[0].z = 2.4;
    e.players[1].x = -0.78;
    e.players[1].z = 1.9;

    for (let i = 0; i < 36; i++) {
      e.step(1000 / 60, [
        { ...NEUTRAL, moveX: 0.35, moveZ: -0.85 },
        { ...NEUTRAL, moveX: 0.35, moveZ: -0.85 },
      ]);
    }

    const att = e.players[0];
    const def = e.players[1];
    const ball = e.getBallPosition3D();
    const ballDistToDef = Math.hypot(ball.x - def.x, ball.z - def.z);
    const bodyDistToDef = Math.hypot(att.x - def.x, att.z - def.z);
    // Protected carrying hand places the ball farther from the shading defender than the attacker's torso center
    expect(ballDistToDef).toBeGreaterThan(bodyDistToDef + 0.12);
  });

  it('gathers a jump shot continuously from the live dribble without teleporting the ball on shot initiation', () => {
    const e = createMatch(5);
    for (let i = 0; i < 24; i++) {
      e.step(1000 / 60, [{ ...NEUTRAL, moveX: 0.5, moveZ: -0.4 }, NEUTRAL]);
    }
    const beforeShot = e.getBallPosition3D();
    e.initiateShotAttempt({ ...NEUTRAL, shoot: true });
    expect(e.players[0].finishKind).toBe('jump');

    const atShotInit = e.getBallPosition3D();
    // Previously jumped 1.945m instantaneously to y=2.15 on frame 0
    expect(
      Math.hypot(
        atShotInit.x - beforeShot.x,
        atShotInit.y - beforeShot.y,
        atShotInit.z - beforeShot.z,
      ),
    ).toBeLessThan(0.05);

    let prev = atShotInit;
    let maxStep = 0;
    for (let i = 0; i < 30; i++) {
      e.step(1000 / 60, [NEUTRAL, NEUTRAL]);
      const cur = e.getBallPosition3D();
      maxStep = Math.max(
        maxStep,
        Math.hypot(cur.x - prev.x, cur.y - prev.y, cur.z - prev.z),
      );
      prev = cur;
    }
    expect(e.phase).toBe('Duel');
    expect(maxStep).toBeLessThan(0.22);
    expect(prev.y).toBeGreaterThan(2.3);
    expect(Math.hypot(prev.x - COURT_GEOMETRY.hoopX, prev.z - COURT_GEOMETRY.hoopZ)).toBeGreaterThan(1.0);
  });
});
