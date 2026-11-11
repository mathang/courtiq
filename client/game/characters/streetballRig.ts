import * as THREE from "three";
import type { PlayerSimState } from "../../../shared/rules/matchStateMachine";
import { dunkRig } from "../../../shared/rules/dunks";
import { STREET_MOVES } from "../../../shared/rules/streetMoves";
import { smoothMotion, unit } from "../../../shared/rules/motionCurves";

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
  private settled = false;
  private wasDunk = false;
  private direction = new THREE.Vector2(0, 1);
  private hands = [v(-0.31, 1.08, 0.1), v(0.31, 1.02, 0.28)];
  private feet = [-1, 1].map(() => ({
    contact: false,
    plant: null as THREE.Vector3 | null,
    start: null as THREE.Vector3 | null,
    end: null as THREE.Vector3 | null,
    last: null as THREE.Vector3 | null,
    gather: null as THREE.Vector3 | null,
  }));
  public resetMotion(): void {
    this.settled = false;
    this.lastBallY = null;
    this.movement = 0;
    this.wasDunk = false;
    this.feet.forEach((f) => {
      f.contact = false;
      f.plant = f.start = f.end = null;
      f.last = f.gather = null;
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
  ) {
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
      Math.abs(l1 - l2) + 0.001,
      l1 + l2 - 0.001,
    );
    const along = (l1 * l1 - l2 * l2 + distance * distance) / (2 * distance);
    const height = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    const bend = pole
      .clone()
      .sub(origin)
      .addScaledVector(line, -pole.clone().sub(origin).dot(line))
      .normalize();
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
    const stride = Math.sin(this.phase),
      moving = this.movement;
    const dunk = p.finishKind === "dunk",
      shot = p.finishKind === "jump",
      jump = p.defenseAction === "jump";
    if (dunk && !this.wasDunk)
      this.feet.forEach((f) => { f.gather = f.last?.clone() ?? null; });
    this.wasDunk = dunk;
    const r = p.finishResolutionSec;
    const airborne = (dunk && r < 0.78) || shot || jump;
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
    const crouch = isAttacker ? 0.075 : 0.145;
    const offsetTarget = airborne
      ? 0
      : -crouch -
        run * 0.025 -
        moving * 0.014 * Math.cos(this.phase * 2) -
        trick * 0.06 -
        landing * 0.1;
    const yaw = this.body.rotation.y;
    const localX =
      speed > 0.1 ? (Math.cos(yaw) * p.vx - Math.sin(yaw) * p.vz) / speed : 0;
    const localZ =
      speed > 0.1 ? (Math.sin(yaw) * p.vx + Math.cos(yaw) * p.vz) / speed : 1;
    const dirAlpha = 1 - Math.exp(-step * 13);
    if (speed > 0.1)
      this.direction
        .lerp(new THREE.Vector2(localX, localZ), dirAlpha)
        .normalize();
    let lean =
      (airborne ? 0 : 0.025 + run * 0.09 * Math.max(0, localZ)) + swipe * 0.22;
    let roll =
      -localX * moving * 0.045 -
      trick *
        p.moveSide *
        0.1 *
        (p.streetMove === "eurostep" ? Math.cos(moveU * Math.PI) : 1);
    if (p.wrongFootSec > 0) roll += Math.sin(p.wrongFootSec * 12) * 0.1;
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
    if (p.streetMove === "spin")
      this.body.rotation.y += p.moveSide * smoothMotion(moveU) * Math.PI * 2;
    if (dunk) this.body.rotation.y += dunkRig(p).twist;
    // A small shoulder/hip counter-rotation accompanies the stride.
    const chest = this.bone("spine_03").bone;
    chest.rotateY(stride * 0.035 * moving * (airborne ? 0 : 1));
    this.bone("Head").bone.rotateX(-this.pitch * 0.45);
    this.body.updateWorldMatrix(true, true);

    const stance = THREE.MathUtils.lerp(0.6, 0.34, run);
    const reach =
      THREE.MathUtils.clamp(
        (speed / Math.max(1, cadence)) * stance * 0.5,
        0.14,
        0.44,
      ) * moving;
    for (const [i, side] of [-1, 1].entries()) {
      const suffix = side > 0 ? "l" : "r",
        state = this.feet[i];
      const u =
        (((this.phase / (Math.PI * 2) + (side > 0 ? 0.5 : 0)) % 1) + 1) % 1;
      const contact = u < stance,
        swing = unit((u - stance) / (1 - stance));
      const along = contact
        ? THREE.MathUtils.lerp(reach, -reach, u / stance)
        : THREE.MathUtils.lerp(-reach, reach, smoothMotion(swing));
      const width =
        side * THREE.MathUtils.lerp(isAttacker ? 0.155 : 0.23, 0.145, run);
      let local = v(
        width + along * this.direction.x,
        0.092 + Math.sin(Math.PI * swing) ** 2 * (0.11 + 0.1 * run) * moving,
        along * this.direction.y,
      );
      let target = this.floorPoint(local.clone());
      if (airborne) {
        const tuck = dunk
          ? Math.sin(unit(p.finishElapsedSec / 0.84) * Math.PI) *
            (1 - smoothMotion((r - 0.3) / 0.4))
          : jump
            ? Math.sin(unit(p.defenseElapsedSec / 0.88) * Math.PI)
            : 0.15;
        local = v(
          side * 0.16,
          airY + 0.095 + (side > 0 ? 0.35 : 0.25) * tuck,
          (side > 0 ? -0.27 : 0.19) * tuck,
        );
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
        }
        state.plant = state.start = state.end = null;
        state.contact = false;
      } else if (moving > 0.15 && !options.inPlace && !p.streetMove) {
        if (contact) {
          if (!state.contact || !state.plant) state.plant = target.clone();
          target.copy(state.plant);
          state.start = target.clone();
          state.end = null;
        } else {
          if (!state.start) state.start = target.clone();
          if (!state.end) {
            state.end = this.floorPoint(
              v(
                width + reach * this.direction.x,
                0.092,
                reach * this.direction.y,
              ),
            );
            const remaining = (1 - u) / Math.max(1, cadence);
            const root = this.body.parent!,
              space = root.parent;
            const velocity = v(p.vx, 0, p.vz);
            if (space)
              velocity
                .transformDirection(space.matrixWorld)
                .multiplyScalar(speed);
            state.end.addScaledVector(velocity, remaining);
          }
          target.copy(state.start).lerp(state.end, smoothMotion(swing));
          target.y +=
            Math.sin(Math.PI * swing) ** 2 * (0.11 + 0.1 * run) * moving;
        }
        state.contact = contact;
      } else {
        state.plant = state.start = state.end = null;
        state.contact = false;
      }
      this.solve(
        `thigh_${suffix}`,
        `calf_${suffix}`,
        `foot_${suffix}`,
        target,
        this.floorPoint(v(side * 0.18, airY + 0.52, 0.8)),
      );
      const foot = this.bone(`foot_${suffix}`),
        frame = this.body.getWorldQuaternion(new THREE.Quaternion());
      const flatFrame = this.body
        .parent!.getWorldQuaternion(new THREE.Quaternion())
        .multiply(
          new THREE.Quaternion().setFromAxisAngle(Y, this.body.rotation.y),
        );
      const parent = foot.bone
        .parent!.getWorldQuaternion(new THREE.Quaternion())
        .invert();
      const toe = airborne
        ? -0.12 * (dunk ? smoothMotion((p.finishElapsedSec - 0.12) / 0.1) : 1)
        : contact
          ? -0.23 * smoothMotion(unit((u / stance - 0.65) / 0.35)) * moving
          : 0.2 * Math.sin(Math.PI * swing) * moving;
      foot.bone.quaternion.copy(
        parent
          .multiply(flatFrame)
          .multiply(new THREE.Quaternion().setFromAxisAngle(v(1, 0, 0), toe))
          .multiply(foot.rotation),
      );
      foot.bone.updateWorldMatrix(true, false);
      state.last = foot.bone.getWorldPosition(state.last ?? new THREE.Vector3());
    }
    this.body.updateWorldMatrix(true, true);
    let right = v(0.33, 1.03, 0.29),
      left = v(-0.29, 1.13, -stride * 0.25 * moving);
    if (!isAttacker) {
      right.set(0.46, 1.26, 0.31);
      left.set(-0.46, 1.26, 0.31);
    } else {
      if (ball && !dunk && !shot) {
        const vertical =
          this.lastBallY === null || step <= 0
            ? 0
            : THREE.MathUtils.clamp((ball.y - this.lastBallY) / step, -5, 5);
        const point = v(
          ball.x,
          Math.max(1.025, ball.y + 0.115) + vertical * 0.007,
          ball.z,
        );
        const space = this.body.parent!.parent;
        if (space) space.localToWorld(point);
        this.body.worldToLocal(point);
        if (point.x < -0.035) {
          left.copy(point);
          right.set(0.29, 1.13, stride * 0.25 * moving);
        } else right.copy(point);
        this.lastBallY = ball.y;
      }
    }
    let contact = 0;
    let blockHand = 0;
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
      right.lerp(actionRight, release);
      left.lerp(actionLeft, release);
      contact = 1 - smoothMotion((r - 0.3) / 0.2);
    } else if (shot) {
      const raise = smoothMotion(p.finishElapsedSec / 0.25),
        lower = r >= 0 ? 1 - smoothMotion((r - 0.2) / 0.55) : 1;
      right.lerp(v(0.19, 2.02, 0.24), raise * lower);
      left.lerp(v(-0.16, 1.97, 0.22), raise * lower);
    } else if (jump) {
      right.set(0.29, 2.08, 0.14);
      left.set(-0.29, 2.04, 0.14);
      if (ball) {
        const point = v(ball.x, ball.y, ball.z);
        const space = this.body.parent!.parent;
        if (space) space.localToWorld(point);
        this.body.worldToLocal(point);
        blockHand = point.x < 0 ? -1 : 1;
        // Reach with the nearer hand as the jump rises, then settle on landing.
        const reach = Math.sin(unit(p.defenseElapsedSec / 0.88) * Math.PI) ** 2;
        (blockHand < 0 ? left : right).lerp(point, reach);
      }
    } else if (p.defenseAction === "swipe") {
      right.set(0.43 - swipe * 0.3, 1.1, 0.22 + swipe * 0.4);
      left.set(-0.33, 1.12, -0.08);
    }
    const targets = [left, right];
    for (let i = 0; i < 2; i++) {
      // Finish contact is exact after gathering; other targets follow a short settling spring.
      const base = 1 - Math.exp(-step * (jump ? 30 : 22));
      const alpha =
        dunk && r < 0.3
          ? Math.max(base, smoothMotion(p.finishElapsedSec / 0.18))
          : base;
      this.hands[i].lerp(targets[i], alpha);
    }
    this.hand(
      -1,
      this.hands[0],
      v(-0.6, 1.2, -0.2),
      blockHand < 0 ? 1 : dunk && p.dunkStyle !== "windmill" ? contact : 0,
    );
    this.hand(1, this.hands[1], v(0.6, 1.2, -0.2), blockHand > 0 ? 1 : contact);
    this.body.updateWorldMatrix(true, true);
  }
}
