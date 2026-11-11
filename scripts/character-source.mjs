import fs from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Keep the original source files untouched; source texture maps are replaced by CourtIQ materials. */
export async function loadSkySource() {
  const json = JSON.parse(await fs.readFile('assets/source/Superhero_Female_FullBody.gltf', 'utf8'));
  const binary = await fs.readFile('assets/source/Superhero_Female_FullBody.bin');
  delete json.buffers[0].uri;
  delete json.images; delete json.textures; delete json.samplers;
  json.materials = json.materials.map(m => ({
    name: m.name, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.8 },
  }));
  delete json.extensionsUsed; delete json.extensionsRequired;
  const text = Buffer.from(JSON.stringify(json));
  const jsonLength = Math.ceil(text.length / 4) * 4;
  const binLength = Math.ceil(binary.length / 4) * 4;
  const glb = Buffer.alloc(12 + 8 + jsonLength + 8 + binLength);
  glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(jsonLength, 12); glb.writeUInt32LE(0x4e4f534a, 16);
  glb.fill(0x20, 20, 20 + jsonLength); text.copy(glb, 20);
  glb.writeUInt32LE(binLength, 20 + jsonLength); glb.writeUInt32LE(0x004e4942, 24 + jsonLength);
  binary.copy(glb, 28 + jsonLength);
  const asset = await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
  asset.scene.updateMatrixWorld(true);
  return asset;
}

/** Rebind a source mesh to River's rest rig while preserving its authored proportions. */
export function geometryOnSharedRig(mesh, target) {
  const geometry = mesh.geometry.clone();
  const positions = geometry.attributes.position;
  const weights = geometry.attributes.skinWeight;
  const indices = geometry.attributes.skinIndex;
  const targetIndex = new Map(target.skeleton.bones.map((bone, i) => [bone.name, i]));
  const transforms = mesh.skeleton.bones.map((bone, i) => {
    const next = targetIndex.get(bone.name);
    if (next === undefined) throw Error('Unmatched character bone: ' + bone.name);
    return new THREE.Matrix4().multiplyMatrices(target.skeleton.bones[next].matrixWorld, mesh.skeleton.boneInverses[i]);
  });
  const point = new THREE.Vector3(), transformed = new THREE.Vector3(), result = new THREE.Vector3();
  const inverseTargetBind = target.bindMatrix.clone().invert();
  const mappedIndices = new Uint16Array(indices.count * 4);
  for (let i = 0; i < positions.count; i++) {
    point.fromBufferAttribute(positions, i).applyMatrix4(mesh.bindMatrix);
    result.set(0, 0, 0);
    for (let k = 0; k < 4; k++) {
      const joint = indices.array[i * 4 + k], weight = weights.array[i * 4 + k];
      result.addScaledVector(transformed.copy(point).applyMatrix4(transforms[joint]), weight);
      mappedIndices[i * 4 + k] = targetIndex.get(mesh.skeleton.bones[joint].name);
    }
    result.applyMatrix4(inverseTargetBind);
    positions.setXYZ(i, result.x, result.y, result.z);
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(mappedIndices, 4));
  geometry.computeVertexNormals();
  return geometry;
}
