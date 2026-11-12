import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { StreetballRig } from '../../client/game/characters/streetballRig';
import { AuthoritativeMatchEngine, PlayerMoveInput } from '../../shared/rules/matchStateMachine';
import { BUNDLED_QUESTION_PACKS } from '../../content/packRegistry';
import { getAirPose } from '../../shared/rules/streetMoves';

const assets = await Promise.all(
  ['streetball-player.glb', 'athlete-sky.glb'].map(async (name) => {
    const bytes = readFileSync(new URL(`../../public/assets/player/${name}`, import.meta.url));
    const asset = await new GLTFLoader().parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '',
    );
    return { name, asset };
  }),
);

const NEUTRAL: PlayerMoveInput = { moveX: 0, moveZ: 0, sprint: false, shoot: false };

for (const { name, asset } of assets) {
function createActor() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const model = clone(asset.scene);
  model.scale.setScalar(1.05);
  body.add(model);
  root.add(body);
  return {
    root,
    body,
    model,
    rig: new StreetballRig(model, body, asset.animations),
  };
}

function createMatch(seed = 7) {
  const engine = new AuthoritativeMatchEngine({
    matchId: 'rig-continuity',
    mode: 'solo',
    seed,
    pack: BUNDLED_QUESTION_PACKS[0],
    roomPresetId: 'standard',
    sessionLengthId: 'quick',
    player0: { id: 'a', pseudonym: 'CLARK' },
    player1: { id: 'b', pseudonym: 'DEFENDER', isAi: false },
  });
  engine.startMatch();
  return engine;
}

