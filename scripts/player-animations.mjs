/** Retarget Quaternius CC0 locomotion; author CourtIQ basketball accents.
 * Source and licence: assets/source/README.md. All animation stays in place.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import fs from "node:fs/promises";

const map = {
  pelvis: "DEF-hips",
  spine_01: "DEF-spine.001",
  spine_02: "DEF-spine.002",
  spine_03: "DEF-spine.003",
  neck_01: "DEF-neck",
  Head: "DEF-head",
};
for (const [side, suffix] of [
  ["L", "l"],
  ["R", "r"],
]) {
  Object.assign(map, {
    [`clavicle_${suffix}`]: `DEF-shoulder.${side}`,
    [`upperarm_${suffix}`]: `DEF-upper_arm.${side}`,
    [`lowerarm_${suffix}`]: `DEF-forearm.${side}`,
    [`hand_${suffix}`]: `DEF-hand.${side}`,
    [`thigh_${suffix}`]: `DEF-thigh.${side}`,
    [`calf_${suffix}`]: `DEF-shin.${side}`,
    [`foot_${suffix}`]: `DEF-foot.${side}`,
    [`ball_${suffix}`]: `DEF-toe.${side}`,
  });
}
const specs = [
  ["court_idle", "Idle_Loop"],
  ["court_walk", "Walk_Loop"],
  ["court_jog", "Jog_Fwd_Loop"],
  ["court_sprint", "Sprint_Loop"],
  ["court_defend", "Crouch_Idle_Loop"],
  ["court_gather", "Jump_Start"],
  ["court_air", "Jump_Loop"],
  ["court_land", "Jump_Land"],
  ["court_crossover", "Jog_Fwd_Loop", 0.34, "cross"],
  ["court_eurostep", "Jog_Fwd_Loop", 0.56, "euro"],
  ["court_spin", "Jog_Fwd_Loop", 0.48, "spin"],
  ["court_swipe", "Crouch_Idle_Loop", 0.4, "swipe"],
  ["court_block", "Jump_Start", 0.88, "block"],
  ...["tomahawk", "windmill", "360", "reverse"].map((s) => [
    `court_dunk_${s}`,
    "Jump_Start",
    0.84,
    s,
  ]),
];
const q = () => new THREE.Quaternion();
const smooth = (x) => {
  const t = THREE.MathUtils.clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

export async function createBasketballAnimations(target) {
  globalThis.ProgressEvent ??= class {
    constructor(type, values) {
      this.type = type;
      Object.assign(this, values);
    }
  };
  const json = JSON.parse(
    await fs.readFile(
      "assets/source/AnimationLibrary_Godot_Standard.gltf",
      "utf8",
    ),
  );
  const bin = await fs.readFile(
    "assets/source/AnimationLibrary_Godot_Standard.bin",
  );
  json.buffers[0].uri =
    "data:application/octet-stream;base64," + bin.toString("base64");
  const source = await new GLTFLoader().parseAsync(JSON.stringify(json), "");
  const mixer = new THREE.AnimationMixer(source.scene);
  mixer.clipAction(source.animations.find((c) => c.name === "A_TPose")).play();
  mixer.update(0);
  source.scene.updateMatrixWorld(true);
  target.updateMatrixWorld(true);
  const refs = [];
  target.traverse((b) => {
    const s =
      map[b.name] &&
      source.scene.getObjectByName(
        THREE.PropertyBinding.sanitizeNodeName(map[b.name]),
      );
    if (!b.isBone || !s) return;
    refs.push({
      b,
      s,
      local: b.quaternion.clone(),
      pos: b.position.clone(),
      target: b.getWorldQuaternion(q()),
      source: s.getWorldQuaternion(q()).invert(),
    });
  });
  if (refs.length < 20) throw Error("Animation rig mapping is incomplete");
  const sourceHip = source.scene.getObjectByName("DEF-hips");
  const hipRest = sourceHip.getWorldPosition(new THREE.Vector3()).y;
  const footHeights = {};
  const clips = [];
  for (const [name, base, durationOverride, accent] of specs) {
    mixer.stopAllAction();
    const src = source.animations.find((c) => c.name === base);
    if (!src) throw Error("Missing source clip " + base);
    const action = mixer.clipAction(src);
    action.reset().play();
    const duration = durationOverride ?? src.duration;
    const count = Math.ceil(duration * 30),
      times = [],
      values = new Map();
    const hipValues = [],
      minima = [Infinity, Infinity];
    for (const ref of refs) values.set(ref.b.name, []);
    for (let i = 0; i <= count; i++) {
      const t = (duration * i) / count,
        u = i / count;
      times.push(t);
      // Cut motions use a full stride; jump accents use the authored launch.
      action.time = Math.min(src.duration - 1e-6, u * src.duration);
      mixer.update(0);
      source.scene.updateMatrixWorld(true);
      for (const ref of refs) {
        ref.b.quaternion.copy(ref.local);
        ref.b.position.copy(ref.pos);
      }
      target.updateMatrixWorld(true);
      const push = Math.sin(Math.PI * u);
      for (const ref of refs) {
        const delta = ref.s.getWorldQuaternion(q()).multiply(ref.source);
        const world = delta.multiply(ref.target);
        if (
          accent &&
          ["spine_01", "spine_02", "spine_03", "neck_01"].includes(ref.b.name)
        ) {
          const factor =
            ref.b.name === "spine_03"
              ? 1
              : ref.b.name === "neck_01"
                ? -0.22
                : 0.35;
          let pitch = 0,
            yaw = 0,
            roll = 0;
          if (accent === "cross") {
            yaw = 0.12 * push;
            roll = -0.09 * Math.sin(2 * Math.PI * u);
          } else if (accent === "euro") {
            roll = -0.12 * Math.sin(2 * Math.PI * u);
            pitch = 0.045 * push;
          } else if (accent === "spin") {
            yaw = -0.13 * push;
            pitch = 0.055 * push;
          } else if (accent === "swipe") {
            yaw = -0.12 * push;
            pitch = 0.1 * push;
          } else if (accent === "block") {
            pitch = -0.035 * push;
          } else {
            pitch = -0.065 * push;
            yaw = (accent === "windmill" ? -0.11 : 0.055) * push;
            roll = (accent === "reverse" ? 0.045 : -0.025) * push;
          }
          world.premultiply(
            q().setFromEuler(
              new THREE.Euler(
                pitch * factor,
                yaw * factor,
                roll * factor,
                "YXZ",
              ),
            ),
          );
        }
        ref.b.quaternion.copy(
          ref.b.parent.getWorldQuaternion(q()).invert().multiply(world),
        );
        ref.b.updateWorldMatrix(false, true);
        const data = values.get(ref.b.name),
          result = ref.b.quaternion;
        // Keep adjacent quaternion signs consistent for portable interpolation.
        if (
          data.length &&
          result.x * data.at(-4) +
            result.y * data.at(-3) +
            result.z * data.at(-2) +
            result.w * data.at(-1) <
            0
        )
          result.set(-result.x, -result.y, -result.z, -result.w);
        data.push(...result.toArray());
      }
      const hip = refs.find((r) => r.b.name === "pelvis");
      if (hip) {
        hip.b.position.y =
          hip.pos.y +
          THREE.MathUtils.clamp(
            sourceHip.getWorldPosition(new THREE.Vector3()).y - hipRest,
            -0.07,
            0.07,
          );
        hipValues.push(...hip.b.position.toArray());
      }
      target.updateMatrixWorld(true);
      for (const [j, n] of ["foot_l", "foot_r"].entries())
        minima[j] = Math.min(
          minima[j],
          target.getObjectByName(n).getWorldPosition(new THREE.Vector3()).y,
        );
    }
    const tracks = refs.map(
      (r) =>
        new THREE.QuaternionKeyframeTrack(
          r.b.name + ".quaternion",
          times,
          values.get(r.b.name),
        ),
    );
    if (hipValues.length)
      tracks.push(
        new THREE.VectorKeyframeTrack("pelvis.position", times, hipValues),
      );
    const clip = new THREE.AnimationClip(name, duration, tracks).optimize();
    clips.push(clip);
    footHeights[name] = minima;
  }
  mixer.stopAllAction();
  for (const ref of refs) {
    ref.b.quaternion.copy(ref.local);
    ref.b.position.copy(ref.pos);
  }
  target.updateMatrixWorld(true);
  target.userData.animationLibrary = {
    version: 1,
    author: "Quaternius CC0 locomotion + CourtIQ basketball accents",
    sourceCommit: "e24c23cf2a1323488a3faa226ea7ea21f644b73e",
    footHeights,
  };
  return clips;
}
