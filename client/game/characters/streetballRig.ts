import * as THREE from "three";
import type { PlayerSimState } from "../../../shared/rules/matchStateMachine";
import { dunkRig } from "../../../shared/rules/dunks";
import { STREET_MOVES } from "../../../shared/rules/streetMoves";
import { smoothMotion, unit } from "../../../shared/rules/motionCurves";
import { BasketballAnimator } from "./basketballAnimator";

const Y = new THREE.Vector3(0, 1, 0);
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
interface Reference {
  bone: THREE.Bone;
  rotation: THREE.Quaternion;
  local: THREE.Quaternion;
  direction: THREE.Vector3;
  length: number;
}

/** Presentation-only two-bone IK. Rule/ball/block coordinates remain authoritative.
 * Targets use metres in the yaw-aligned player frame; independent clones own all bones.
 */
export class StreetballRig {
  private refs = new Map<string, Reference>();
  private phase = 0;
  private lastBallY: number | null = null;
  private offset = 0;
  private pitch = 0;
  private roll = 0;
  private spinYaw = 0;
  private lastVisualYaw: number | null = null;
  private settled = false;
  private wasDunk = false;
  private wasDunkAtYaw = false;
  private wasAirborne = false;
  private contacts: number[] = [];
  private animator: BasketballAnimator;
  private direction = new THREE.Vector2(0, 1);
  private hands = [v(-0.31, 1.08, 0.1), v(0.31, 1.02, 0.28)];
  private feet = [-1, 1].map(() => ({
    contact: false,
    plant: null as THREE.Vector3 | null,
    start: null as THREE.Vector3 | null,
    end: null as THREE.Vector3 | null,
    last: null as THREE.Vector3 | null,
    current: null as THREE.Vector3 | null,
    gather: null as THREE.Vector3 | null,
    swingElapsed: 0,
    swingDuration: 0.18,
    plantHoldSec: 0,
    soundCooldown: 0,
  }));
  public resetMotion(): void {
    this.settled = false;
    this.lastBallY = null;
    this.movement = 0;
    this.spinYaw = 0;
    this.lastVisualYaw = null;
    this.wasDunk = false;
    this.wasDunkAtYaw = false;
    this.wasAirborne = false;
    this.contacts = [];
    this.feet.forEach((f) => {
      f.contact = false;
      f.plant = f.start = f.end = null;
      f.last = f.current = f.gather = null;
      f.swingElapsed = 0;
      f.swingDuration = 0.18;
      f.plantHoldSec = 0;
      f.soundCooldown = 0;
    });
  }
  private floorPoint(point: THREE.Vector3): THREE.Vector3 {
    point.applyAxisAngle(Y, this.body.rotation.y);
    return this.body.parent!.localToWorld(point);
  }
  private canonicalPoint(
    point: THREE.Vector3,
    airY: number,
    yaw: number,
  ): THREE.Vector3 {
    point.y += airY;
    point.applyAxisAngle(Y, yaw);
    return this.body.worldToLocal(this.body.parent!.localToWorld(point));
  }

