import * as THREE from "three";
import type { PlayerSimState } from "../../../shared/rules/matchStateMachine";
import { STREET_MOVES } from "../../../shared/rules/streetMoves";
import { clone } from "three/addons/utils/SkeletonUtils.js";

/** Clip playback owns the performance; IK adds ball contact and planted feet. */
export class BasketballAnimator {
  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private weights = new Map<string, number>();
  public active = "court_idle";
  public readonly available: boolean;
  public floorHeight: [number, number] = [0, 0];
  private heights: Record<string, [number, number]>;
  private pose: THREE.Object3D;
  private bones: Array<{ live: THREE.Bone; pose: THREE.Bone }> = [];

  constructor(model: THREE.Object3D, clips: THREE.AnimationClip[]) {
    // An isolated pose buffer keeps contact IK from mutating the mixer's cached
    // properties. Identical/paused frames can therefore be replayed exactly.
    this.pose = clone(model);
    model.traverse((o) => {
      if (o instanceof THREE.Bone)
        this.bones.push({
          live: o,
          pose: this.pose.getObjectByName(o.name) as THREE.Bone,
        });
    });
    this.mixer = new THREE.AnimationMixer(this.pose);
    this.available = clips.some((c) => c.name === "court_jog");
    this.heights = model.userData.animationLibrary?.footHeights ?? {};
    for (const clip of clips) {
      if (!clip.name.startsWith("court_")) continue;
      const action = this.mixer.clipAction(clip).play();
      action.paused = true;
      this.actions.set(clip.name, action);
      this.weights.set(clip.name, 0);
    }
  }

  public update(
    p: PlayerSimState,
    attacker: boolean,
    dt: number,
    cycle: number,
  ): void {
    if (!this.available) return;
    const speed = Math.hypot(p.vx, p.vz);
    const desired = new Map<string, number>();
    const idle = attacker ? "court_idle" : "court_defend";
    let time: number | null = null;
    if (p.finishKind === "dunk") {
      if (p.finishResolutionSec >= 0.3) {
        this.active = p.finishResolutionSec < 1.15 ? "court_land" : idle;
        time = Math.min(1, Math.max(0, (p.finishResolutionSec - 0.3) / 0.85));
      } else {
        this.active = "court_dunk_" + p.dunkStyle;
        time = Math.min(1, p.finishElapsedSec / 0.84);
      }
    } else if (p.finishKind === "jump") {
      this.active =
        p.finishResolutionSec > 0.3
          ? "court_land"
          : p.finishElapsedSec < 0.32
            ? "court_gather"
            : "court_air";
      time =
        p.finishResolutionSec > 0.3
          ? Math.min(1, (p.finishResolutionSec - 0.3) / 0.7)
          : Math.min(1, p.finishElapsedSec / 0.32);
    } else if (p.defenseAction === "jump") {
      this.active = "court_block";
      time = Math.min(1, p.defenseElapsedSec / 0.88);
    } else if (p.defenseAction === "swipe" && p.defenseElapsedSec < 0.4) {
      this.active = "court_swipe";
      time = p.defenseElapsedSec / 0.4;
    } else if (p.streetMove) {
      this.active =
        p.streetMove === "stepback"
          ? "court_eurostep"
          : "court_" + p.streetMove;
      time = p.moveElapsedSec / STREET_MOVES[p.streetMove].duration;
    } else {
      const moving = THREE.MathUtils.smoothstep(speed, 0.15, 1.7);
      const run = THREE.MathUtils.smoothstep(speed, 1.8, 3.8);
      const sprint = THREE.MathUtils.smoothstep(speed, 4.0, 6.1);
      desired.set(idle, 1 - moving);
      desired.set("court_walk", moving * (1 - run));
      desired.set("court_jog", moving * run * (1 - sprint));
      desired.set("court_sprint", moving * run * sprint);
      this.active =
        speed < 0.3
          ? idle
          : speed < 2.2
            ? "court_walk"
            : speed < 4.6
              ? "court_jog"
              : "court_sprint";
    }
    if (!desired.size) desired.set(this.active, 1);
    let total = 0;
    const initial = [...this.weights.values()].every((w) => w === 0);
    for (const [name] of this.actions) {
      const previous = this.weights.get(name)!;
      const next = initial
        ? (desired.get(name) ?? 0)
        : THREE.MathUtils.damp(previous, desired.get(name) ?? 0, 18, dt);
      this.weights.set(name, next);
      total += next;
    }
    this.floorHeight = [0, 0];
    for (const [name, action] of this.actions) {
      const weight = (this.weights.get(name) ?? 0) / Math.max(total, 1e-8);
      action.enabled = true;
      action.weight = weight;
      const special = desired.has(name) && time !== null;
      const phase = special
        ? THREE.MathUtils.clamp(time!, 0, 1)
        : ((cycle % 1) + 1) % 1;
      action.time = Math.min(
        action.getClip().duration - 1e-6,
        phase * action.getClip().duration,
      );
      const floor = this.heights[name];
      if (floor)
        for (let i = 0; i < 2; i++) this.floorHeight[i] += floor[i] * weight;
    }
    this.mixer.update(0);
    for (const { live, pose } of this.bones) {
      live.quaternion.copy(pose.quaternion);
      live.position.copy(pose.position);
    }
  }

  public snapshot() {
    return {
      active: this.active,
      clips: this.actions.size,
      weights: [...this.weights]
        .filter(([, w]) => w > 0.025)
        .map(([clip, weight]) => ({ clip, weight: +weight.toFixed(3) })),
    };
  }

  public dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }
}
