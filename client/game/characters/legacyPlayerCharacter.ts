import * as THREE from 'three';
import { dunkRig } from '../../../shared/rules/dunks';
import { getAirPose, STREET_MOVES } from '../../../shared/rules/streetMoves';
import { PlayerSimState } from '../../../shared/rules/matchStateMachine';
import { PlayerSlot } from '../../../shared/rules/possession';
import { characterForAppearance } from '../../../shared/config/appearance';

export interface AppearancePresetOption {
  readonly id: number;
  readonly label: string;
  readonly skinHex: number;
  readonly hairHex: number;
  readonly headbandHex: number;
  readonly hairStyle: 'short' | 'afro' | 'ponytail' | 'fade';
}

export const APPEARANCE_PRESETS: readonly AppearancePresetOption[] = [
  {
    id: 0,
    label: 'Style A (Warm Brown • Dark Crop)',
    skinHex: 0x8d5524,
    hairHex: 0x1a1512,
    headbandHex: 0xfdb913,
    hairStyle: 'fade',
  },
  {
    id: 1,
    label: 'Style B (Tan • Chestnut Crop)',
    skinHex: 0xe0ac69,
    hairHex: 0x3b2314,
    headbandHex: 0x38bdf8,
    hairStyle: 'ponytail',
  },
  {
    id: 2,
    label: 'Style C (Deep Brown • Dark Crop)',
    skinHex: 0x5c3818,
    hairHex: 0x14110f,
    headbandHex: 0xf8fafc,
    hairStyle: 'afro',
  },
  {
    id: 3,
    label: 'Style D (Light • Brown Crop)',
    skinHex: 0xf1c27d,
    hairHex: 0x6e4720,
    headbandHex: 0x004b87,
    hairStyle: 'short',
  },
];

interface LimbRig { pivot: THREE.Group; joint: THREE.Group; }

export class LegacyPlayerCharacter3D {
  public readonly root = new THREE.Group();
  private body = new THREE.Group();
  private leftArm: LimbRig;
  private rightArm: LimbRig;
  private leftLeg: LimbRig;
  private rightLeg: LimbRig;
  private ring: THREE.Mesh;
  private contest: THREE.Mesh;
  private phase = 0;
  private rotation = Math.PI;
  private initialized = false;
  private jerseyName = '';
  private readonly nameCanvas = document.createElement('canvas');
  private readonly nameTexture: THREE.CanvasTexture;
  private readonly nameColour: string;

