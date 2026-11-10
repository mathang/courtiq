import * as THREE from "three";
import type { PlayerSimState } from "../../../shared/rules/matchStateMachine";
import { dunkRig } from "../../../shared/rules/dunks";
import { STREET_MOVES } from "../../../shared/rules/streetMoves";

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
    return this.body.localToWorld(point);
  }
  private hand(
    side: number,
    target: THREE.Vector3,
    pole: THREE.Vector3,
    ballContact = false,
  ): void {
    const suffix = side > 0 ? "l" : "r";
    const world = this.point(target);
    if (ballContact) {
      const shoulder = this.bone(`upperarm_${suffix}`).bone.getWorldPosition(
        new THREE.Vector3(),
      );
      // Put the palm on the near surface, rather than inside the basketball.
      world.addScaledVector(world.clone().sub(shoulder).normalize(), -0.075);
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
          ref.bone.rotateZ((side > 0 ? -1 : 1) * (ballContact ? 0.24 : 0.1));
      }
  }
  public update(
    p: PlayerSimState,
    isAttacker: boolean,
    dt: number,
    ball?: { x: number; y: number; z: number },
  ): void {
    for (const ref of this.refs.values()) ref.bone.quaternion.copy(ref.local);
    const speed = Math.hypot(p.vx, p.vz);
    this.movement = THREE.MathUtils.damp(
      this.movement,
      Math.min(1, speed / 2),
      14,
      dt,
    );
    this.phase += dt * (speed > 0.1 ? speed * 4.6 : 1.8);
    const stride = Math.sin(this.phase),
      moving = this.movement;
    const air = p.finishKind || p.defenseAction === "jump";
    const crouch = air ? 0 : isAttacker ? 0.085 : 0.14;
    this.body.position.y -= crouch;
    if (!air)
      this.body.position.y += Math.abs(Math.cos(this.phase)) * 0.018 * moving;
    const yaw = p.facingAngle;
    const forward =
      speed > 0.1 ? (Math.sin(yaw) * p.vx + Math.cos(yaw) * p.vz) / speed : 1;
    const sideways =
      speed > 0.1 ? (Math.cos(yaw) * p.vx - Math.sin(yaw) * p.vz) / speed : 0;
    if (!air) {
      this.body.rotation.x = 0.035 + moving * 0.045 * Math.max(0, forward);
      this.body.rotation.z = -sideways * moving * 0.045;
    }
    if (p.streetMove) {
      const u = THREE.MathUtils.clamp(
        p.moveElapsedSec / STREET_MOVES[p.streetMove].duration,
        0,
        1,
      );
      if (p.streetMove === "spin")
        this.body.rotation.y += p.moveSide * u * Math.PI * 2;
      this.body.position.y -= Math.sin(u * Math.PI) * 0.07;
      this.body.rotation.z +=
        Math.sin(u * Math.PI * (p.streetMove === "eurostep" ? 2 : 1)) *
        -p.moveSide *
        0.12;
    }
    if (p.wrongFootSec > 0)
      this.body.rotation.z += Math.sin(p.wrongFootSec * 12) * 0.13;
    if (p.finishKind === "dunk") this.body.rotation.y += dunkRig(p).twist;
    this.body.updateWorldMatrix(true, true);

    for (const side of [-1, 1]) {
      const suffix = side > 0 ? "l" : "r",
        cycle = this.phase + (side < 0 ? Math.PI : 0);
      let x =
        side * (isAttacker ? 0.15 : 0.235) +
        Math.sin(cycle) * sideways * 0.29 * moving;
      let z = Math.sin(cycle) * forward * 0.37 * moving;
      let y = 0.091 + crouch + Math.max(0, Math.cos(cycle)) * 0.23 * moving;
      if (p.finishKind === "dunk") {
        const t = Math.sin(Math.min(1, p.finishElapsedSec / 0.84) * Math.PI);
        x = side * 0.16;
        z = (side > 0 ? -0.38 : 0.33) * t;
        y = 0.1 + (side > 0 ? 0.46 : 0.32) * t;
      } else if (p.defenseAction === "jump") {
        y =
          0.1 +
          0.2 * Math.sin(Math.min(1, p.defenseElapsedSec / 0.88) * Math.PI);
        z = side * 0.12;
      } else if (p.finishKind === "jump") {
        x = side * 0.15;
        z = 0;
        y = 0.1;
      }
      const target = this.point(v(x, y, z));
      this.solve(
        `thigh_${suffix}`,
        `calf_${suffix}`,
        `foot_${suffix}`,
        target,
        this.point(v(side * 0.19, 0.55, 0.8)),
      );
      // Keep soles facing the floor rather than inheriting the calf's rotation.
      const foot = this.bone(`foot_${suffix}`),
        frame = this.body.getWorldQuaternion(new THREE.Quaternion());
      const parent = foot.bone
        .parent!.getWorldQuaternion(new THREE.Quaternion())
        .invert();
      const tip = air ? -0.22 : Math.max(0, Math.cos(cycle)) * 0.22 * moving;
      foot.bone.quaternion.copy(
        parent
          .multiply(frame)
          .multiply(new THREE.Quaternion().setFromAxisAngle(v(1, 0, 0), tip))
          .multiply(foot.rotation),
      );
    }
    this.body.updateWorldMatrix(true, true);
    const right = v(0.31, 1.02, 0.26),
      left = v(-0.31, 1.1, -stride * 0.19 * moving);
    let contact = false;
    if (!isAttacker) {
      right.set(0.48, 1.23, 0.31);
      left.set(-0.48, 1.23, 0.31);
    } else {
      // Follow the authoritative bounce at the top; do not chase the ball to the floor.
      const bounce = ball
        ? THREE.MathUtils.clamp((ball.y - 0.24) / 0.65, 0, 1)
        : 0.5 + 0.5 * Math.sin(this.phase * 1.4);
      right.y = 0.93 + bounce * 0.1;
      if (p.streetMove === "crossover" || p.streetMove === "eurostep") {
        const u = p.moveElapsedSec / STREET_MOVES[p.streetMove].duration;
        right.x = 0.34 * Math.cos(u * Math.PI) * p.moveSide;
      }
      contact = !!ball && ball.y > 0.75;
    }
    if (p.finishKind === "dunk") {
      const rig = dunkRig(p);
      right.set(rig.hand.x, rig.hand.y, rig.hand.z);
      left.set(
        -0.28,
        1.53 - 0.58 * Math.cos(rig.guideArm),
        -0.58 * Math.sin(rig.guideArm),
      );
      contact = true;
    } else if (p.finishKind === "jump") {
      const t = Math.min(1, p.finishElapsedSec / 0.24);
      right.set(0.19, 1.1 + t * 0.94, 0.25);
      left.set(-0.16, 1.1 + t * 0.91, 0.24);
    } else if (p.defenseAction === "jump") {
      right.set(0.29, 2.08, 0.13);
      left.set(-0.29, 2.04, 0.14);
    } else if (p.defenseAction === "swipe") {
      const reach = Math.sin(Math.min(1, p.defenseElapsedSec / 0.32) * Math.PI);
      right.set(0.43 - reach * 0.31, 1.07, 0.2 + reach * 0.43);
      left.set(-0.34, 1.04, -0.12);
    } else if (p.defenseRecoverySec > 0) {
      right.set(0.22, 0.99, 0.42);
      left.set(-0.37, 1.06, -0.09);
    }
    this.hand(-1, left, v(-0.64, 1.22, -0.24));
    this.hand(1, right, v(0.64, 1.22, -0.24), contact);
    this.body.updateWorldMatrix(true, true);
  }
}
