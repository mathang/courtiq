import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

async function load(file:string) {
  const b=readFileSync(new URL('../../public/assets/player/'+file,import.meta.url));
  return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
}
const [river,sky]=await Promise.all([load('streetball-player.glb'),load('athlete-sky.glb')]);

describe('Shared athletic rig and distinct authored characters',()=>{
  it('keeps the same rest joints, limb reach and animation contracts for both characters',()=>{
    river.scene.updateMatrixWorld(true);sky.scene.updateMatrixWorld(true);
    const bones:THREE.Bone[]=[];river.scene.traverse(o=>{if(o instanceof THREE.Bone)bones.push(o);});
    expect(bones).toHaveLength(65);
    for(const bone of bones){
      const other=sky.scene.getObjectByName(bone.name);
      expect(other).toBeInstanceOf(THREE.Bone);
      expect(other!.getWorldPosition(new THREE.Vector3()).distanceTo(bone.getWorldPosition(new THREE.Vector3()))).toBeLessThan(1e-6);
      // Imported float quaternions must be normalised before angleTo's dot/acos.
      expect(other!.getWorldQuaternion(new THREE.Quaternion()).normalize().angleTo(bone.getWorldQuaternion(new THREE.Quaternion()).normalize())).toBeLessThan(1e-6);
    }
    expect(sky.animations.map(a=>a.name).sort()).toEqual(river.animations.map(a=>a.name).sort());
  });

  it('ships distinct body and hair geometry while retaining jersey UVs on a continuous surface',()=>{
    for(const name of ['Body_Jersey','Detail_Hair']){
      const a=river.scene.getObjectByName(name) as THREE.SkinnedMesh,b=sky.scene.getObjectByName(name) as THREE.SkinnedMesh;
      expect(Array.from(a.geometry.attributes.position.array)).not.toEqual(Array.from(b.geometry.attributes.position.array));
    }
    const jersey=sky.scene.getObjectByName('Body_Jersey') as THREE.SkinnedMesh;
    expect(jersey.userData.surface).toBe('continuous-body');
    expect(jersey.geometry.attributes.uv.count).toBe(jersey.geometry.attributes.position.count);
    expect(sky.scene.userData.character).toBe('sky');
  });
});
