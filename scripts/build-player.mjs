/** Reproducible CourtIQ kit, sculpted over the CC0 Quaternius humanoid.
 * No DCC installation is required. All additions bind to the original armature.
 * Run: node scripts/build-player.mjs; see assets/source/README.md for provenance.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

// GLTFExporter uses the browser FileReader interface, also for texture-free GLBs.
globalThis.FileReader = class {
  async readAsArrayBuffer(blob) {
    this.result = await blob.arrayBuffer();
    this.onloadend?.();
  }
};
const bytes = await fs.readFile("assets/source/quaternius-superhero-male.glb");
const { scene } = await new GLTFLoader().parseAsync(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  "",
);
scene.updateMatrixWorld(true);
const body = scene.getObjectByName("SuperHero_Male");
const skeleton = body.skeleton;
const source = body.geometry;
const srcPos = source.attributes.position;
const srcJoints = source.attributes.skinIndex;
const srcWeights = source.attributes.skinWeight;
const parts = new Map();
const materials = new Map();
let defaultBone;
const mat = (name, color, roughness = 0.8) => {
  const m = new THREE.MeshStandardMaterial({ name, color, roughness });
  materials.set(name, m);
  return m;
};
mat("Skin", "#a96c47", 0.68);
mat("Jersey", "#ffbd2d", 0.92);
mat("KitNavy", "#101e38", 0.94);
mat("TeamAccent", "#f9ad23", 0.78);
mat("Ivory", "#f5f0e6", 0.72);
mat("Hair", "#211713", 0.96);
mat("Eyes", "#f5eee7", 0.4);
mat("Pupils", "#251d19", 0.5);
mat("Sole", "#d4cbbd", 0.84);
const print = mat("JerseyPrint", "#ffffff");
print.transparent = true;
print.opacity = 0;
print.depthWrite = false;

function weights(g, boneName) {
  boneName ??= defaultBone;
  const p = g.attributes.position,
    joints = [],
    ws = [];
  const mode = boneName?.startsWith("short_") ? boneName : null;
  const fixed =
    boneName && !mode
      ? skeleton.bones.findIndex((b) => b.name === boneName)
      : -1;
  for (let i = 0; i < p.count; i++) {
    let best = 0,
      dist = Infinity;
    if (mode) {
      const t = THREE.MathUtils.clamp((p.getY(i) - 0.82) / 0.15, 0, 1);
      joints.push(
        skeleton.bones.findIndex((b) => b.name === "pelvis"),
        skeleton.bones.findIndex((b) => b.name === "thigh_" + mode.slice(-1)),
        0,
        0,
      );
      ws.push(t, 1 - t, 0, 0);
      continue;
    }
    if (fixed < 0) {
      const x = p.getX(i),
        y = p.getY(i),
        z = p.getZ(i);
      for (let k = 0; k < srcPos.count; k++) {
        const d =
          (srcPos.getX(k) - x) ** 2 +
          (srcPos.getY(k) - y) ** 2 +
          (srcPos.getZ(k) - z) ** 2;
        if (d < dist) {
          dist = d;
          best = k;
        }
      }
    }
    for (let c = 0; c < 4; c++) {
      joints.push(
        fixed >= 0 ? (c === 0 ? fixed : 0) : srcJoints.array[best * 4 + c],
      );
      ws.push(fixed >= 0 ? (c === 0 ? 1 : 0) : srcWeights.array[best * 4 + c]);
    }
  }
  g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(joints, 4));
  g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(ws, 4));
  if (!g.attributes.uv)
    g.setAttribute(
      "uv",
      new THREE.Float32BufferAttribute(new Float32Array(p.count * 2), 2),
    );
  return g;
}
function add(g, material, bone) {
  // Export only the attributes used by this asset, allowing one draw per material.
  for (const key of Object.keys(g.attributes))
    if (!["position", "normal", "uv", "skinIndex", "skinWeight"].includes(key))
      g.deleteAttribute(key);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.skinIndex) weights(g, bone);
  else
    g.setAttribute(
      "skinIndex",
      new THREE.Uint16BufferAttribute(g.attributes.skinIndex.array, 4),
    );
  if (!parts.has(material)) parts.set(material, []);
  parts.get(material).push(g);
}
function loft(rings, material, bone, segments = 32, yOffset) {
  const pos = [],
    uv = [],
    indices = [];
  for (let r = 0; r < rings.length; r++) {
    const [y, rx, rz, cx = 0, cz = 0] = rings[r];
    for (let j = 0; j <= segments; j++) {
      const t = (j / segments) * Math.PI * 2;
      pos.push(
        cx + rx * Math.cos(t),
        y + (yOffset ? yOffset(t, r) : 0),
        cz + rz * Math.sin(t),
      );
      uv.push(j / segments, r / (rings.length - 1));
      if (r < rings.length - 1 && j < segments) {
        const a = r * (segments + 1) + j,
          b = a + 1,
          c = a + segments + 1;
        indices.push(a, c, b, b, c, c + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  add(g, material, bone);
  return g;
}
function ellipsoid(x, y, z, rx, ry, rz, material, bone, detail = 16) {
  const g = new THREE.SphereGeometry(
    1,
    detail,
    Math.min(12, Math.max(5, detail / 2)),
  );
  g.scale(rx, ry, rz);
  g.translate(x, y, z);
  add(g, material, bone);
}
function tube(points, radius, material, bone, closed = false) {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(...p)),
    closed,
  );
  const g = new THREE.TubeGeometry(curve, points.length * 2, radius, 5, closed);
  add(g, material, bone);
}
function oval(y, rx, rz, cx = 0, cz = 0) {
  return Array.from({ length: 32 }, (_, i) => [
    cx + Math.cos((i / 32) * Math.PI * 2) * rx,
    y,
    cz + Math.sin((i / 32) * Math.PI * 2) * rz,
  ]);
}

// Keep the continuous anatomical head, shoulders, arms, hands and lower legs.
// Remove skin hidden inside clothing to prevent z-fighting and save triangles.
for (const objName of ["SuperHero_Male", "Eyebrows", "Eyes"]) {
  const obj = scene.getObjectByName(objName),
    g = obj.geometry.clone();
  if (objName === "SuperHero_Male") {
    const kept = [];
    const ix = g.index;
    for (let i = 0; i < ix.count; i += 3) {
      const ids = [ix.getX(i), ix.getX(i + 1), ix.getX(i + 2)];
      const x = ids.reduce((v, k) => v + srcPos.getX(k), 0) / 3,
        y = ids.reduce((v, k) => v + srcPos.getY(k), 0) / 3,
        z = ids.reduce((v, k) => v + srcPos.getZ(k), 0) / 3;
      const hiddenTorso = y > 0.95 && y < 1.39 && Math.abs(x) < 0.24;
      const hiddenFeet = y < 0.13;
      if (!hiddenTorso && !hiddenFeet) kept.push(...ids);
    }
    g.setIndex(kept);
  }
  add(
    g,
    objName === "Eyes" ? "Eyes" : objName === "Eyebrows" ? "Hair" : "Skin",
  );
  obj.removeFromParent();
}
// A continuous front/back singlet, with true neck and arm openings.
defaultBone = "spine_03";
function shirtTop(x, side) {
  const a = Math.abs(x);
  if (a < 0.085)
    return (side > 0 ? 1.435 : 1.49) + (side > 0 ? 0.08 : 0.025) * (a / 0.085);
  if (a < 0.175) return 1.515;
  return 1.515 - ((a - 0.175) / 0.065) * 0.11;
}
function shirtDepth(x, y, side) {
  const v = THREE.MathUtils.clamp((y - 0.98) / 0.42, 0, 1),
    rx = 0.181 + 0.061 * v;
  const upper = THREE.MathUtils.clamp((y - 1.39) / 0.13, 0, 1);
  const depth =
    side > 0
      ? 0.146 + 0.013 * v - 0.043 * upper
      : 0.151 + 0.029 * v - 0.048 * upper + 0.08 * (x / 0.24) ** 2 * upper;
  return (
    -0.015 +
    side * (depth * Math.sqrt(Math.max(0.01, 1 - (x / rx) ** 2)) + 0.004)
  );
}
for (const side of [1, -1]) {
  const pos = [],
    uv = [],
    ix = [],
    nx = 48,
    ny = 24;
  for (let j = 0; j <= ny; j++)
    for (let i = 0; i <= nx; i++) {
      const u = -1 + (i / nx) * 2,
        v = j / ny,
        x = u * (0.178 + 0.062 * Math.sin((v * Math.PI) / 2)),
        y = 0.98 + v * (shirtTop(u * 0.24, side) - 0.98);
      pos.push(x, y, shirtDepth(x, y, side));
      uv.push(i / nx, v);
      if (i < nx && j < ny) {
        const a = j * (nx + 1) + i,
          b = a + 1,
          c = a + nx + 1;
        ix.push(
          ...(side > 0 ? [a, b, c, b, c + 1, c] : [a, c, b, b, c, c + 1]),
        );
      }
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(ix);
  g.computeVertexNormals();
  add(g, "Jersey");
  const edge = Array.from({ length: 49 }, (_, i) => {
    const x = -0.24 + (i / 48) * 0.48,
      y = shirtTop(x, side);
    return [x, y, shirtDepth(x, y, side)];
  });
  tube(edge, 0.007, "KitNavy");
}
// Shoulder bridges join the cloth panels, rather than floating separate straps.
for (const s of [-1, 1]) {
  const pos = [],
    uv = [],
    ix = [],
    rows = 12;
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i < 2; i++) {
      const x = s * (i === 0 ? 0.096 : 0.174),
        front = shirtDepth(x, 1.515, 1),
        back = shirtDepth(x, 1.515, -1);
      pos.push(
        x,
        1.515 + 0.007 * Math.sin((j / rows) * Math.PI),
        back + ((front - back) * j) / rows,
      );
      uv.push(i, j / rows);
      if (j < rows && i === 0) {
        const a = j * 2,
          b = a + 1,
          c = a + 2;
        ix.push(...(s > 0 ? [a, c, b, b, c, c + 1] : [a, b, c, b, c + 1, c]));
      }
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(ix);
  g.computeVertexNormals();
  add(g, "Jersey");
  for (const x of [0.096, 0.174]) {
    const f = shirtDepth(s * x, 1.515, 1),
      b = shirtDepth(s * x, 1.515, -1);
    tube(
      Array.from({ length: 13 }, (_, j) => [
        s * x,
        1.515 + 0.007 * Math.sin((j / 12) * Math.PI),
        b + ((f - b) * j) / 12,
      ]),
      0.005,
      "KitNavy",
    );
  }
}
// Close the torso sides beneath each armhole.
for (const side of [-1, 1]) {
  const pos = [],
    uv = [],
    ix = [];
  for (let j = 0; j <= 24; j++)
    for (let i = 0; i < 2; i++) {
      const v = j / 24,
        x = side * (0.178 + 0.062 * Math.sin((v * Math.PI) / 2)),
        y = 0.98 + v * (1.405 - 0.98);
      pos.push(x, y, shirtDepth(x, y, i === 0 ? 1 : -1));
      uv.push(i, v);
      if (j < 24 && i === 0) {
        const a = j * 2,
          b = a + 1,
          c = a + 2;
        ix.push(
          ...(side > 0 ? [a, b, c, b, c + 1, c] : [a, c, b, b, c, c + 1]),
        );
      }
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(ix);
  g.computeVertexNormals();
  add(g, "Jersey");
}
tube(oval(0.994, 0.181, 0.142, 0, -0.012), 0.008, "KitNavy", undefined, true);
for (const s of [-1, 1]) {
  tube(
    [
      [s * 0.18, 1.01, -0.005],
      [s * 0.202, 1.16, 0],
      [s * 0.237, 1.32, 0],
      [s * 0.244, 1.4, 0],
    ],
    0.009,
    "KitNavy",
  );
}
// Separate roomy shorts legs, with a knitted waistband and contrast hems.
defaultBone = "pelvis";
loft(
  [
    [0.93, 0.252, 0.153, 0, -0.018],
    [0.984, 0.225, 0.149, 0, -0.012],
    [1.01, 0.183, 0.142, 0, -0.012],
  ],
  "KitNavy",
);
for (const s of [-1, 1]) {
  defaultBone = s > 0 ? "short_l" : "short_r";
  const x = s * 0.113;
  loft(
    [
      [0.635, 0.134, 0.133, x, 0.006],
      [0.66, 0.14, 0.143, x, 0.001],
      [0.79, 0.145, 0.149, x, -0.009],
      [0.94, 0.14, 0.145, x, -0.018],
      [0.97, 0.13, 0.13, x, -0.016],
    ],
    "KitNavy",
    undefined,
    32,
  );
  tube(oval(0.655, 0.141, 0.145, x, 0), 0.007, "TeamAccent", undefined, true);
  tube(
    [
      [s * 0.251, 0.677, -0.015],
      [s * 0.259, 0.79, -0.021],
      [s * 0.246, 0.91, -0.025],
    ],
    0.015,
    "Jersey",
  );
  tube(
    [
      [s * 0.254, 0.677, 0.008],
      [s * 0.262, 0.79, 0.005],
      [s * 0.248, 0.91, 0.001],
    ],
    0.003,
    "Ivory",
  );
}
// Waist stitching and an actual two-part drawcord.
defaultBone = "pelvis";
tube(oval(0.984, 0.196, 0.145, 0, -0.012), 0.003, "Sole", undefined, true);
for (const s of [-1, 1])
  tube(
    [
      [s * 0.014, 0.989, 0.139],
      [s * 0.025, 0.966, 0.147],
      [s * 0.018, 0.929, 0.152],
    ],
    0.0025,
    "Ivory",
    "pelvis",
  );
// One compression knee sleeve, both ribbed crew socks.
defaultBone = undefined;
loft(
  [
    [0.34, 0.079, 0.081, 0.114, -0.037],
    [0.4, 0.089, 0.088, 0.114, -0.036],
    [0.53, 0.103, 0.101, 0.114, -0.035],
    [0.65, 0.113, 0.111, 0.114, -0.032],
  ],
  "KitNavy",
);
for (const s of [-1, 1]) {
  defaultBone = s > 0 ? "calf_l" : "calf_r";
  const x = s * 0.114;
  loft(
    [
      [0.11, 0.055, 0.066, x, -0.068],
      [0.18, 0.059, 0.068, x, -0.059],
      [0.28, 0.064, 0.068, x, -0.051],
    ],
    "Ivory",
  );
  for (const y of [0.257, 0.273])
    tube(oval(y, 0.065, 0.069, x, -0.052), 0.003, "KitNavy", undefined, true);
  // Trainers have an outsole, cushioned midsole, separate upper and heel tab.
  const bone = s > 0 ? "foot_l" : "foot_r";
  loft(
    [
      [0.007, 0.075, 0.165, x, 0.015],
      [0.018, 0.086, 0.177, x, 0.02],
      [0.04, 0.086, 0.172, x, 0.019],
      [0.052, 0.08, 0.165, x, 0.012],
    ],
    "Sole",
    bone,
  );
  loft(
    [
      [0.034, 0.085, 0.172, x, 0.02],
      [0.064, 0.087, 0.166, x, 0.014],
      [0.079, 0.079, 0.148, x, 0.002],
    ],
    "Ivory",
    bone,
  );
  ellipsoid(x, 0.09, 0.021, 0.078, 0.064, 0.15, "KitNavy", bone, 24);
  ellipsoid(x, 0.073, 0.108, 0.074, 0.041, 0.075, "Ivory", bone, 20);
  ellipsoid(x, 0.122, -0.086, 0.066, 0.071, 0.048, "KitNavy", bone);
  tube(
    [
      [x - 0.065, 0.106, -0.075],
      [x, 0.154, -0.113],
      [x + 0.065, 0.106, -0.075],
    ],
    0.008,
    "TeamAccent",
    bone,
  );
  // Forefoot laces and side chevrons are geometry, readable in the close-up.
  for (let k = 0; k < 4; k++)
    tube(
      [
        [x - 0.035, 0.137 - k * 0.006, -0.02 + k * 0.022],
        [x + 0.035, 0.137 - k * 0.006, -0.01 + k * 0.022],
      ],
      0.0035,
      "Ivory",
      bone,
    );
  tube(
    [
      [x + s * 0.075, 0.08, 0.08],
      [x + s * 0.081, 0.097, 0.02],
      [x + s * 0.071, 0.103, -0.03],
    ],
    0.006,
    "TeamAccent",
    bone,
  );
}
// Sculpted crop with small curls instead of the old sphere cap.
const hairCap = new THREE.SphereGeometry(
  1,
  32,
  16,
  0,
  Math.PI * 2,
  0,
  Math.PI * 0.53,
);
hairCap.scale(0.116, 0.095, 0.107);
hairCap.translate(0, 1.759, -0.009);
add(hairCap, "Hair", "Head");
for (let r = 0; r < 4; r++)
  for (let k = 0; k < 12; k++) {
    const theta = (k / 12) * Math.PI * 2 + (r % 2) * 0.2,
      a = ((r + 0.5) / 4) * 1.42;
    ellipsoid(
      0.109 * Math.sin(a) * Math.cos(theta),
      1.762 + 0.091 * Math.cos(a),
      -0.009 + 0.101 * Math.sin(a) * Math.sin(theta),
      0.018,
      0.016,
      0.018,
      "Hair",
      "Head",
      8,
    );
  }
loft(
  [
    [1.741, 0.113, 0.104, 0, -0.009],
    [1.765, 0.115, 0.107, 0, -0.009],
  ],
  "TeamAccent",
  "Head",
  48,
);
for (const s of [-1, 1]) {
  ellipsoid(s * 0.034, 1.699, 0.08, 0.013, 0.014, 0.008, "Pupils", "Head", 12);
  ellipsoid(s * 0.03, 1.704, 0.087, 0.003, 0.003, 0.002, "Ivory", "Head", 8);
}
// Jersey artwork patch follows the curved front/back and deforms with the chest.
defaultBone = "spine_03";
for (const side of [1, -1]) {
  const pos = [],
    uv = [],
    ix = [];
  const nx = 12,
    ny = 10;
  for (let j = 0; j <= ny; j++)
    for (let i = 0; i <= nx; i++) {
      const x = -0.132 + (i / nx) * 0.264,
        y = 1.095 + (j / ny) * 0.316;
      pos.push(x, y, shirtDepth(x, y, side) + side * 0.0035);
      uv.push(side > 0 ? (i / nx) * 0.5 : 1 - (i / nx) * 0.5, 1 - j / ny);
      if (i < nx && j < ny) {
        const a = j * (nx + 1) + i,
          b = a + 1,
          c = a + nx + 1;
        ix.push(
          ...(side > 0 ? [a, b, c, b, c + 1, c] : [a, c, b, b, c, c + 1]),
        );
      }
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(ix);
  g.computeVertexNormals();
  add(g, "JerseyPrint");
}
// Merge compatible clothing pieces: a small, stable material/draw-call budget.
for (const [name, geometries] of parts) {
  const g = mergeGeometries(geometries, false);
  if (!g) throw new Error("Merge failed: " + name);
  const m = new THREE.SkinnedMesh(g, materials.get(name));
  m.name = "Player_" + name;
  m.frustumCulled = false;
  scene.add(m);
  m.bind(skeleton, body.bindMatrix);
  m.normalizeSkinWeights();
  const js = g.attributes.skinIndex,
    ws = g.attributes.skinWeight;
  for (let i = 0; i < ws.count; i++)
    for (let c = 0; c < 4; c++)
      if (ws.array[i * 4 + c] === 0) js.array[i * 4 + c] = 0;
}
scene.name = "CourtIQ_Streetball_Player";
scene.userData = {
  author: "CourtIQ kit; Quaternius CC0 humanoid",
  units: "metres",
  forward: "+Z",
  up: "+Y",
  sourceSha256: createHash("sha256").update(bytes).digest("hex"),
};
// Scene roots avoid an extra object transform above skinned meshes in glTF.
const exportedScene = new THREE.Scene();
exportedScene.name = scene.name;
exportedScene.userData = scene.userData;
for (const child of [...scene.children]) exportedScene.add(child);
const glb = await new GLTFExporter().parseAsync(exportedScene, {
  binary: true,
  onlyVisible: true,
});
await fs.writeFile(
  "public/assets/player/streetball-player.glb",
  Buffer.from(glb),
);
const meshes = [];
exportedScene.traverse((o) => {
  if (o.isMesh)
    meshes.push({ name: o.name, triangles: o.geometry.index.count / 3 });
});
console.log(
  JSON.stringify(
    { bytes: glb.byteLength, bones: skeleton.bones.length, meshes },
    null,
    2,
  ),
);
if (process.argv.includes("--optimise")) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "courtiq-player-"));
  try {
    const dedup = path.join(temp, "dedup.glb");
    execFileSync(
      "npx",
      [
        "--yes",
        "@gltf-transform/cli@4.5.1",
        "dedup",
        "public/assets/player/streetball-player.glb",
        dedup,
      ],
      { stdio: "inherit" },
    );
    // Runtime names use this UV set even though the shipping material has no map.
    execFileSync(
      "npx",
      [
        "--yes",
        "@gltf-transform/cli@4.5.1",
        "prune",
        dedup,
        "public/assets/player/streetball-player.glb",
        "--keep-attributes",
        "true",
      ],
      { stdio: "inherit" },
    );
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}
