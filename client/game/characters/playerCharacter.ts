import * as THREE from 'three';
import { PlayerSimState } from '../../../shared/rules/matchStateMachine';
import { PlayerSlot } from '../../../shared/rules/possession';

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
    label: 'Style A (Gold Band • Fade)',
    skinHex: 0x8d5524,
    hairHex: 0x1a1512,
    headbandHex: 0xfdb913,
    hairStyle: 'fade',
  },
  {
    id: 1,
    label: 'Style B (Cyan Band • Ponytail)',
    skinHex: 0xe0ac69,
    hairHex: 0x3b2314,
    headbandHex: 0x38bdf8,
    hairStyle: 'ponytail',
  },
  {
    id: 2,
    label: 'Style C (White Band • Afro)',
    skinHex: 0x5c3818,
    hairHex: 0x14110f,
    headbandHex: 0xf8fafc,
    hairStyle: 'afro',
  },
  {
    id: 3,
    label: 'Style D (Navy Band • Short Crop)',
    skinHex: 0xf1c27d,
    hairHex: 0x6e4720,
    headbandHex: 0x004b87,
    hairStyle: 'short',
  },
];

export class PlayerCharacter3D {
  public readonly root = new THREE.Group();
  private readonly bodyGroup = new THREE.Group();
  private readonly leftArm: THREE.Group;
  private readonly rightArm: THREE.Group;
  private readonly leftLeg: THREE.Group;
  private readonly rightLeg: THREE.Group;
  private readonly floorRing: THREE.Mesh;
  private readonly blockEligibleRing: THREE.Mesh;

  private animPhase = 0;
  private currentPresetId = -1;
  private readonly slot: PlayerSlot;

