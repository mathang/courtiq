import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { StreetballRig } from "../../client/game/characters/streetballRig";
import { AuthoritativeMatchEngine } from "../../shared/rules/matchStateMachine";
import { BUNDLED_QUESTION_PACKS } from "../../content/packRegistry";
import { DUNK_STYLES, dunkBallPosition } from "../../shared/rules/dunks";
import { getAirPose } from "../../shared/rules/streetMoves";

const bytes = readFileSync(
  new URL("../../public/assets/player/streetball-player.glb", import.meta.url),
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
  return { root, body, model, rig: new StreetballRig(model, body) };
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
describe("shipped streetball player", () => {
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
      if (o.name === "Player_JerseyPrint") {
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
    expect(meshes).toBeLessThanOrEqual(10);
    expect(triangles).toBeLessThan(40000);
    expect(bytes.byteLength).toBeLessThan(2_000_000);
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
});
