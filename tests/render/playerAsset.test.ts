import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { StreetballRig } from "../../client/game/characters/streetballRig";
import { AuthoritativeMatchEngine } from "../../shared/rules/matchStateMachine";
import { BUNDLED_QUESTION_PACKS } from "../../content/packRegistry";
import {
  DUNK_STYLES,
  dunkBallPosition,
  dunkReboundPosition,
} from "../../shared/rules/dunks";
import { dribbleBallPosition } from "../../shared/rules/dribble";
import { getAirPose } from "../../shared/rules/streetMoves";

for (const assetFile of ['streetball-player.glb', 'athlete-sky.glb']) {
const bytes = readFileSync(
  new URL("../../public/assets/player/" + assetFile, import.meta.url),
);
const asset = await new GLTFLoader().parseAsync(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  "",
);
function actor() {
  const root = new THREE.Group(),
    body = new THREE.Group(),
    model = clone(asset.scene);
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
function player() {
  return new AuthoritativeMatchEngine({
    matchId: "asset-check",
    mode: "solo",
    seed: 1,
    pack: BUNDLED_QUESTION_PACKS[0],
    roomPresetId: "standard",
    sessionLengthId: "quick",
    player0: { id: "a", pseudonym: "CLARK" },
    player1: { id: "b", pseudonym: "BOT", isAi: true },
  }).players[0];
}
describe("shipped streetball player: " + assetFile, () => {
  it("ships editable skeletal clips and uses independent blended playback with contact IK", () => {
    expect(asset.animations).toHaveLength(17);
    for (const name of [
      "court_idle",
      "court_walk",
      "court_jog",
      "court_sprint",
      "court_crossover",
      "court_eurostep",
      "court_spin",
      "court_land",
      "court_block",
      "court_swipe",
      ...DUNK_STYLES.map((s) => "court_dunk_" + s),
    ])
      expect(asset.animations.some((c) => c.name === name)).toBe(true);
    for (const clip of asset.animations)
      for (const track of clip.tracks)
        expect([...track.values].every(Number.isFinite)).toBe(true);
    const a = actor(),
      b = actor(),
      p = player();
    p.x = p.z = p.facingAngle = 0;
    p.vz = 6;
    for (let i = 0; i < 60; i++) {
      a.body.position.set(0, 0, 0);
      a.body.rotation.set(0, 0, 0);
      a.rig.update(p, true, 1 / 60);
    }
    expect(a.rig.animationState().active).toBe("court_sprint");
    expect(b.rig.animationState().active).toBe("court_idle");
    p.vz = 0;
    for (let i = 0; i < 30; i++) {
      a.body.position.set(0, 0, 0);
      a.body.rotation.set(0, 0, 0);
      a.rig.update(p, true, 1 / 60);
    }
    expect(a.rig.animationState().active).toBe("court_idle");
  });
  it("has a complete, finite skinned asset inside the browser budget", () => {
    let bones = 0,
      meshes = 0,
      triangles = 0;
    asset.scene.traverse((o) => {
      if (o instanceof THREE.Bone) bones++;
      if (!(o instanceof THREE.SkinnedMesh)) return;
      meshes++;
      triangles += o.geometry.index!.count / 3;
      expect(o.geometry.attributes.position.count).toBe(
        o.geometry.attributes.skinWeight.count,
      );
      if (o.name === "Body_Jersey") {
        expect(o.geometry.attributes.uv?.count).toBe(
          o.geometry.attributes.position.count,
        );
      }
      const weights = o.geometry.attributes.skinWeight;
      for (let i = 0; i < weights.count; i++)
        expect(
          weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i),
        ).toBeCloseTo(1, 4);
      expect(
        Array.from(o.geometry.attributes.position.array).every(Number.isFinite),
      ).toBe(true);
    });
    expect(bones).toBe(65);
    expect(meshes).toBeLessThanOrEqual(12);
    expect(triangles).toBeLessThan(40000);
    expect(bytes.byteLength).toBeLessThan(2_000_000);
  });
  it("shares garment boundaries with the body through bent poses", () => {
    const a = actor(),
      seams = new Map<
        string,
        Array<{ mesh: THREE.SkinnedMesh; index: number }>
      >();
    a.model.traverse((o) => {
      if (
        !(o instanceof THREE.SkinnedMesh) ||
        o.userData.surface !== "continuous-body"
      )
        return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const key = [pos.getX(i), pos.getY(i), pos.getZ(i)]
          .map((n) => n.toFixed(5))
          .join(",");
        if (!seams.has(key)) seams.set(key, []);
        seams.get(key)!.push({ mesh: o, index: i });
      }
    });
    const shared = [...seams.values()].filter(
      (v) => new Set(v.map((p) => p.mesh.name)).size > 1,
    );
    expect(shared.length).toBeGreaterThan(100);
    expect(a.model.getObjectByName("Player_JerseyPrint")).toBeUndefined();
    for (const t of [0.18, 0.4, 0.65, 0.84]) {
      const p = player();
      p.finishKind = "dunk";
      p.finishElapsedSec = t;
      p.dunkStyle = "windmill";
      a.body.position.set(0, 0, 0);
      a.body.rotation.set(0, 0, 0);
      a.rig.update(p, true, 1 / 60);
      a.root.updateMatrixWorld(true);
      for (const points of shared) {
        const base = points[0].mesh.getVertexPosition(
          points[0].index,
          new THREE.Vector3(),
        );
        for (const point of points.slice(1))
          expect(
            point.mesh
              .getVertexPosition(point.index, new THREE.Vector3())
              .distanceTo(base),
          ).toBeLessThan(0.0015);
      }
    }
  });
  it("gives opponents independent skeletons", () => {
    const a = actor(),
      b = actor();
    const p = player();
    p.finishKind = "dunk";
    p.finishElapsedSec = 0.42;
    const before = b.model.getObjectByName("upperarm_l")!.quaternion.clone();
    a.rig.update(p, true, 1 / 60);
    expect(
      b.model.getObjectByName("upperarm_l")!.quaternion.equals(before),
    ).toBe(true);
    expect(a.model.getObjectByName("upperarm_l")).not.toBe(
      b.model.getObjectByName("upperarm_l"),
    );
  });
  it("keeps the dunking palm on the ball through every style and turn", () => {
    for (const style of DUNK_STYLES)
      for (const elapsed of [0.18, 0.3, 0.45, 0.62, 0.84]) {
        const a = actor(),
          p = player();
        p.x = 1.2;
        p.z = -3.4;
        p.facingAngle = 0.91;
        p.finishKind = "dunk";
        p.finishElapsedSec = elapsed;
        p.finishResolutionSec = -1;
        p.dunkStyle = style;
        p.dunkBallStart = null;
        const pose = getAirPose(p);
        a.root.position.set(pose.x, 0, pose.z);
        a.body.position.y = pose.y;
        a.body.rotation.y = p.facingAngle;
        a.rig.update(p, true, 1 / 60);
        const ball = dunkBallPosition(p, pose);
        expect(
          a.rig.palm.distanceTo(new THREE.Vector3(ball.x, ball.y, ball.z)),
          `${style} at ${elapsed}`,
        ).toBeLessThan(0.15);
      }
  });
  it("plants both feet in the idle and defensive stance", () => {
    for (const isAttacker of [true, false]) {
      const a = actor(),
        p = player();
      p.vx = p.vz = 0;
      a.rig.update(p, isAttacker, 1 / 60);
      a.root.updateMatrixWorld(true);
      for (const name of ["foot_l", "foot_r"]) {
        const y = a.model
          .getObjectByName(name)!
          .getWorldPosition(new THREE.Vector3()).y;
        expect(y).toBeGreaterThan(0.065);
        expect(y).toBeLessThan(0.115);
      }
    }
  });
  it("cradles the basketball with both hands in the idle triple-threat pocket", () => {
    const a = actor(),
      p = player();
    p.x = 0;
    p.z = 2.6;
    p.facingAngle = Math.PI;
    p.vx = p.vz = 0;
    p.animState = "idle";
    const ball = dribbleBallPosition(p, 0);
    a.root.position.set(p.x, 0, p.z);
    for (let i = 0; i < 45; i++) {
      a.body.position.set(0, 0, 0);
      a.body.rotation.set(0, p.facingAngle, 0);
      a.rig.update(p, true, 1 / 60, ball);
    }
    a.root.updateMatrixWorld(true);
    const ballCenter = new THREE.Vector3(ball.x, ball.y, ball.z);
    for (const handName of ["hand_l", "hand_r"]) {
      const wrist = a.model
        .getObjectByName(handName)!
        .getWorldPosition(new THREE.Vector3());
      expect(wrist.distanceTo(ballCenter)).toBeLessThan(0.24);
    }
  });
  it("holds the emitted hand pose when presentation time is paused", () => {
    const a = actor(),
      p = player();
    p.facingAngle = 0;
    p.x = p.z = 0;
    p.vz = 3.2;
    function update(dt: number) {
      a.body.position.set(0, 0, 0);
      a.body.rotation.set(0, 0, 0);
      a.rig.update(
        p,
        true,
        dt,
        { x: 0.34, y: 0.85, z: 0.28 },
        { inPlace: true },
      );
    }
    for (let i = 0; i < 30; i++) update(1 / 60);
    const before = a.rig.palm.clone();
    for (let i = 0; i < 30; i++) update(0);
    expect(a.rig.palm.distanceTo(before)).toBeLessThan(1e-7);
  });
  it("freezes hand settling when paused in the middle of a dunk gather", () => {
    for (const style of DUNK_STYLES) {
      const a = actor(),
        p = player();
      p.x = p.z = p.facingAngle = 0;
      p.finishKind = "dunk";
      p.dunkStyle = style;
      p.finishElapsedSec = 0.15;
      p.finishResolutionSec = -1;
      const air = getAirPose(p),
        ball = dunkBallPosition(p, air);
      const update = (dt: number) => {
        a.root.position.set(air.x, 0, air.z);
        a.body.position.set(0, air.y, 0);
        a.body.rotation.set(0, 0, 0);
        a.rig.update(p, true, dt, ball, { inPlace: true });
      };
      update(1 / 60);
      const before = a.rig.palm.clone();
      for (let i = 0; i < 30; i++) update(0);
      expect(a.rig.palm.distanceTo(before)).toBeLessThan(1e-7);
    }
  });
  it("emits footstep contacts without replaying a sound every frame of a cut", () => {
    const a = actor(),
      p = player();
    p.x = p.z = p.facingAngle = 0;
    p.vz = 5;
    let steps = 0;
    for (let i = 0; i < 120; i++) {
      p.z += p.vz / 60;
      p.streetMove = i >= 30 && i < 51 ? "crossover" : null;
      p.moveElapsedSec = (i - 30) / 60;
      a.root.position.set(0, 0, p.z);
      a.body.position.set(0, 0, 0);
      a.body.rotation.set(0, 0, 0);
      a.rig.update(p, true, 1 / 60);
      const emitted = a.rig.consumeFootContacts();
      if (p.streetMove) expect(emitted).toHaveLength(0);
      steps += emitted.length;
    }
    expect(steps).toBeGreaterThan(3);
    expect(steps).toBeLessThan(18);
  });
  it("keeps a support foot planted while the player travels", () => {
    const a = actor(),
      p = player();
    p.facingAngle = 0;
    p.x = p.z = 0;
    p.vz = 3.2;
    let grounded = 0;
    const previous = new Map<string, THREE.Vector3>();
    for (let i = 0; i < 120; i++) {
      p.z += p.vz / 60;
      a.root.position.set(0, 0, p.z);
      a.body.position.set(0, 0, 0);
      a.body.rotation.set(0, 0, 0);
      a.rig.update(p, true, 1 / 60);
      a.root.updateMatrixWorld(true);
      for (const name of ["foot_l", "foot_r"]) {
        const now = a.model
            .getObjectByName(name)!
            .getWorldPosition(new THREE.Vector3()),
          old = previous.get(name);
        if (
          old &&
          Math.abs(now.y - 0.092) < 0.004 &&
          now.distanceTo(old) < 0.002
        )
          grounded++;
        previous.set(name, now);
      }
    }
    expect(grounded).toBeGreaterThan(25);
  });
  it("settles the arms continuously from a run into a dunk and back to defence", () => {
    const a = actor(),
      p = player();
    p.x = 0;
    p.z = 0.2;
    p.facingAngle = Math.PI;
    p.animState = "dribble";
    let previous: THREE.Vector3 | null = null,
      maxStep = 0;
    for (let i = 0; i < 270; i++) {
      const t = i / 60;
      p.vz = t < 1.0 ? -3.2 : 0;
      if (t < 1.0) p.z += p.vz / 60;
      if (t >= 1 && t < 3.8) {
        p.finishKind = "dunk";
        p.finishElapsedSec = Math.min(0.84, t - 1);
        p.finishResolutionSec = t > 2.2 ? t - 2.2 : -1;
      } else if (t >= 3.8 && p.finishKind) {
        const landed = getAirPose(p);
        p.x = landed.x;
        p.z = landed.z;
        p.finishKind = null;
      }
      const air = getAirPose(p);
      a.root.position.set(air.x, 0, air.z);
      a.body.position.set(0, air.y, 0);
      a.body.rotation.set(0, p.facingAngle, 0);
      a.rig.update(p, t < 3.8, 1 / 60);
      const point = a.rig.palm.clone();
      if (previous) maxStep = Math.max(maxStep, point.distanceTo(previous));
      previous = point;
    }
    expect(maxStep).toBeLessThan(0.3);
  });
  it("carries the sprinting feet into the gather without snapping or sinking through court", () => {
    for (const runFrames of [30, 36, 42, 48, 54, 60]) {
      const a = actor(),
        p = player();
      p.x = 1.8;
      p.z = 0.5;
      p.facingAngle = Math.PI;
      p.vz = -4.2;
      const update = () => {
        const air = getAirPose(p);
        a.root.position.set(air.x, 0, air.z);
        a.body.position.set(0, air.y, 0);
        a.body.rotation.set(0, p.facingAngle, 0);
        a.rig.update(p, true, 1 / 60);
        a.root.updateMatrixWorld(true);
      };
      for (let i = 0; i < runFrames; i++) {
        p.z += p.vz / 60;
        update();
      }
      const before = ["foot_l", "foot_r"].map((n) =>
        a.model.getObjectByName(n)!.getWorldPosition(new THREE.Vector3()),
      );
      p.finishKind = "dunk";
      p.vz = 0;
      for (let i = 0; i < 14; i++) {
        p.finishElapsedSec = i / 60;
        update();
        if (i === 0)
          ["foot_l", "foot_r"].forEach((n, j) => {
            expect(
              a.model
                .getObjectByName(n)!
                .getWorldPosition(new THREE.Vector3())
                .distanceTo(before[j]),
            ).toBeLessThan(0.08);
          });
        a.model.traverse((o) => {
          if (!(o instanceof THREE.SkinnedMesh) || !o.name.includes("Shoe"))
            return;
          o.skeleton.update();
          let minimum = Infinity;
          for (let j = 0; j < o.geometry.attributes.position.count; j++)
            minimum = Math.min(
              minimum,
              o.localToWorld(o.getVertexPosition(j, new THREE.Vector3())).y,
            );
          expect(
            minimum,
            `${runFrames} frame run, gather ${i}`,
          ).toBeGreaterThan(-0.003);
        });
      }
    }
  });
  it("keeps misses and swats clear of the descending head from either lane", () => {
    for (const style of DUNK_STYLES)
      for (const facing of [-2.36, -0.7, 0.7, 2.36]) {
        const a = actor(),
          p = player();
        p.x = 1.9;
        p.z = -3.3;
        p.facingAngle = facing;
        p.finishKind = "dunk";
        p.dunkStyle = style;
        p.finishElapsedSec = 2;
        const skin = a.model.getObjectByName("Body_Skin") as THREE.SkinnedMesh;
        const attr = skin.geometry.attributes,
          indices = skin.geometry.index!;
        const headTriangles: number[][] = [];
        const isHead = (i: number) => {
          let weight = 0;
          for (let j = 0; j < 4; j++)
            if (
              ["Head", "neck_01"].includes(
                skin.skeleton.bones[attr.skinIndex.getComponent(i, j)].name,
              )
            )
              weight += attr.skinWeight.getComponent(i, j);
          return weight > 0.5;
        };
        for (let i = 0; i < indices.count; i += 3) {
          const ids = [
            indices.getX(i),
            indices.getX(i + 1),
            indices.getX(i + 2),
          ];
          if (ids.every(isHead)) headTriangles.push(ids);
        }
        for (const outcome of ["miss", "block"] as const)
          for (const r of [0.35, 0.4, 0.45, 0.5, 0.55, 0.65, 0.75]) {
            p.finishResolutionSec = r;
            const air = getAirPose(p);
            a.root.position.set(air.x, 0, air.z);
            a.body.position.set(0, air.y, 0);
            a.body.rotation.set(0, facing, 0);
            a.rig.update(p, true, 1 / 60);
            a.root.updateMatrixWorld(true);
            skin.skeleton.update();
            const b = dunkReboundPosition(p, air, outcome),
              center = new THREE.Vector3(b.x, b.y, b.z);
            for (const ids of headTriangles) {
              const triangle = new THREE.Triangle(
                ...(ids.map((i) =>
                  skin.localToWorld(
                    skin.getVertexPosition(i, new THREE.Vector3()),
                  ),
                ) as [THREE.Vector3, THREE.Vector3, THREE.Vector3]),
              );
              expect(
                triangle
                  .closestPointToPoint(center, new THREE.Vector3())
                  .distanceTo(center),
              ).toBeGreaterThan(0.145);
            }
          }
      }
  });
});

}