  constructor(slot: PlayerSlot, appearancePreset = 0) {
    this.slot = slot;
    this.currentPresetId = appearancePreset;

    const preset =
      APPEARANCE_PRESETS[appearancePreset % APPEARANCE_PRESETS.length] ??
      APPEARANCE_PRESETS[0];

    const jerseyPrimary = slot === 0 ? 0xfdb913 : 0x00a8e8;
    const jerseyTrim = slot === 0 ? 0x002647 : 0x082f49;
    const jerseyNumber = slot === 0 ? '9' : '5';

    const skinMat = new THREE.MeshStandardMaterial({
      color: preset.skinHex,
      roughness: 0.55,
    });
    const shortsMat = new THREE.MeshStandardMaterial({
      color: jerseyTrim,
      roughness: 0.6,
    });
    const shoeMat = new THREE.MeshStandardMaterial({
      color: slot === 0 ? 0xffffff : 0x1e293b,
      roughness: 0.4,
    });

    // Jersey torso with procedural number texture
    const jerseyTex = this.createJerseyTexture(
      slot === 0 ? '#fdb913' : '#00a8e8',
      slot === 0 ? '#002647' : '#ffffff',
      jerseyNumber
    );
    const torsoMat = new THREE.MeshStandardMaterial({
      map: jerseyTex,
      roughness: 0.5,
    });
    const torso = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.62, 0.28),
      torsoMat
    );
    torso.position.set(0, 1.16, 0);
    torso.castShadow = true;
    this.bodyGroup.add(torso);

    // Shorts / pelvis
    const shorts = new THREE.Mesh(
      new THREE.BoxGeometry(0.44, 0.28, 0.27),
      shortsMat
    );
    shorts.position.set(0, 0.72, 0);
    this.bodyGroup.add(shorts);

    // Head & Hair & Headband
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 1.66, 0);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 14, 14),
      skinMat
    );
    headGroup.add(head);

    const headband = new THREE.Mesh(
      new THREE.CylinderGeometry(0.186, 0.186, 0.055, 16),
      new THREE.MeshStandardMaterial({ color: preset.headbandHex, roughness: 0.4 })
    );
    headband.position.set(0, 0.06, 0);
    headGroup.add(headband);

    const hairMat = new THREE.MeshStandardMaterial({
      color: preset.hairHex,
      roughness: 0.8,
    });
    if (preset.hairStyle === 'afro') {
      const hair = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 12, 12),
        hairMat
      );
      hair.position.set(0, 0.08, -0.02);
      headGroup.add(hair);
    } else if (preset.hairStyle === 'ponytail') {
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(0.184, 12, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
        hairMat
      );
      headGroup.add(cap);
      const tail = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 10, 10),
        hairMat
      );
      tail.position.set(0, 0.05, -0.2);
      headGroup.add(tail);
    } else {
      const topHair = new THREE.Mesh(
        new THREE.BoxGeometry(0.26, 0.1, 0.26),
        hairMat
      );
      topHair.position.set(0, 0.15, 0);
      headGroup.add(topHair);
    }

    this.bodyGroup.add(headGroup);

    // Articulated Arms
    this.leftArm = this.buildArm(skinMat, jerseyPrimary, -0.3);
    this.rightArm = this.buildArm(skinMat, jerseyPrimary, 0.3);
    this.bodyGroup.add(this.leftArm);
    this.bodyGroup.add(this.rightArm);

    // Articulated Legs
    this.leftLeg = this.buildLeg(skinMat, shortsMat, shoeMat, -0.13);
    this.rightLeg = this.buildLeg(skinMat, shortsMat, shoeMat, 0.13);
    this.bodyGroup.add(this.leftLeg);
    this.bodyGroup.add(this.rightLeg);

    this.root.add(this.bodyGroup);

    // Tactical floor indicator ring
    this.floorRing = new THREE.Mesh(
      new THREE.RingGeometry(0.46, 0.56, 28),
      new THREE.MeshBasicMaterial({
        color: jerseyPrimary,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.78,
      })
    );
    this.floorRing.rotation.x = -Math.PI / 2;
    this.floorRing.position.y = 0.015;
    this.root.add(this.floorRing);

    // Defender "BLOCK AVAILABLE" outer glowing contest ring
    this.blockEligibleRing = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.74, 32),
      new THREE.MeshBasicMaterial({
        color: 0x10b981,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
      })
    );
    this.blockEligibleRing.rotation.x = -Math.PI / 2;
    this.blockEligibleRing.position.y = 0.02;
    this.blockEligibleRing.visible = false;
    this.root.add(this.blockEligibleRing);
  }

  private buildArm(
    skinMat: THREE.Material,
    shoulderHex: number,
    offsetX: number
  ): THREE.Group {
    const g = new THREE.Group();
    g.position.set(offsetX, 1.42, 0);

    const shoulder = new THREE.Mesh(
      new THREE.SphereGeometry(0.085, 8, 8),
      new THREE.MeshStandardMaterial({ color: shoulderHex, roughness: 0.5 })
    );
    g.add(shoulder);

    const arm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.05, 0.52, 8),
      skinMat
    );
    arm.position.set(0, -0.26, 0);
    g.add(arm);

    return g;
  }

  private buildLeg(
    skinMat: THREE.Material,
    shortsMat: THREE.Material,
    shoeMat: THREE.Material,
    offsetX: number
  ): THREE.Group {
    const g = new THREE.Group();
    g.position.set(offsetX, 0.64, 0);

    const thigh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.095, 0.08, 0.3, 8),
      shortsMat
    );
    thigh.position.set(0, -0.15, 0);
    g.add(thigh);

    const calf = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.06, 0.34, 8),
      skinMat
    );
    calf.position.set(0, -0.42, 0);
    g.add(calf);

    const shoe = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.1, 0.26),
      shoeMat
    );
    shoe.position.set(0, -0.59, 0.05);
    g.add(shoe);

    return g;
  }

  private createJerseyTexture(
    bgHex: string,
    textHex: string,
    numStr: string
  ): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = bgHex;
    ctx.fillRect(0, 0, 256, 256);

    ctx.strokeStyle = textHex;
    ctx.lineWidth = 14;
    ctx.strokeRect(10, 10, 236, 236);

    ctx.fillStyle = textHex;
    ctx.font = 'bold 136px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(numStr, 128, 138);

    return new THREE.CanvasTexture(canvas);
  }

  public update(params: {
    sim: PlayerSimState;
    isAttacker: boolean;
    showBlockEligibleRing: boolean;
    presentationDeltaSec: number;
  }): void {
    const { sim, isAttacker, showBlockEligibleRing, presentationDeltaSec } =
      params;

    this.root.position.set(sim.x, 0, sim.z);
    this.bodyGroup.rotation.y = sim.facingAngle;

    // Floor tactical rings
    const ringMat = this.floorRing.material as THREE.MeshBasicMaterial;
    ringMat.opacity = isAttacker ? 0.92 : 0.45;
    this.floorRing.scale.setScalar(isAttacker ? 1.08 : 0.92);

    this.blockEligibleRing.visible = !isAttacker && showBlockEligibleRing;

    // Advance character animation using presentationDeltaSec (respects slow motion!)
    this.animPhase += presentationDeltaSec * (sim.isSprinting ? 14 : 9.5);

    if (sim.animState === 'run' || sim.animState === 'dribble') {
      const swing = Math.sin(this.animPhase) * 0.55;
      this.leftLeg.rotation.x = swing;
      this.rightLeg.rotation.x = -swing;
      this.leftArm.rotation.x = -swing * 0.7;

      if (sim.animState === 'dribble') {
        // Right arm pumps the dribble
        this.rightArm.rotation.x =
          -0.65 + Math.sin(this.animPhase * 1.6) * 0.45;
      } else {
        this.rightArm.rotation.x = swing * 0.7;
      }
      this.bodyGroup.position.y = Math.abs(Math.sin(this.animPhase)) * 0.06;
    } else if (sim.animState === 'shoot') {
      // Jump-shot release pose
      this.leftLeg.rotation.x = 0.12;
      this.rightLeg.rotation.x = -0.12;
      this.rightArm.rotation.x = -2.45; // Follow-through high toward basket
      this.leftArm.rotation.x = -1.75;  // Guide hand up
      this.bodyGroup.position.y = 0.34;
    } else if (sim.animState === 'block') {
      // Explosive vertical block contest
      this.leftLeg.rotation.x = -0.15;
      this.rightLeg.rotation.x = 0.15;
      this.rightArm.rotation.x = -2.85;
      this.leftArm.rotation.x = -2.65;
      this.bodyGroup.position.y = 0.48;
    } else if (sim.animState === 'celebrate') {
      const hop = Math.abs(Math.sin(this.animPhase * 1.4)) * 0.24;
      this.bodyGroup.position.y = hop;
      this.leftArm.rotation.x = -2.6;
      this.rightArm.rotation.x = -2.6;
      this.leftLeg.rotation.x = 0;
      this.rightLeg.rotation.x = 0;
    } else {
      // Idle athletic stance
      const breathe = Math.sin(this.animPhase * 0.4) * 0.04;
      this.leftLeg.rotation.x = 0;
      this.rightLeg.rotation.x = 0;
      this.leftArm.rotation.x = -0.22 + breathe;
      this.rightArm.rotation.x = -0.22 - breathe;
      this.bodyGroup.position.y = 0;
    }
  }
}
