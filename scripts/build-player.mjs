/** Continuous skinned kit: body, singlet, shorts, sleeve and socks share one surface.
 * Material boundaries split triangles without adding overlapping clothing shells.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import {
  mergeGeometries,
  mergeVertices,
} from "three/addons/utils/BufferGeometryUtils.js";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { createBasketballAnimations } from './player-animations.mjs';

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
const original = scene.getObjectByName("SuperHero_Male"),
  skeleton = original.skeleton;
const source = original.geometry.clone();
const parts = new Map(),
  materials = new Map();
for (const [name, color, roughness] of [
  ["Skin", "#a96c47", 0.68],
  ["Jersey", "#ffbd2d", 0.94],
  ["KitNavy", "#101e38", 0.94],
  ["TeamAccent", "#ffbd2d", 0.85],
  ["Ivory", "#f5f0e6", 0.82],
  ["Hair", "#211713", 0.96],
  ["Eyes", "#f5eee7", 0.4],
  ["Pupils", "#251d19", 0.5],
  ["Sole", "#c9c3b6", 0.85],
])
  materials.set(
    name,
    new THREE.MeshStandardMaterial({ name, color, roughness }),
  );
const clamp = THREE.MathUtils.clamp;
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const positions = source.attributes.position;
const rest = Float32Array.from(positions.array);
// Ease the abdomen and thighs into fitted fabric without placing a second mesh above skin.
for (let i = 0; i < positions.count; i++) {
  const x = rest[i * 3],
    y = rest[i * 3 + 1],
    z = rest[i * 3 + 2];
  let nx = x,
    nz = z;
  if (y > 0.96 && y < 1.45 && Math.abs(x) < 0.255) {
    const fabric = smooth(0.96, 1.04, y) * (1 - smooth(1.38, 1.45, y));
    const radius = 0.155 + 0.08 * smooth(1.03, 1.34, y);
    const front = 0.136 * Math.sqrt(Math.max(0.05, 1 - (x / radius) ** 2));
    if (z > 0.015)
      nz = THREE.MathUtils.lerp(
        z,
        front,
        fabric * 0.45 * smooth(0.015, 0.07, z),
      );
  }
  if (y > 0.625 && y < 1.025) {
    const fabric = smooth(0.625, 0.7, y) * (1 - smooth(0.94, 1.025, y));
    const hip = Math.sign(x) * 0.114;
    nx += ((x - hip) * 0.3 + Math.sign(x) * 0.008) * fabric;
    nz += (z + 0.035) * 0.25 * fabric;
  }
  positions.setXYZ(i, nx, y, nz);
}
source.computeVertexNormals();
const normals = source.attributes.normal,
  js = source.attributes.skinIndex,
  ws = source.attributes.skinWeight;
const lerpArray = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
function sourceVertex(i) {
  return {
    p: [positions.getX(i), positions.getY(i), positions.getZ(i)],
    r: Array.from(rest.slice(i * 3, i * 3 + 3)),
    n: [normals.getX(i), normals.getY(i), normals.getZ(i)],
    j: Array.from(js.array.slice(i * 4, i * 4 + 4)),
    w: Array.from(ws.array.slice(i * 4, i * 4 + 4)),
  };
}
function interpolate(a, b, t) {
  const influence = new Map();
  for (let i = 0; i < 4; i++) {
    influence.set(a.j[i], (influence.get(a.j[i]) ?? 0) + a.w[i] * (1 - t));
    influence.set(b.j[i], (influence.get(b.j[i]) ?? 0) + b.w[i] * t);
  }
  const pairs = [...influence]
    .filter(([, w]) => w > 1e-10)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 4);
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  while (pairs.length < 4) pairs.push([0, 0]);
  const n = new THREE.Vector3(...lerpArray(a.n, b.n, t)).normalize().toArray();
  return {
    p: lerpArray(a.p, b.p, t),
    r: lerpArray(a.r, b.r, t),
    n,
    j: pairs.map(([j]) => j),
    w: pairs.map(([, w]) => w / total),
  };
}
function clip(poly, field, positive = true) {
  const out = [];
  const sign = positive ? 1 : -1;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length],
      da = field(a.r) * sign,
      db = field(b.r) * sign;
    if (da >= 0) out.push(a);
    if (da < 0 !== db < 0)
      out.push(interpolate(a, b, clamp(da / (da - db), 0, 1)));
  }
  return out.filter(
    (v, i) =>
      i === 0 || v.p.some((x, c) => Math.abs(x - out[i - 1].p[c]) > 1e-9),
  );
}
const split = (poly, field) => [clip(poly, field), clip(poly, field, false)];
const bodyParts = new Map();
function emit(poly, material, frontSide) {
  if (poly.length < 3) return;
  if (material === "Jersey" && frontSide === undefined) {
    const [front, back] = split(poly, ([, , z]) => z + 0.02);
    emit(front, material, true);
    emit(back, material, false);
    return;
  }
  if (!bodyParts.has(material))
    bodyParts.set(material, {
      position: [],
      normal: [],
      uv: [],
      skinIndex: [],
      skinWeight: [],
    });
  const dst = bodyParts.get(material);
  for (let t = 1; t < poly.length - 1; t++)
    for (const v of [poly[0], poly[t], poly[t + 1]]) {
      dst.position.push(...v.p);
      dst.normal.push(...v.n);
      dst.skinIndex.push(...v.j);
      dst.skinWeight.push(...v.w);
      const front = frontSide ?? v.r[2] > -0.02;
      // Continuous body UVs put artwork directly on the singlet, with no floating decal surface.
      dst.uv.push(
        (front ? 0.25 : 0.75) + ((front ? 1 : -1) * v.r[0]) / 1.04,
        clamp((1.54 - v.r[1]) / 0.55, 0, 1),
      );
    }
}
function shirtField([x, y, z]) {
  const ax = Math.abs(x),
    front = z > -0.02;
  const neck = front
    ? 1.435 + 0.105 * clamp(ax / 0.1, 0, 1)
    : 1.5 + 0.035 * clamp(ax / 0.1, 0, 1);
  const armhole = 0.273 - 0.085 * smooth(1.365, 1.515, y);
  return Math.min(y - 0.995, neck - y, armhole - ax);
}
const pantsField = ([x, y]) => Math.min(y - 0.65, 0.995 - y, 0.3 - Math.abs(x));
const sockField = ([, y]) => Math.min(y - 0.105, 0.292 - y);
const sockStripe = ([, y]) =>
  Math.max(Math.min(y - 0.254, 0.262 - y), Math.min(y - 0.277, 0.285 - y));
const sleeveField = ([x, y]) => Math.min(x, y - 0.34, 0.65 - y);
const headbandField = ([, y]) => Math.min(y - 1.742, 1.765 - y);
let retainedTriangles = 0;
for (let i = 0; i < source.index.count; i += 3) {
  let poly = [0, 1, 2].map((k) => sourceVertex(source.index.getX(i + k)));
  poly = clip(poly, ([, y]) => y - 0.105);
  if (poly.length < 3) continue;
  retainedTriangles++;
  let garment;
  [garment, poly] = split(poly, shirtField);
  if (garment.length) {
    const [inner, trim] = split(garment, (p) => shirtField(p) - 0.008);
    emit(inner, "Jersey");
    emit(trim, "KitNavy");
  }
  [garment, poly] = split(poly, pantsField);
  if (garment.length) {
    const [accent, navy] = split(garment, ([x, y]) =>
      Math.max(
        0.663 - y,
        Math.abs(x) - (0.184 + 0.045 * smooth(0.65, 0.97, y)),
      ),
    );
    emit(accent, "TeamAccent");
    emit(navy, "KitNavy");
  }
  [garment, poly] = split(poly, sockField);
  if (garment.length) {
    const [stripe, white] = split(garment, sockStripe);
    emit(stripe, "KitNavy");
    emit(white, "Ivory");
  }
  [garment, poly] = split(poly, sleeveField);
  emit(garment, "KitNavy");
  [garment, poly] = split(poly, headbandField);
  emit(garment, "TeamAccent");
  emit(poly, "Skin");
}
function geometry(data) {
  const g = new THREE.BufferGeometry();
  for (const [name, array] of Object.entries(data))
    g.setAttribute(
      name,
      name === "skinIndex"
        ? new THREE.Uint16BufferAttribute(array, 4)
        : new THREE.Float32BufferAttribute(
            array,
            name === "uv" ? 2 : name === "skinWeight" ? 4 : 3,
          ),
    );
  g.setIndex(Array.from({ length: g.attributes.position.count }, (_, i) => i));
  return g;
}
function add(g, name, material, bone) {
  for (const key of Object.keys(g.attributes))
    if (!["position", "normal", "uv", "skinIndex", "skinWeight"].includes(key))
      g.deleteAttribute(key);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv)
    g.setAttribute(
      "uv",
      new THREE.Float32BufferAttribute(
        new Float32Array(g.attributes.position.count * 2),
        2,
      ),
    );
  if (!g.attributes.skinIndex) {
    const joint = skeleton.bones.findIndex((b) => b.name === bone),
      count = g.attributes.position.count;
    if (joint < 0) throw Error("Missing bone " + bone);
    g.setAttribute(
      "skinIndex",
      new THREE.Uint16BufferAttribute(
        Array.from({ length: count * 4 }, (_, i) => (i % 4 === 0 ? joint : 0)),
        4,
      ),
    );
    g.setAttribute(
      "skinWeight",
      new THREE.Float32BufferAttribute(
        Array.from({ length: count * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)),
        4,
      ),
    );
  } else
    g.setAttribute(
      "skinIndex",
      new THREE.Uint16BufferAttribute(g.attributes.skinIndex.array, 4),
    );
  if (!parts.has(name)) parts.set(name, { material, geometries: [] });
  parts.get(name).geometries.push(g);
}
for (const [material, data] of bodyParts)
  add(geometry(data), "Body_" + material, material);
original.removeFromParent();
for (const [name, material] of [
  ["Eyebrows", "Hair"],
  ["Eyes", "Eyes"],
]) {
  const o = scene.getObjectByName(name);
  add(o.geometry.clone(), "Detail_" + material, material);
  o.removeFromParent();
}
function sphere(x, y, z, rx, ry, rz, name, material, bone, segments = 16) {
  const g = new THREE.SphereGeometry(
    1,
    segments,
    Math.min(12, Math.max(5, segments / 2)),
  );
  g.scale(rx, ry, rz);
  g.translate(x, y, z);
  add(g, name, material, bone);
}
function tube(points, radius, name, material, bone) {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(...p)),
  );
  add(
    new THREE.TubeGeometry(curve, points.length * 2, radius, 5, false),
    name,
    material,
    bone,
  );
}
function shoeLoft(rings, name, material, bone, cap = false, paint = false) {
  const p = [],
    n = [],
    uv = [],
    ix = [],
    s = 32;
  for (let r = 0; r < rings.length; r++)
    for (let i = 0; i <= s; i++) {
      const [y, rx, rz, x, z] = rings[r],
        a = (i / s) * Math.PI * 2;
      p.push(x + Math.cos(a) * rx, y, z + Math.sin(a) * rz);
      uv.push(i / s, r / (rings.length - 1));
      if (r < rings.length - 1 && i < s) {
        const j = r * (s + 1) + i;
        ix.push(j, j + s + 1, j + 1, j + 1, j + s + 1, j + s + 2);
      }
    }
  if (cap) {
    const [y, , , x, z] = rings[0],
      c = p.length / 3;
    p.push(x, y, z);
    uv.push(0.5, 0.5);
    for (let i = 0; i < s; i++) ix.push(c, i, i + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(ix);
  g.computeVertexNormals();
  if (!paint) {
    add(g, name, material, bone);
    return;
  }
  const fixed = skeleton.bones.findIndex((b) => b.name === bone),
    painted = new Map(),
    center = rings[0][3];
  function collect(poly, key) {
    if (poly.length < 3) return;
    if (!painted.has(key))
      painted.set(key, {
        position: [],
        normal: [],
        uv: [],
        skinIndex: [],
        skinWeight: [],
      });
    const d = painted.get(key);
    for (let i = 1; i < poly.length - 1; i++)
      for (const v of [poly[0], poly[i], poly[i + 1]]) {
        d.position.push(...v.p);
        d.normal.push(...v.n);
        d.uv.push(0, 0);
        d.skinIndex.push(...v.j);
        d.skinWeight.push(...v.w);
      }
  }
  for (let i = 0; i < ix.length; i += 3) {
    const poly = ix
      .slice(i, i + 3)
      .map((k) => ({
        p: p.slice(k * 3, k * 3 + 3),
        r: p.slice(k * 3, k * 3 + 3),
        n: Array.from(g.attributes.normal.array.slice(k * 3, k * 3 + 3)),
        j: [fixed, 0, 0, 0],
        w: [1, 0, 0, 0],
      }));
    let [toe, rest] = split(poly, ([, y, z]) => Math.min(z - 0.07, 0.115 - y));
    collect(toe, "Ivory");
    let [accent, base] = split(rest, ([x, y, z]) =>
      Math.min(
        Math.abs(x - center) - 0.056,
        y - 0.076,
        0.129 - y,
        0.035 - z,
        z + 0.076,
      ),
    );
    collect(accent, "TeamAccent");
    collect(base, "KitNavy");
  }
  for (const [mat, data] of painted)
    add(
      geometry(data),
      mat === "Ivory"
        ? "Shoe_Ivory"
        : mat === "TeamAccent"
          ? "Shoe_Accent"
          : name,
      mat,
    );
}
for (const sign of [-1, 1]) {
  const x = sign * 0.114,
    bone = sign > 0 ? "foot_l" : "foot_r";
  shoeLoft(
    [
      [0.004, 0.073, 0.161, x, 0.018],
      [0.021, 0.082, 0.171, x, 0.018],
      [0.029, 0.084, 0.171, x, 0.018],
    ],
    "Shoe_Sole",
    "Sole",
    bone,
    true,
  );
  shoeLoft(
    [
      [0.029, 0.084, 0.171, x, 0.018],
      [0.052, 0.084, 0.166, x, 0.016],
      [0.063, 0.079, 0.157, x, 0.009],
    ],
    "Shoe_Ivory",
    "Ivory",
    bone,
  );
  const upper = [
    [0.063, 0.079, 0.157, x, 0.009],
    [0.095, 0.077, 0.14, x, 0.001],
    [0.129, 0.066, 0.107, x, -0.019],
    [0.16, 0.054, 0.069, x, -0.047],
    [0.183, 0.048, 0.056, x, -0.06],
  ];
  shoeLoft(upper, "Shoe_Upper", "KitNavy", bone, false, true);
  // A small collar is part of the shoe and follows the same foot bone.
  shoeLoft(
    [
      [0.173, 0.05, 0.059, x, -0.057],
      [0.185, 0.048, 0.056, x, -0.06],
      [0.185, 0.043, 0.05, x, -0.06],
    ],
    "Shoe_Accent",
    "TeamAccent",
    bone,
  );
  function upperHeight(dx, z) {
    let height = 0.063;
    for (let i = 0; i < upper.length - 1; i++)
      for (let s = 0; s <= 30; s++) {
        const t = s / 30,
          a = upper[i],
          b = upper[i + 1],
          rx = THREE.MathUtils.lerp(a[1], b[1], t),
          rz = THREE.MathUtils.lerp(a[2], b[2], t),
          cz = THREE.MathUtils.lerp(a[4], b[4], t);
        if ((dx / rx) ** 2 + ((z - cz) / rz) ** 2 <= 1)
          height = THREE.MathUtils.lerp(a[0], b[0], t);
      }
    return height;
  }
  for (let k = 0; k < 4; k++) {
    const z = -0.025 + k * 0.022;
    tube(
      [-0.031, -0.015, 0, 0.015, 0.031].map((dx) => [
        x + dx,
        upperHeight(dx, z) + 0.003,
        z,
      ]),
      0.0026,
      "Shoe_Ivory",
      "Ivory",
      bone,
    );
  }
}
const cap = new THREE.SphereGeometry(
  1,
  32,
  16,
  0,
  Math.PI * 2,
  0,
  Math.PI * 0.53,
);
cap.scale(0.116, 0.095, 0.107);
cap.translate(0, 1.759, -0.009);
add(cap, "Detail_Hair", "Hair", "Head");
for (let r = 0; r < 4; r++)
  for (let k = 0; k < 12; k++) {
    const theta = (k / 12) * Math.PI * 2 + (r % 2) * 0.2,
      a = ((r + 0.5) / 4) * 1.42;
    sphere(
      0.109 * Math.sin(a) * Math.cos(theta),
      1.762 + 0.091 * Math.cos(a),
      -0.009 + 0.101 * Math.sin(a) * Math.sin(theta),
      0.018,
      0.016,
      0.018,
      "Detail_Hair",
      "Hair",
      "Head",
      8,
    );
  }
for (const side of [-1, 1]) {
  sphere(
    side * 0.034,
    1.699,
    0.08,
    0.013,
    0.014,
    0.008,
    "Detail_Pupils",
    "Pupils",
    "Head",
    12,
  );
  sphere(
    side * 0.03,
    1.704,
    0.087,
    0.003,
    0.003,
    0.002,
    "Shoe_Ivory",
    "Ivory",
    "Head",
    8,
  );
}
let triangles = 0;
for (const [name, { material, geometries }] of parts) {
  const merged = mergeGeometries(geometries, false);
  if (!merged) throw Error("Merge failed " + name);
  const g = mergeVertices(merged, 1e-5);
  const m = new THREE.SkinnedMesh(g, materials.get(material));
  m.name = name;
  m.frustumCulled = false;
  m.userData = {
    surface: name.startsWith("Body_") ? "continuous-body" : "attached-detail",
  };
  scene.add(m);
  m.bind(skeleton, original.bindMatrix);
  m.normalizeSkinWeights();
  triangles += g.index.count / 3;
  const j = g.attributes.skinIndex,
    w = g.attributes.skinWeight;
  for (let i = 0; i < w.count; i++)
    for (let k = 0; k < 4; k++)
      if (w.array[i * 4 + k] === 0) j.array[i * 4 + k] = 0;
}
const exported = new THREE.Scene();
exported.name = "CourtIQ_Continuous_Streetball_Player";
exported.userData = {
  author: "CourtIQ integrated kit; Quaternius CC0 humanoid",
  units: "metres",
  forward: "+Z",
  up: "+Y",
  kitTopology: "single-source-surface",
  sourceSha256: createHash("sha256").update(bytes).digest("hex"),
};
for (const child of [...scene.children]) exported.add(child);
const animations = await createBasketballAnimations(exported);
const glb = await new GLTFExporter().parseAsync(exported, { binary: true, animations });
await fs.writeFile(
  "public/assets/player/streetball-player.glb",
  Buffer.from(glb),
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
console.log(
  JSON.stringify(
    {
      bytes: (await fs.stat("public/assets/player/streetball-player.glb")).size,
      bones: skeleton.bones.length,
      triangles,
      meshes: parts.size,
      animations: animations.length,
      bodySourceTriangles: retainedTriangles,
      kitTopology: "single-source-surface",
    },
    null,
    2,
  ),
);