describe(`${name}: footwork, sole clearance & ball-hand continuity across real transitions`, () => {
  it('transitions feet through sprint, reversal cut, crossover and hard stop without snapping, skating or sole penetration', () => {
    const e = createMatch(11);
    const a = createActor();
    e.players[1].x = 5.5;

    let maxFootStepM = 0;
    let maxPlantedSlipM = 0;
    let minSoleY = Infinity;
    let prevFeet: [THREE.Vector3, THREE.Vector3] | null = null;

    for (let i = 0; i < 150; i++) {
      const inp: PlayerMoveInput =
        i < 35
          ? { ...NEUTRAL, moveX: 1, moveZ: -0.8, sprint: true }
          : i < 70
            ? { ...NEUTRAL, moveX: -1, moveZ: -0.8, sprint: true }
            : i === 70
              ? { ...NEUTRAL, moveX: 1, moveZ: -1, trick: 'crossover' }
              : i < 100
                ? { ...NEUTRAL, moveX: 1, moveZ: -1 }
                : NEUTRAL;

      e.step(1000 / 60, [inp, NEUTRAL]);
      const p = e.players[0];
      const air = getAirPose(p);
      a.root.position.set(air.x, 0, air.z);
      a.body.position.set(0, air.y, 0);
      a.body.rotation.set(0, p.facingAngle, 0);
      a.rig.update(p, true, 1 / 60, e.getBallPosition3D());
      a.root.updateMatrixWorld(true);

      const feet = ['foot_l', 'foot_r'].map((n) =>
        a.model.getObjectByName(n)!.getWorldPosition(new THREE.Vector3()),
      ) as [THREE.Vector3, THREE.Vector3];

      if (prevFeet) {
        for (let f = 0; f < 2; f++) {
          maxFootStepM = Math.max(maxFootStepM, feet[f].distanceTo(prevFeet[f]));
          if (feet[f].y < 0.094 && prevFeet[f].y < 0.094) {
            maxPlantedSlipM = Math.max(
              maxPlantedSlipM,
              Math.hypot(feet[f].x - prevFeet[f].x, feet[f].z - prevFeet[f].z),
            );
          }
        }
      }
      prevFeet = feet;

      a.model.traverse((o) => {
        if (!(o instanceof THREE.SkinnedMesh) || !o.name.includes('Shoe')) return;
        o.skeleton.update();
        for (let j = 0; j < o.geometry.attributes.position.count; j++) {
          minSoleY = Math.min(
            minSoleY,
            o.localToWorld(o.getVertexPosition(j, new THREE.Vector3())).y,
          );
        }
      });
    }

    // Baseline defects were: maxFootStepM=0.983m, maxPlantedSlipM=0.258m, minSoleY=-0.0461m
    expect(maxFootStepM).toBeLessThan(0.28);
    expect(maxPlantedSlipM).toBeLessThan(0.03);
    expect(minSoleY).toBeGreaterThan(-0.004);
  });

  it('maintains wide uncrossed feet and active stepping during lateral defensive slides', () => {
    const e = createMatch(12);
    const a = createActor();
    let minLateralFootGap = Infinity;
    let maxPlantedSlipM = 0;
    let prevFeet: [THREE.Vector3, THREE.Vector3] | null = null;

    for (let i = 0; i < 90; i++) {
      const defInput: PlayerMoveInput = i < 45 ? { ...NEUTRAL, moveX: 1 } : { ...NEUTRAL, moveX: -1 };
      e.step(1000 / 60, [NEUTRAL, defInput]);
      const p = e.players[1];
      a.root.position.set(p.x, 0, p.z);
      a.body.position.set(0, 0, 0);
      a.body.rotation.set(0, p.facingAngle, 0);
      a.rig.update(p, false, 1 / 60);
      a.root.updateMatrixWorld(true);

      const flLocal = a.body.worldToLocal(
        a.model.getObjectByName('foot_l')!.getWorldPosition(new THREE.Vector3()),
      );
      const frLocal = a.body.worldToLocal(
        a.model.getObjectByName('foot_r')!.getWorldPosition(new THREE.Vector3()),
      );
      minLateralFootGap = Math.min(minLateralFootGap, flLocal.x - frLocal.x);

      const wFeet = ['foot_l', 'foot_r'].map((n) =>
        a.model.getObjectByName(n)!.getWorldPosition(new THREE.Vector3()),
      ) as [THREE.Vector3, THREE.Vector3];
      if (prevFeet) {
        for (let f = 0; f < 2; f++) {
          if (wFeet[f].y < 0.094 && prevFeet[f].y < 0.094) {
            maxPlantedSlipM = Math.max(
              maxPlantedSlipM,
              Math.hypot(wFeet[f].x - prevFeet[f].x, wFeet[f].z - prevFeet[f].z),
            );
          }
        }
      }
      prevFeet = wFeet;
    }

    // Baseline defects were: minLateralFootGap=-0.032m (crossed legs) and maxPlantedSlipM=0.297m
    expect(minLateralFootGap).toBeGreaterThan(0.11);
    expect(maxPlantedSlipM).toBeLessThan(0.03);
  });

  it('meets the basketball with gather hands on jump shots and avoids floor-chasing or elbow flips on block jumps', () => {
    const e = createMatch(13);
    const shooter = createActor();
    let minDribbleHandY = Infinity;

    for (let i = 0; i < 36; i++) {
      e.step(1000 / 60, [{ ...NEUTRAL, moveX: 0.4, moveZ: -0.6, sprint: true }, NEUTRAL]);
      const p = e.players[0];
      const ball = e.getBallPosition3D();
      shooter.root.position.set(p.x, 0, p.z);
      shooter.body.position.set(0, 0, 0);
      shooter.body.rotation.set(0, p.facingAngle, 0);
      shooter.rig.update(p, true, 1 / 60, ball);
      shooter.root.updateMatrixWorld(true);
      for (const h of ['hand_l', 'hand_r']) {
        minDribbleHandY = Math.min(
          minDribbleHandY,
          shooter.model.getObjectByName(h)!.getWorldPosition(new THREE.Vector3()).y,
        );
      }
    }
    expect(minDribbleHandY).toBeGreaterThan(0.62);

    // Initiate jump shot from perimeter/mid-range and verify gather grip meets the rising ball
    e.players[0].x = 0.4;
    e.players[0].z = 1.6;
    e.players[0].vx = 0;
    e.players[0].vz = 0;
    e.initiateShotAttempt({ ...NEUTRAL, shoot: true });
    expect(e.players[0].finishKind).toBe('jump');

    for (let i = 0; i < 12; i++) {
      e.step(1000 / 60, [NEUTRAL, NEUTRAL]);
      const p = e.players[0];
      const air = getAirPose(p);
      const ball = e.getBallPosition3D();
      shooter.root.position.set(air.x, 0, air.z);
      shooter.body.position.set(0, air.y, 0);
      shooter.body.rotation.set(0, p.facingAngle, 0);
      shooter.rig.update(p, true, 1 / 60, ball);
      shooter.root.updateMatrixWorld(true);
      if (i >= 4 && i <= 11) {
        // Baseline had 1.253m gap between shooter palm and ball during gather!
        expect(
          shooter.rig.palm.distanceTo(new THREE.Vector3(ball.x, ball.y, ball.z)),
        ).toBeLessThan(0.22);
      }
    }

    // Defensive block jump: verify no elbow pole flip (baseline maxElbowJump was 0.422m in 1 frame!)
    const eBlock = createMatch(14);
    const defender = createActor();
    eBlock.players[0].x = 0.15;
    eBlock.players[0].z = -2.5;
    eBlock.players[0].vz = -3;
    eBlock.players[1].x = 0.0;
    eBlock.players[1].z = -3.6;
    eBlock.players[1].facingAngle = 0;
    eBlock.initiateShotAttempt({ ...NEUTRAL, shoot: true });
    eBlock.step(1000 / 60, [NEUTRAL, { ...NEUTRAL, defense: 'jump' }]);

    let maxElbowJump = 0;
    let prevElbow: THREE.Vector3 | null = null;
    for (let i = 0; i < 54; i++) {
      eBlock.step(1000 / 60, [NEUTRAL, NEUTRAL]);
      const p = eBlock.players[1];
      const air = getAirPose(p);
      defender.root.position.set(air.x, 0, air.z);
      defender.body.position.set(0, air.y, 0);
      defender.body.rotation.set(0, p.facingAngle, 0);
      defender.rig.update(p, false, 1 / 60, eBlock.getBallPosition3D());
      defender.root.updateMatrixWorld(true);
      const elb = defender.body.worldToLocal(
        defender.model.getObjectByName('lowerarm_l')!.getWorldPosition(new THREE.Vector3()),
      );
      if (prevElbow) maxElbowJump = Math.max(maxElbowJump, elb.distanceTo(prevElbow));
      prevElbow = elb;
    }
    expect(maxElbowJump).toBeLessThan(0.14);
  });

  it('keeps spin-cancel transitions into crossovers and dunks smooth and preserves paused-pose exactness', () => {
    const e = createMatch(15);
    const a = createActor();
    e.players[0].x = 0.4;
    e.players[0].z = -0.8;
    e.players[1].x = 4.5;

    let prevYaw: number | null = null;
    let prevFootL: THREE.Vector3 | null = null;
    let maxYawStep = 0;
    let maxFootStep = 0;

    for (let i = 0; i < 65; i++) {
      const inp: PlayerMoveInput =
        i === 5
          ? { ...NEUTRAL, moveZ: -1, trick: 'spin' }
          : i === 24
            ? { ...NEUTRAL, moveX: 1, moveZ: -1, trick: 'crossover' }
            : { ...NEUTRAL, moveZ: -1 };
      e.step(1000 / 60, [inp, NEUTRAL]);
      const p = e.players[0];
      const air = getAirPose(p);
      const ball = e.getBallPosition3D();
      a.root.position.set(air.x, 0, air.z);
      a.body.position.set(0, air.y, 0);
      a.body.rotation.set(0, p.facingAngle, 0);
      a.rig.update(p, true, 1 / 60, ball);
      a.root.updateMatrixWorld(true);

      const yaw = a.body.rotation.y;
      const footL = a.model.getObjectByName('foot_l')!.getWorldPosition(new THREE.Vector3());
      if (prevYaw !== null) {
        maxYawStep = Math.max(
          maxYawStep,
          Math.abs(Math.atan2(Math.sin(yaw - prevYaw), Math.cos(yaw - prevYaw))),
        );
      }
      if (prevFootL) maxFootStep = Math.max(maxFootStep, footL.distanceTo(prevFootL));
      prevYaw = yaw;
      prevFootL = footL;

      // Check paused-pose exactness right after spin->crossover chain
      if (i === 27) {
        const pausedPalm = a.rig.palm.clone();
        const pausedFoot = footL.clone();
        const pausedYaw = a.body.rotation.y;
        for (let k = 0; k < 15; k++) {
          a.root.position.set(air.x, 0, air.z);
          a.body.position.set(0, air.y, 0);
          a.body.rotation.set(0, p.facingAngle, 0);
          a.rig.update(p, true, 0, ball);
          a.root.updateMatrixWorld(true);
        }
        expect(a.rig.palm.distanceTo(pausedPalm)).toBeLessThan(1e-7);
        expect(
          a.model.getObjectByName('foot_l')!.getWorldPosition(new THREE.Vector3()).distanceTo(pausedFoot),
        ).toBeLessThan(1e-7);
        expect(Math.abs(a.body.rotation.y - pausedYaw)).toBeLessThan(1e-7);
      }
    }

    // Baseline spin->crossover cancel snapped body yaw by ~86 deg (1.50 rad) and foot by >0.45m
    expect(maxYawStep).toBeLessThan(0.38);
    expect(maxFootStep).toBeLessThan(0.28);
  });
});
}