  private movement = 0;
  public readonly palm = new THREE.Vector3();
  constructor(
    private model: THREE.Object3D,
    private body: THREE.Group,
    clips: THREE.AnimationClip[] = [],
  ) {
    this.animator = new BasketballAnimator(model, clips);
    model.updateWorldMatrix(true, true);
    model.traverse((o) => {
      if (!(o instanceof THREE.Bone)) return;
      const child = o.children.find((c) => c instanceof THREE.Bone);
      const direction = child
        ? child
            .getWorldPosition(new THREE.Vector3())
            .sub(o.getWorldPosition(new THREE.Vector3()))
        : Y.clone();
      this.refs.set(o.name, {
        bone: o,
        rotation: o.getWorldQuaternion(new THREE.Quaternion()),
        local: o.quaternion.clone(),
        length: direction.length(),
        direction: direction.normalize(),
      });
    });
  }
  public animationState() {
    return this.animator.snapshot();
  }
  public consumeFootContacts() {
    const out = this.contacts;
    this.contacts = [];
    return out;
  }
  public dispose() {
    this.animator.dispose();
  }
  private bone(name: string) {
    return this.refs.get(name)!;
  }
  private aim(name: string, worldDirection: THREE.Vector3): void {
    const ref = this.bone(name),
      frame = this.body.getWorldQuaternion(new THREE.Quaternion());
    const from = ref.direction.clone().applyQuaternion(frame);
    const turn = new THREE.Quaternion().setFromUnitVectors(
      from,
      worldDirection.clone().normalize(),
    );
    const goal = turn.multiply(frame).multiply(ref.rotation);
    const parent = ref.bone
      .parent!.getWorldQuaternion(new THREE.Quaternion())
      .invert();
    ref.bone.quaternion.copy(parent.multiply(goal));
    ref.bone.updateWorldMatrix(false, true);
  }
  private solve(
    upper: string,
    lower: string,
    end: string,
    target: THREE.Vector3,
    pole: THREE.Vector3,
    palm = 0,
  ): void {
    const a = this.bone(upper),
      b = this.bone(lower);
    const origin = a.bone.getWorldPosition(new THREE.Vector3());
    const line = target.clone().sub(origin),
      rawDistance = line.length();
    line.normalize();
    const l1 = a.length,
      l2 = b.length + palm;
    const distance = THREE.MathUtils.clamp(
      rawDistance,
      Math.abs(l1 - l2) + 0.002,
      l1 + l2 - (palm ? 0.005 : 0.001),
    );
    const along = (l1 * l1 - l2 * l2 + distance * distance) / (2 * distance);
    const height = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    const bend = pole
      .clone()
      .sub(origin)
      .addScaledVector(line, -pole.clone().sub(origin).dot(line));
    if (bend.lengthSq() < 1e-6) {
      bend.set(0, 0, 1).addScaledVector(line, -line.z);
    }
    bend.normalize();
    const elbow = origin
      .clone()
      .addScaledVector(line, along)
      .addScaledVector(bend, height);
    const clamped = origin.clone().addScaledVector(line, distance);
    this.aim(upper, elbow.clone().sub(origin));
    this.aim(lower, clamped.clone().sub(elbow));
    if (palm) this.aim(end, clamped.clone().sub(elbow));
  }
  private point(point: THREE.Vector3): THREE.Vector3 {
    return this.body.localToWorld(point.clone());
  }
  private hand(
    side: number,
    target: THREE.Vector3,
    pole: THREE.Vector3,
    ballContact = 0,
  ): void {
    const suffix = side > 0 ? "l" : "r";
    const world = this.point(target);
    if (ballContact) {
      const shoulder = this.bone(`upperarm_${suffix}`).bone.getWorldPosition(
        new THREE.Vector3(),
      );
      // Put the palm on the near surface, rather than inside the basketball.
      world.addScaledVector(
        world.clone().sub(shoulder).normalize(),
        -0.075 * ballContact,
      );
    }
    this.solve(
      `upperarm_${suffix}`,
      `lowerarm_${suffix}`,
      `hand_${suffix}`,
      world,
      this.point(pole),
      0.082,
    );
    if (side > 0) {
      const hand = this.bone(`hand_${suffix}`).bone;
      this.palm.copy(hand.localToWorld(v(0, 0.075, 0)));
    }
    // Relaxed, articulated fingers, with a stronger curl on the ball hand.
    for (const finger of ["index", "middle", "ring", "pinky"])
      for (const joint of ["01", "02", "03"]) {
        const ref = this.refs.get(`${finger}_${joint}_${suffix}`);
        if (ref)
          ref.bone.rotateX((side > 0 ? 1 : -1) * (0.16 + 0.3 * ballContact));
      }
  }
  public update(
    p: PlayerSimState,
    isAttacker: boolean,
    dt: number,
    ball?: { x: number; y: number; z: number },
    options: { inPlace?: boolean } = {},
  ): void {
    const step = Math.max(0, Math.min(0.1, dt));
    for (const ref of this.refs.values()) ref.bone.quaternion.copy(ref.local);
    const speed = Math.hypot(p.vx, p.vz),
      airY = this.body.position.y;
    const run = THREE.MathUtils.smoothstep(speed, 2, 5);
    const movingTarget = Math.min(1, speed / 1.5);
    this.movement = THREE.MathUtils.damp(this.movement, movingTarget, 11, step);
    const cadence = THREE.MathUtils.lerp(
      1 + speed * 0.28,
      1.5 + speed * 0.14,
      run,
    );
    if (speed > 0.1) this.phase += step * cadence * Math.PI * 2;
    this.animator.update(p, isAttacker, step, this.phase / (Math.PI * 2));
    const stride = Math.sin(this.phase),
      moving = this.movement;
    const dunk = p.finishKind === "dunk",
      shot = p.finishKind === "jump",
      jump = p.defenseAction === "jump";
    const r = p.finishResolutionSec;
    const airborne = (dunk && r < 0.78) || shot || jump;
    if ((dunk && !this.wasDunk) || (airborne && !this.wasAirborne)) {
      this.feet.forEach((f) => {
        f.gather = f.last?.clone() ?? null;
      });
    }
    if (!airborne && this.wasAirborne) {
      this.feet.forEach((f) => {
        if (f.last) {
          f.plant = v(f.last.x, 0.092, f.last.z);
          f.contact = true;
          f.start = f.end = null;
          f.swingElapsed = 0;
        }
      });
    }
    this.wasDunk = dunk;
    this.wasAirborne = airborne;
    const landing =
      dunk && r > 0.65 && r < 1.15
        ? Math.sin(unit((r - 0.65) / 0.5) * Math.PI)
        : 0;
    const moveU = p.streetMove
      ? unit(p.moveElapsedSec / STREET_MOVES[p.streetMove].duration)
      : 0;
    const trick = p.streetMove ? Math.sin(moveU * Math.PI) : 0;
    const swipe =
      p.defenseAction === "swipe"
        ? Math.sin(unit(p.defenseElapsedSec / 0.32) * Math.PI)
        : 0;
    const plantPulse =
      !airborne && (p.plantSec ?? 0) > 0
        ? Math.sin(unit((p.plantSec ?? 0) / 0.16) * Math.PI)
        : 0;
    const crouch = isAttacker ? 0.075 : 0.145;
    const missedSwipeFrozen =
      !isAttacker && p.defenseRecoverySec > 0 && p.defenseResult === "miss"
        ? Math.min(1, p.defenseRecoverySec / 0.6)
        : 0;
    const stumbleSink = p.wrongFootSec > 0 ? 0.055 : 0;
    const offsetTarget = airborne
      ? 0
      : -crouch -
        run * 0.025 -
        moving * 0.014 * Math.cos(this.phase * 2) -
        trick * 0.068 -
        plantPulse * 0.046 -
        stumbleSink -
        missedSwipeFrozen * 0.045 -
        landing * 0.1;
    const yaw = this.body.rotation.y;
    const localX =
      speed > 0.1 ? (Math.cos(yaw) * p.vx - Math.sin(yaw) * p.vz) / speed : 0;
    const localZ =
      speed > 0.1 ? (Math.sin(yaw) * p.vx + Math.cos(yaw) * p.vz) / speed : 1;
    const plantLocalX =
      Math.cos(yaw) * (p.plantDirX ?? 0) - Math.sin(yaw) * (p.plantDirZ ?? 0);
    const plantLocalZ =
      Math.sin(yaw) * (p.plantDirX ?? 0) + Math.cos(yaw) * (p.plantDirZ ?? 0);
    const dirAlpha = 1 - Math.exp(-step * 13);
    if (speed > 0.1)
      this.direction
        .lerp(new THREE.Vector2(localX, localZ), dirAlpha)
        .normalize();
    const fadeawayBackLean =
      shot && p.lastTrick === "stepback"
        ? -0.14 * Math.sin(unit(p.finishElapsedSec / 0.84) * Math.PI * 0.85)
        : shot
          ? -0.04
          : 0;
    let lean =
      (airborne
        ? fadeawayBackLean
        : 0.025 + run * 0.095 * Math.max(0, localZ) + plantLocalZ * plantPulse * 0.06) +
      swipe * 0.22 +
      missedSwipeFrozen * 0.15;
    let roll =
      -localX * moving * 0.045 -
      plantLocalX * plantPulse * 0.08 -
      trick *
        p.moveSide *
        0.115 *
        (p.streetMove === "eurostep" ? Math.cos(moveU * Math.PI) : 1);
    if (p.wrongFootSec > 0) roll += Math.sin(p.wrongFootSec * 14) * 0.135;
    if (!this.settled) {
      this.offset = offsetTarget;
      this.pitch = lean;
      this.roll = roll;
      this.settled = true;
    }
    this.offset = THREE.MathUtils.damp(this.offset, offsetTarget, 20, step);
    this.pitch = THREE.MathUtils.damp(this.pitch, lean, 18, step);
    this.roll = THREE.MathUtils.damp(this.roll, roll, 18, step);
    this.body.position.y = airY + this.offset;
    this.body.rotation.x = this.pitch;
    this.body.rotation.z = this.roll;
    const baseBodyYaw = this.body.rotation.y;
    if (p.streetMove === "spin") {
      const spinTurn = moveU * 0.65 + smoothMotion(moveU) * 0.35;
      const rawSpin = p.moveSide * spinTurn * Math.PI * 2;
      this.spinYaw = Math.atan2(Math.sin(rawSpin), Math.cos(rawSpin));
      this.body.rotation.y = baseBodyYaw + rawSpin;
    } else {
      if (dunk && !this.wasDunkAtYaw) {
        const callerDiff =
          this.lastVisualYaw === null
            ? 0
            : Math.atan2(
                Math.sin(this.lastVisualYaw - baseBodyYaw),
                Math.cos(this.lastVisualYaw - baseBodyYaw),
              );
        this.spinYaw = Math.abs(callerDiff) < 0.05 ? 0 : callerDiff;
      }
      const hadSpinResidual = Math.abs(this.spinYaw) > 1e-4;
      if (step > 0 && hadSpinResidual) {
        const damped = THREE.MathUtils.damp(this.spinYaw, 0, dunk ? 18 : 12, step);
        this.spinYaw += THREE.MathUtils.clamp(
          damped - this.spinYaw,
          -14 * step,
          14 * step,
        );
      }
      let nextBodyYaw = baseBodyYaw + this.spinYaw;
      if (step > 0 && hadSpinResidual && this.lastVisualYaw !== null && !dunk) {
        const totalDiff = Math.atan2(
          Math.sin(nextBodyYaw - this.lastVisualYaw),
          Math.cos(nextBodyYaw - this.lastVisualYaw),
        );
        const clampedDiff = THREE.MathUtils.clamp(totalDiff, -17 * step, 17 * step);
        const targetYaw = this.lastVisualYaw + clampedDiff;
        this.spinYaw = Math.atan2(
          Math.sin(targetYaw - baseBodyYaw),
          Math.cos(targetYaw - baseBodyYaw),
        );
        nextBodyYaw = baseBodyYaw + this.spinYaw;
      }
      this.body.rotation.y = nextBodyYaw;
    }
    this.wasDunkAtYaw = dunk;
    if (dunk) this.body.rotation.y += dunkRig(p).twist;
    this.lastVisualYaw = this.body.rotation.y;
    // A small shoulder/hip counter-rotation accompanies the stride.
    const chest = this.bone("spine_03").bone;
    chest.rotateY(stride * 0.012 * moving * (airborne ? 0 : 1));
    this.bone("Head").bone.rotateX(-this.pitch * 0.45);
    this.body.updateWorldMatrix(true, true);
    const authoredFeet = ["foot_l", "foot_r"].map((n) =>
      this.body.worldToLocal(
        this.bone(n).bone.getWorldPosition(new THREE.Vector3()),
      ),
    );
    const authoredHands = ["hand_r", "hand_l"].map((n) =>
      this.body.worldToLocal(
        this.bone(n).bone.getWorldPosition(new THREE.Vector3()),
      ),
    );

    const lateralRatio = speed > 0.25 ? Math.abs(localX) : 0;
    const baseStance = p.streetMove ? 0.48 : THREE.MathUtils.lerp(0.6, 0.34, run);
    const reach =
      THREE.MathUtils.clamp(
        (speed / Math.max(1, cadence)) * baseStance * 0.5,
        0.14,
        0.38,
      ) * moving;
    for (const [i, side] of [-1, 1].entries()) {
      const suffix = side > 0 ? "l" : "r",
        state = this.feet[i],
        otherState = this.feet[1 - i];
      const wasContact = state.contact;
      state.soundCooldown = Math.max(0, state.soundCooldown - step);

      const u = p.streetMove
        ? (((moveU * (p.streetMove === "spin" ? 1.5 : 1.0) +
            (side * p.moveSide > 0 ? 0 : 0.5)) %
            1) +
            1) %
          1
        : (((this.phase / (Math.PI * 2) + (side > 0 ? 0.5 : 0)) % 1) + 1) % 1;
      let wantContact = u < baseStance;
      const swing = unit((u - baseStance) / (1 - baseStance));
      const activeReach = p.streetMove ? 0.28 : reach;
      let along = wantContact
        ? THREE.MathUtils.lerp(activeReach, -activeReach, u / baseStance)
        : THREE.MathUtils.lerp(-activeReach, activeReach, smoothMotion(swing));
      const width =
        side *
        THREE.MathUtils.lerp(
          isAttacker ? 0.155 : 0.225,
          0.145,
          run * (1 - 0.55 * lateralRatio),
        );
      let clipLift =
        Math.sin(Math.PI * swing) *
        (0.105 + 0.085 * run + (p.streetMove ? 0.035 : 0)) *
        Math.max(moving, p.streetMove ? 0.85 : 0);
      if (
        this.animator.available &&
        !airborne &&
        !p.streetMove &&
        lateralRatio < 0.62
      ) {
        const index = side > 0 ? 0 : 1;
        const pose = authoredFeet[index];
        clipLift =
          THREE.MathUtils.clamp(
            pose.y - this.animator.floorHeight[index] * 1.05,
            0,
            0.28,
          ) * moving;
        along = THREE.MathUtils.clamp(pose.z, -0.36, 0.36) * moving;
        wantContact = clipLift < 0.032;
      }
      if (!airborne && speed < 0.2 && !p.streetMove) {
        along = 0;
        clipLift = 0;
        wantContact = true;
      }
      let desiredX = width + along * this.direction.x * (1 - 0.42 * lateralRatio);
      if (!isAttacker || lateralRatio > 0.35) {
        desiredX =
          side > 0 ? Math.max(0.088, desiredX) : Math.min(-0.088, desiredX);
      }
      let local = v(
        desiredX,
        wantContact ? 0.092 : Math.max(0.105, 0.095 + clipLift),
        along * this.direction.y,
      );
      let target = this.floorPoint(local.clone());
      let groundedContact = wantContact;

      if (airborne) {
        const tuck = dunk
          ? Math.sin(unit(p.finishElapsedSec / 0.84) * Math.PI) *
            (1 - smoothMotion((r - 0.3) / 0.4))
          : jump
            ? Math.sin(unit(p.defenseElapsedSec / 0.88) * Math.PI)
            : shot
              ? 0.22 * Math.sin(unit(p.finishElapsedSec / 0.72) * Math.PI * 0.85)
              : 0.15;
        const airFlair =
          dunk && p.finishElapsedSec >= 0.22 && r < 0.28
            ? smoothMotion((p.finishElapsedSec - 0.22) / 0.2)
            : 0;
        const airWidth = dunk
          ? p.dunkStyle === "windmill"
            ? side * (0.16 + 0.05 * airFlair * tuck)
            : p.dunkStyle === "360"
              ? side * (0.16 - 0.03 * airFlair * tuck)
              : side * 0.16
          : side * (shot ? 0.145 : 0.16);
        const airLift = dunk
          ? p.dunkStyle === "tomahawk"
            ? (side > 0 ? 0.39 : 0.34) * tuck
            : (side > 0 ? 0.35 : 0.25) * tuck
          : (side > 0 ? 0.35 : 0.25) * tuck;
        const airSweepZ = dunk
          ? p.dunkStyle === "tomahawk"
            ? -0.31 * tuck * (0.65 + 0.35 * airFlair)
            : p.dunkStyle === "windmill"
              ? (side > 0 ? -0.31 : 0.23) * tuck
              : (side > 0 ? -0.27 : 0.19) * tuck
          : shot
            ? (side > 0 ? 0.12 : 0.05) * (p.lastTrick === "stepback" ? 1.4 : 1) * tuck
            : (side > 0 ? -0.27 : 0.19) * tuck;
        local = v(airWidth, airY + 0.095 + airLift, airSweepZ);
        target = this.floorPoint(local.clone());
        if (dunk && p.finishElapsedSec < 0.22) {
          // Carry the running feet into a short two-foot gather. Keep the soles
          // on court during the crouch, then lift with the player's push-off.
          const planted = this.floorPoint(v(side * 0.16, 0.095, side * 0.06));
          const gather = state.gather?.clone() ?? planted.clone();
          gather.lerp(planted, smoothMotion(p.finishElapsedSec / 0.14));
          target.copy(gather);
          const lift = this.floorPoint(local);
          target.lerp(lift, smoothMotion((p.finishElapsedSec - 0.12) / 0.1));
          target.y = Math.max(0.095, target.y);
        } else if ((shot || jump) && state.gather) {
          const elapsedAir = shot ? p.finishElapsedSec : p.defenseElapsedSec;
          if (elapsedAir < 0.1) {
            target
              .copy(state.gather)
              .lerp(this.floorPoint(local), smoothMotion(elapsedAir / 0.1));
          }
        }
        state.plant = state.start = state.end = null;
        state.contact = false;
        groundedContact = false;
      } else if (!options.inPlace) {
        if (step <= 0 && state.current) {
          target.copy(state.current);
          groundedContact = state.contact;
        } else {
          const sprintFactor = THREE.MathUtils.smoothstep(speed, 4.5, 8.5);
          const allowFlightPhase = speed > 4.6 || Boolean(p.streetMove);
          const anchorWorld = this.floorPoint(v(width, 0.092, 0));
          if (!state.last) {
            if (wantContact) {
              state.plant = v(target.x, 0.092, target.z);
              state.contact = true;
              state.plantHoldSec = 0;
              target.copy(state.plant);
            } else {
              state.contact = false;
            }
          } else if (state.contact && state.plant) {
            state.plantHoldSec += step;
            const plantDist = Math.hypot(
              state.plant.x - anchorWorld.x,
              state.plant.z - anchorWorld.z,
            );
            const plantBodyLocal = this.body.worldToLocal(state.plant.clone());
            const otherSwinging = !otherState.contact && !allowFlightPhase;
            const normalReach = THREE.MathUtils.lerp(
              isAttacker ? 0.31 : 0.35,
              0.19,
              sprintFactor,
            );
            const maxHoldReach = otherSwinging
              ? isAttacker
                ? 0.39
                : 0.44
              : normalReach;
            const overStretched = plantDist > maxHoldReach;
            const crossedMidline =
              (speed > 0.2 || Boolean(p.streetMove)) &&
              side * plantBodyLocal.x < (otherSwinging ? 0.068 : 0.085);
            const minPlantHold = THREE.MathUtils.lerp(0.095, 0.04, sprintFactor);
            const gaitRelease =
              !wantContact &&
              state.plantHoldSec >= minPlantHold &&
              (speed > 0.25 || Boolean(p.streetMove)) &&
              !otherSwinging;
            const idleSettle =
              speed <= 0.2 &&
              !p.streetMove &&
              plantDist > 0.18 &&
              !otherSwinging;

            if (
              step > 0 &&
              (overStretched || crossedMidline || gaitRelease || idleSettle)
            ) {
              state.contact = false;
              state.start = state.plant.clone();
              state.plant = null;
              state.plantHoldSec = 0;
              state.swingElapsed = step;
              state.swingDuration = THREE.MathUtils.lerp(
                THREE.MathUtils.clamp(
                  0.21 / Math.max(0.95, cadence * 0.65),
                  0.15,
                  0.21,
                ),
                0.23,
                sprintFactor,
              );
            } else {
              target.copy(state.plant);
              target.y = 0.092;
            }
          }

          if (!state.contact && state.last) {
            if (!state.start) state.start = state.last.clone();
            if (step > 0 && state.plant === null && wasContact === false) {
              state.swingElapsed += step;
            }
            const duration = state.swingDuration || 0.18;
            const uSwing = unit(state.swingElapsed / duration);
            const sprintLead = THREE.MathUtils.lerp(0.24, 0.15, sprintFactor);
            const leadAlong =
              speed > 0.35 || p.streetMove
                ? Math.max(
                    along * (1 - 0.35 * sprintFactor),
                    Math.min(sprintLead, p.streetMove ? 0.16 : speed * 0.04),
                  )
                : 0;
            let goalX =
              width + leadAlong * this.direction.x * (1 - 0.42 * lateralRatio);
            if (!isAttacker || lateralRatio > 0.35) {
              goalX =
                side > 0 ? Math.max(0.09, goalX) : Math.min(-0.09, goalX);
            }
            const goalWorld = this.floorPoint(
              v(goalX, 0.092, leadAlong * this.direction.y),
            );
            if (step > 0 && uSwing >= 1) {
              state.contact = true;
              state.plant = v(goalWorld.x, 0.092, goalWorld.z);
              state.plantHoldSec = 0;
              state.start = null;
              state.swingElapsed = 0;
              target.copy(state.plant);
            } else {
              const s = 0.7 * uSwing + 0.3 * smoothMotion(uSwing);
              target.x = THREE.MathUtils.lerp(state.start.x, goalWorld.x, s);
              target.z = THREE.MathUtils.lerp(state.start.z, goalWorld.z, s);
              if (!isAttacker || lateralRatio > 0.35) {
                const swingLocal = this.body.parent!.worldToLocal(target.clone());
                swingLocal.applyAxisAngle(Y, -this.body.rotation.y);
                swingLocal.x =
                  side > 0
                    ? Math.max(0.082, swingLocal.x)
                    : Math.min(-0.082, swingLocal.x);
                const uncrossed = this.floorPoint(swingLocal);
                target.x = uncrossed.x;
                target.z = uncrossed.z;
              }
              const arcHeight =
                Math.sin(Math.PI * Math.min(0.92, Math.max(0.08, uSwing))) *
                (0.105 + 0.065 * run);
              target.y = Math.max(0.092 + arcHeight, local.y);
            }
            if (step > 0 && state.current) {
              const stepVec = target.clone().sub(state.current);
              const maxFootDelta = Math.min(0.255, (speed + 5.6) * step);
              if (stepVec.length() > maxFootDelta) {
                target
                  .copy(state.current)
                  .addScaledVector(stepVec.normalize(), maxFootDelta);
                if (state.contact && state.plant) {
                  state.plant.x = target.x;
                  state.plant.z = target.z;
                }
              }
            }
          }
          state.current = (state.current ?? new THREE.Vector3()).copy(target);
          groundedContact = state.contact;
        }
      } else {
        state.plant = state.start = state.end = null;
        state.contact = wantContact;
        groundedContact = wantContact;
      }

      const toe = airborne
        ? -0.12 *
          (dunk
            ? smoothMotion((p.finishElapsedSec - 0.12) / 0.1) *
              (r >= 0.3 ? smoothMotion(Math.max(0, airY) / 0.12) : 1)
            : 1)
        : groundedContact
          ? 0
          : -0.06 * Math.sin(Math.PI * swing) * moving;
      const minSoleClearanceY =
        0.092 + Math.max(0, 0.255 * Math.sin(toe), -0.09 * Math.sin(toe));
      target.y = Math.max(groundedContact && !airborne ? 0.092 : minSoleClearanceY, target.y);

      this.solve(
        `thigh_${suffix}`,
        `calf_${suffix}`,
        `foot_${suffix}`,
        target,
        this.floorPoint(v(side * 0.18, airY + 0.52, 0.8)),
      );
      const foot = this.bone(`foot_${suffix}`);
      const flatFrame = this.body
        .parent!.getWorldQuaternion(new THREE.Quaternion())
        .multiply(
          new THREE.Quaternion().setFromAxisAngle(Y, this.body.rotation.y),
        );
      const parent = foot.bone
        .parent!.getWorldQuaternion(new THREE.Quaternion())
        .invert();
      foot.bone.quaternion.copy(
        parent
          .multiply(flatFrame)
          .multiply(new THREE.Quaternion().setFromAxisAngle(v(1, 0, 0), toe))
          .multiply(foot.rotation),
      );
      foot.bone.updateWorldMatrix(true, false);
      state.last = foot.bone.getWorldPosition(
        state.last ?? new THREE.Vector3(),
      );
      if (
        step > 0 &&
        !airborne &&
        groundedContact &&
        !wasContact &&
        speed > 0.7 &&
        !options.inPlace &&
        !p.streetMove &&
        state.soundCooldown === 0
      ) {
        this.contacts.push(Math.min(1, speed / 6));
        state.soundCooldown = 0.16;
      }
    }
    this.body.updateWorldMatrix(true, true);
    let right = v(0.33, 1.03, 0.29),
      left = v(-0.29, 1.13, -stride * 0.25 * moving);
    let leftGrip = 0,
      rightGrip = 0;
    if (this.animator.available && isAttacker && !airborne) {
      left.lerp(authoredHands[0], 0.35 + 0.55 * moving);
      right.lerp(authoredHands[1], 0.35 + 0.55 * moving);
      left.x = Math.min(-0.24, left.x);
      right.x = Math.max(0.24, right.x);
    }
    if (!isAttacker) {
      if (p.wrongFootSec > 0) {
        const wobble = Math.sin(p.wrongFootSec * 14) * 0.08;
        right.set(0.54, 1.18 + wobble, 0.24);
        left.set(-0.54, 1.18 - wobble, 0.24);
      } else if (missedSwipeFrozen > 0) {
        right.set(0.26, 0.98, 0.52 * missedSwipeFrozen + 0.2);
        left.set(-0.38, 1.08, 0.05);
      } else {
        const slideSpread = 0.05 * lateralRatio;
        right.set(0.46 + slideSpread, 1.26, 0.31);
        left.set(-0.46 - slideSpread, 1.26, 0.31);
      }
    } else {
      if (ball && !dunk && !shot) {
        const tripleThreatHold =
          p.animState !== "dribble" && !p.streetMove && speed < 0.25;
        if (tripleThreatHold) {
          const center = v(ball.x, ball.y, ball.z);
          const space = this.body.parent!.parent;
          if (space) space.localToWorld(center);
          this.body.worldToLocal(center);
          // Two-hand athletic triple-threat pocket: primary hand cups back/side, guide hand cradles inner side.
          right.set(center.x + 0.082, center.y + 0.032, center.z - 0.025);
          left.set(center.x - 0.112, center.y + 0.018, center.z + 0.015);
          rightGrip = 0.72;
          leftGrip = 0.56;
        } else {
          const bouncePhase = unit((ball.y - 0.24) / 0.65);
          const worldPocketY =
            (p.streetMove ? 0.76 : 0.82) + smoothMotion(bouncePhase) * 0.16;
          const point = v(ball.x, worldPocketY, ball.z);
          const space = this.body.parent!.parent;
          if (space) space.localToWorld(point);
          this.body.worldToLocal(point);
          point.y = Math.max(p.streetMove ? 0.78 : 0.84, point.y);
          const pocketContact = THREE.MathUtils.lerp(
            0.24,
            0.68,
            smoothMotion(bouncePhase),
          );
          const handBlend = THREE.MathUtils.smoothstep(point.x, -0.09, 0.09);
          const guardRight = v(0.3, 1.09, 0.2 + stride * 0.14 * moving);
          const guardLeft = v(-0.3, 1.09, 0.2 - stride * 0.14 * moving);
          const carryRight = v(Math.max(-0.06, point.x), point.y, point.z);
          const carryLeft = v(Math.min(0.06, point.x), point.y, point.z);
          right.copy(guardRight).lerp(carryRight, handBlend);
          left.copy(guardLeft).lerp(carryLeft, 1 - handBlend);
          rightGrip = pocketContact * handBlend;
          leftGrip = pocketContact * (1 - handBlend);
        }
        this.lastBallY = ball.y;
      }
    }
    let contact = 0;
    let leftBlockGrip = 0;
    let rightBlockGrip = 0;
    if (dunk) {
      const rig = dunkRig(p),
        release = 1 - smoothMotion((r - 0.34) / 0.6);
      const actionRight = this.canonicalPoint(
        v(rig.hand.x, rig.hand.y, rig.hand.z),
        airY,
        p.facingAngle + rig.twist,
      );
      if (ball && r < 0.3) {
        const point = v(ball.x, ball.y, ball.z),
          space = this.body.parent!.parent;
        if (space) space.localToWorld(point);
        actionRight.copy(this.body.worldToLocal(point));
      }
      const actionLeft = this.canonicalPoint(
        v(
          -0.28,
          1.53 - 0.57 * Math.cos(rig.guideArm),
          -0.57 * Math.sin(rig.guideArm),
        ),
        airY,
        p.facingAngle + rig.twist,
      );
      if (
        ball &&
        r < 0 &&
        p.finishElapsedSec < 0.26 &&
        (p.dunkStyle === "tomahawk" || p.dunkStyle === "windmill")
      ) {
        const twoHandGather = 1 - smoothMotion((p.finishElapsedSec - 0.08) / 0.16);
        actionLeft.lerp(
          v(actionRight.x - 0.14, actionRight.y - 0.02, actionRight.z + 0.02),
          twoHandGather,
        );
      }
      right.lerp(actionRight, release);
      left.lerp(actionLeft, release);
      contact = 1 - smoothMotion((r - 0.3) / 0.2);
    } else if (shot) {
      const raise = smoothMotion(p.finishElapsedSec / 0.2),
        releaseSnap = smoothMotion((p.finishElapsedSec - 0.26) / 0.2),
        releaseBlend = smoothMotion((p.finishElapsedSec - 0.21) / 0.09),
        lower = r >= 0 ? 1 - smoothMotion((r - 0.18) / 0.45) : 1;
      const followRight = v(
        0.16,
        2.06 + releaseSnap * 0.09,
        0.25 + releaseSnap * 0.06,
      );
      const followLeft = v(
        -0.14 - releaseSnap * 0.05,
        1.98 - releaseSnap * 0.04,
        0.22,
      );
      if (ball && r < 0 && releaseBlend < 0.999) {
        const ballLocal = v(ball.x, ball.y, ball.z);
        const space = this.body.parent!.parent;
        if (space) space.localToWorld(ballLocal);
        this.body.worldToLocal(ballLocal);
        const gatherRight = ballLocal.clone();
        const gatherLeft = v(
          ballLocal.x - 0.12,
          ballLocal.y + 0.01,
          ballLocal.z + 0.02,
        );
        right.lerp(gatherRight.lerp(followRight, releaseBlend), lower);
        left.lerp(gatherLeft.lerp(followLeft, releaseBlend), lower);
      } else {
        right.lerp(followRight, raise * lower);
        left.lerp(followLeft, raise * lower);
      }
      rightGrip = (0.78 * (1 - releaseSnap * 0.35)) * lower;
      leftGrip = 0.45 * (1 - releaseSnap * 0.65) * lower;
    } else if (jump) {
      const jumpArc = Math.sin(unit(p.defenseElapsedSec / 0.88) * Math.PI);
      right.lerp(v(0.28, 2.06, 0.18), jumpArc);
      left.lerp(v(-0.28, 2.04, 0.18), jumpArc);
      if (ball) {
        const point = v(ball.x, ball.y, ball.z);
        const space = this.body.parent!.parent;
        if (space) space.localToWorld(point);
        this.body.worldToLocal(point);
        const contestY = THREE.MathUtils.clamp(point.y, 1.45, 2.36);
        const contestZ = THREE.MathUtils.clamp(point.z, -0.1, 0.52);
        const rightWeight = THREE.MathUtils.smoothstep(point.x, -0.18, 0.14);
        const leftWeight = 1 - THREE.MathUtils.smoothstep(point.x, -0.14, 0.18);
        const reachAmt = jumpArc ** 2;
        right.lerp(
          v(THREE.MathUtils.clamp(point.x, -0.04, 0.48), contestY, contestZ),
          reachAmt * rightWeight,
        );
        left.lerp(
          v(THREE.MathUtils.clamp(point.x, -0.48, 0.04), contestY, contestZ),
          reachAmt * leftWeight,
        );
        rightBlockGrip = reachAmt * rightWeight;
        leftBlockGrip = reachAmt * leftWeight;
      }
    } else if (p.defenseAction === "swipe") {
      right.set(0.43 - swipe * 0.3, 1.1, 0.22 + swipe * 0.4);
      left.set(-0.33, 1.12, -0.08);
    }
    const targets = [left, right];
    for (let i = 0; i < 2; i++) {
      // Finish contact is exact after gathering; other targets follow a short settling spring.
      const effStep = jump && step > 0 ? Math.max(step, 1 / 90) : step;
      const base = 1 - Math.exp(-effStep * (jump ? 16 : 22));
      const alpha =
        step <= 0
          ? 0
          : dunk && r < 0.3
            ? Math.max(base, smoothMotion(p.finishElapsedSec / 0.18))
            : shot && r < 0
              ? Math.max(base, smoothMotion(p.finishElapsedSec / 0.1))
              : base;
      this.hands[i].lerp(targets[i], alpha);
    }
    const armPole = (side: number, handPos: THREE.Vector3) => {
      const high = THREE.MathUtils.smoothstep(handPos.y, 1.3, 1.9);
      return v(
        side * THREE.MathUtils.lerp(0.6, 0.52, high),
        THREE.MathUtils.lerp(1.2, 1.52, high),
        THREE.MathUtils.lerp(-0.2, 0.38, high),
      );
    };
    this.hand(
      -1,
      this.hands[0],
      armPole(-1, this.hands[0]),
      jump
        ? leftBlockGrip
        : dunk && p.dunkStyle !== "windmill"
          ? contact
          : leftGrip,
    );
    this.hand(
      1,
      this.hands[1],
      armPole(1, this.hands[1]),
      jump ? rightBlockGrip : dunk ? contact : rightGrip,
    );
    this.body.updateWorldMatrix(true, true);
  }
}