  constructor(slot: PlayerSlot, appearancePreset = 0) {
    this.nameCanvas.width = 512; this.nameCanvas.height = 96;
    this.nameTexture = new THREE.CanvasTexture(this.nameCanvas);
    this.nameTexture.colorSpace = THREE.SRGBColorSpace;
    this.nameColour = slot === 0 ? '#082a48' : '#ffffff';
    const preset = APPEARANCE_PRESETS[appearancePreset % 4] ?? APPEARANCE_PRESETS[0];
    const isSky = characterForAppearance(appearancePreset).key === 'sky';
    const skin = new THREE.MeshStandardMaterial({ color: preset.skinHex, roughness: 0.65 });
    const jersey = new THREE.MeshStandardMaterial({ color: slot === 0 ? 0xfdb913 : 0x00a8e8, roughness: 0.75 });
    const shorts = new THREE.MeshStandardMaterial({ color: slot === 0 ? 0x082a48 : 0x082f49, roughness: 0.8 });
    const shoes = new THREE.MeshStandardMaterial({ color: slot === 0 ? 0xf8fafc : 0x183147, roughness: 0.5 });
    const band = new THREE.MeshStandardMaterial({ color: preset.headbandHex });
    const hair = new THREE.MeshStandardMaterial({ color: preset.hairHex, roughness: 1 });
    const torso = this.mesh(new THREE.CylinderGeometry(isSky ? 0.26 : 0.285, 0.21, 0.50, 20), jersey, this.body, 0, 1.23, 0);
    torso.scale.z = 0.64;
    this.ellipsoid(this.body, shorts, 0, 0.91, 0, 0.245, 0.18, 0.15);
    this.mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.13, 12), skin, this.body, 0, 1.54, 0);
    this.ellipsoid(this.body, skin, 0, 1.73, 0, 0.16, 0.20, 0.155);
    const cap = this.ellipsoid(this.body, hair, 0, 1.86, -0.015, preset.hairStyle === 'afro' ? 0.205 : 0.16,
      preset.hairStyle === 'afro' ? 0.18 : 0.09, preset.hairStyle === 'afro' ? 0.19 : 0.15);
    if (isSky || preset.hairStyle === 'ponytail') this.ellipsoid(this.body, hair, 0, 1.79, -0.20, 0.065, 0.14, 0.065);
    const headband = this.mesh(new THREE.CylinderGeometry(0.163, 0.163, 0.045, 20), band, this.body, 0, 1.82, 0);
    headband.scale.z = 0.96;
    // Small facial details keep the face readable without external assets.
    const eyes = new THREE.MeshStandardMaterial({ color: 0x111827 });
    for (const side of [-1, 1]) this.ellipsoid(this.body, eyes, side * 0.055, 1.75, 0.146, 0.018, 0.013, 0.012);
    this.ellipsoid(this.body, skin, 0, 1.70, 0.154, 0.027, 0.035, 0.028);
    const texture = this.numberTexture(slot === 0 ? '9' : '5', slot === 0 ? '#082a48' : '#ffffff');
    for (const front of [1, -1]) {
      const number = this.mesh(new THREE.PlaneGeometry(0.18, 0.25), new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide }), this.body, 0, 1.24, front * 0.177);
      if (front < 0) number.rotation.y = Math.PI;
    }
    const nameplate = this.mesh(new THREE.PlaneGeometry(0.38, 0.075), new THREE.MeshBasicMaterial({ map: this.nameTexture, transparent: true, depthWrite: false }), this.body, 0, 1.415, -0.186);
    nameplate.rotation.y = Math.PI;
    this.leftArm = this.arm(-0.28, skin, jersey);
    this.rightArm = this.arm(0.28, skin, jersey);
    this.leftLeg = this.leg(-0.125, skin, shorts, shoes);
    this.rightLeg = this.leg(0.125, skin, shorts, shoes);
    this.root.add(this.body);
    this.ring = this.mesh(new THREE.RingGeometry(0.39, 0.43, 48), new THREE.MeshBasicMaterial({ color: slot === 0 ? 0xfdb913 : 0x38bdf8, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }), this.root, 0, 0.014, 0);
    this.ring.rotation.x = -Math.PI / 2;
    this.contest = this.mesh(new THREE.RingGeometry(0.53, 0.57, 48), new THREE.MeshBasicMaterial({ color: 0x34d399, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }), this.root, 0, 0.018, 0);
    this.contest.rotation.x = -Math.PI / 2;
  }

  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, x: number, y: number, z: number): THREE.Mesh {
    const m = new THREE.Mesh(geometry, material); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
  }
  private ellipsoid(parent: THREE.Object3D, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number): THREE.Mesh {
    const m = this.mesh(new THREE.SphereGeometry(1, 16, 12), mat, parent, x, y, z); m.scale.set(sx, sy, sz); return m;
  }
  private arm(x: number, skin: THREE.Material, kit: THREE.Material): LimbRig {
    const pivot = new THREE.Group(); pivot.position.set(x, 1.45, 0); this.body.add(pivot);
    this.ellipsoid(pivot, kit, 0, 0, 0, 0.09, 0.10, 0.095);
    this.mesh(new THREE.CapsuleGeometry(0.062, 0.19, 4, 12), skin, pivot, 0, -0.15, 0);
    const joint = new THREE.Group(); joint.position.y = -0.29; pivot.add(joint);
    this.ellipsoid(joint, skin, 0, 0, 0, 0.059, 0.06, 0.059);
    this.mesh(new THREE.CapsuleGeometry(0.048, 0.19, 4, 12), skin, joint, 0, -0.14, 0);
    this.ellipsoid(joint, skin, 0, -0.30, 0.015, 0.055, 0.07, 0.035);
    return { pivot, joint };
  }
  private leg(x: number, skin: THREE.Material, kit: THREE.Material, shoes: THREE.Material): LimbRig {
    const pivot = new THREE.Group(); pivot.position.set(x, 0.88, 0); this.body.add(pivot);
    this.mesh(new THREE.CapsuleGeometry(0.105, 0.17, 4, 12), kit, pivot, 0, -0.14, 0);
    const joint = new THREE.Group(); joint.position.y = -0.37; pivot.add(joint);
    this.ellipsoid(joint, skin, 0, 0, 0, 0.073, 0.075, 0.07);
    this.mesh(new THREE.CapsuleGeometry(0.06, 0.22, 4, 12), skin, joint, 0, -0.17, 0);
    this.ellipsoid(joint, shoes, 0, -0.44, 0.055, 0.085, 0.07, 0.16);
    return { pivot, joint };
  }
  private numberTexture(n: string, colour: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 160;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = colour; ctx.font = '900 140px system-ui';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(n, 64, 82);
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; return tex;
  }

  public update(params: { sim: PlayerSimState; isAttacker: boolean; showBlockEligibleRing: boolean; presentationDeltaSec: number; realDeltaSec: number }): void {
    const { sim: p, isAttacker, showBlockEligibleRing, presentationDeltaSec: dt } = params;
    if (this.jerseyName !== p.pseudonym) {
      this.jerseyName = p.pseudonym;
      const ctx = this.nameCanvas.getContext('2d')!;
      ctx.clearRect(0, 0, 512, 96);
      ctx.fillStyle = this.nameColour; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const name = p.pseudonym.toLocaleUpperCase();
      let size = 72;
      do { ctx.font = `900 ${size}px system-ui, sans-serif`; size -= 2; } while (ctx.measureText(name).width > 490 && size > 14);
      ctx.fillText(name, 256, 48, 490); this.nameTexture.needsUpdate = true;
    }
    const air = getAirPose(p);
    // Ease network snapshots while keeping solo response snappy. Reset instantly at check-ball.
    const target = new THREE.Vector3(air.x, 0, air.z);
    if (!this.initialized || this.root.position.distanceTo(target) > 3.5) this.root.position.copy(target);
    else this.root.position.lerp(target, 1 - Math.exp(-params.realDeltaSec * 32));
    this.initialized = true;
    const angle = Math.atan2(Math.sin(p.facingAngle - this.rotation), Math.cos(p.facingAngle - this.rotation));
    this.rotation += angle * (1 - Math.exp(-dt * 25));
    this.body.rotation.set(0, this.rotation, 0);
    this.body.position.set(0, air.y, 0);
    const speed = Math.hypot(p.vx, p.vz);
    this.phase += dt * (4 + speed * 2.3);
    const stride = Math.sin(this.phase);
    const moving = speed > 0.2;
    const legSwing = moving ? stride * Math.min(0.85, speed * 0.10) : 0;
    this.leftLeg.pivot.rotation.set(legSwing, 0, -0.035);
    this.rightLeg.pivot.rotation.set(-legSwing, 0, 0.035);
    this.leftLeg.joint.rotation.x = moving ? Math.max(0, -stride) * 1.0 : 0.12;
    this.rightLeg.joint.rotation.x = moving ? Math.max(0, stride) * 1.0 : 0.12;
    this.leftArm.pivot.rotation.set(-legSwing * 0.7 - 0.1, 0, -0.12);
    this.rightArm.pivot.rotation.set(isAttacker ? -0.5 + Math.sin(this.phase * 1.25) * 0.3 : legSwing * 0.7 - 0.1, 0, 0.12);
    this.leftArm.joint.rotation.x = -0.45;
    this.rightArm.joint.rotation.x = isAttacker ? -0.55 : -0.45;
    if (!p.finishKind && !p.defenseAction) {
      this.body.position.y = moving ? Math.abs(stride) * 0.045 : Math.sin(this.phase) * 0.01;
      this.body.rotation.x = moving ? 0.10 : 0.02;
    }
    if (p.streetMove) {
      const u = p.moveElapsedSec / STREET_MOVES[p.streetMove].duration;
      this.body.position.y -= Math.sin(u * Math.PI) * 0.15;
      if (p.streetMove === 'spin') this.body.rotation.y += p.moveSide * u * Math.PI * 2;
      this.body.rotation.z = Math.sin(u * Math.PI * (p.streetMove === 'eurostep' ? 2 : 1)) * -p.moveSide * 0.24;
      this.leftLeg.joint.rotation.x += 0.35; this.rightLeg.joint.rotation.x += 0.35;
      this.rightArm.pivot.rotation.x = -0.65;
    }
    if (p.wrongFootSec > 0) {
      this.body.rotation.z = Math.sin(p.wrongFootSec * 12) * 0.22;
      this.leftArm.pivot.rotation.z = -0.8; this.rightArm.pivot.rotation.z = 0.8;
    }
    if (p.finishKind && (p.animState === 'shoot' || p.finishResolutionSec >= 0)) {
      const dunk = p.finishKind === 'dunk';
      const raising = dunk ? Math.min(1, p.finishElapsedSec / 0.40) : Math.min(1, p.finishElapsedSec / 0.18);
      const landing = p.finishResolutionSec > 0.3;
      this.rightArm.pivot.rotation.x = -Math.PI * raising;
      this.rightArm.joint.rotation.x = 0;
      this.leftArm.pivot.rotation.x = (dunk ? -2.5 : -2.9) * raising;
      this.leftArm.joint.rotation.x = -0.12;
      this.leftLeg.pivot.rotation.x = dunk ? -0.5 * (1 - air.progress) : 0.1;
      this.rightLeg.pivot.rotation.x = dunk ? 0.35 : -0.1;
      this.leftLeg.joint.rotation.x = dunk && !landing ? 0.95 : 0.18;
      this.rightLeg.joint.rotation.x = dunk && !landing ? 0.65 : 0.18;
      if (landing) {
        this.rightArm.pivot.rotation.x *= Math.max(0, 1 - (p.finishResolutionSec - 0.3) / 0.7);
        this.leftArm.pivot.rotation.x *= Math.max(0, 1 - (p.finishResolutionSec - 0.3) / 0.7);
      }
    } else if (p.animState === 'block') {
      this.body.position.y = Math.sin(Math.min(1, p.finishElapsedSec / 0.7) * Math.PI) * 0.55;
      this.leftArm.pivot.rotation.x = -2.8; this.rightArm.pivot.rotation.x = -3.0;
    }
    if (p.finishKind === 'dunk') {
      const rig = dunkRig(p);
      this.body.rotation.y += rig.twist;
      this.rightArm.pivot.rotation.set(rig.arm, 0, 0);
      this.rightArm.joint.rotation.x = 0;
      this.leftArm.pivot.rotation.set(rig.guideArm, 0, p.dunkStyle === 'windmill' ? -0.7 : -0.05);
      this.leftArm.joint.rotation.x = 0;
      const tuck = Math.sin(Math.min(1, p.finishElapsedSec / 0.84) * Math.PI);
      this.leftLeg.pivot.rotation.x = -0.65 * tuck;
      this.rightLeg.pivot.rotation.x = 0.9 * tuck;
      this.leftLeg.joint.rotation.x = 1.2 * tuck;
      this.rightLeg.joint.rotation.x = 1.6 * tuck;
    }
    if (p.defenseAction === 'swipe') {
      const reach = Math.sin(Math.min(1, p.defenseElapsedSec / 0.32) * Math.PI);
      this.body.rotation.x = 0.18 + reach * 0.25;
      this.rightArm.pivot.rotation.set(-0.65 - reach * 0.55, reach * 1.25, 0.35);
      this.rightArm.joint.rotation.x = -0.08;
      this.leftArm.pivot.rotation.x = 0.3;
      this.leftLeg.joint.rotation.x = 0.25;
      this.rightLeg.joint.rotation.x = 0.28;
    } else if (p.defenseAction === 'jump') {
      this.body.position.y = air.y;
      this.leftArm.pivot.rotation.set(-2.9, 0, -0.15);
      this.rightArm.pivot.rotation.set(-Math.PI, 0, 0.15);
      this.leftArm.joint.rotation.x = 0; this.rightArm.joint.rotation.x = 0;
      this.leftLeg.joint.rotation.x = 0.75 * air.progress;
      this.rightLeg.joint.rotation.x = 0.95 * air.progress;
    }
    this.contest.visible = !isAttacker && showBlockEligibleRing;
    (this.ring.material as THREE.MeshBasicMaterial).opacity = isAttacker ? 0.85 : 0.4;
    this.ring.scale.setScalar(p.streetMove ? 1.25 : 1);
    // Rings track feet on the floor, even while the body is airborne.
  }
  public dispose(): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.root.traverse(o => {
      if (o instanceof THREE.Mesh) {
        geometries.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
      }
    });
    geometries.forEach(g => g.dispose());
    materials.forEach(m => {
      if (m instanceof THREE.MeshBasicMaterial) m.map?.dispose();
      m.dispose();
    });
    this.nameTexture.dispose();
  }

}
