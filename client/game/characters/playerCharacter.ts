import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { PlayerSimState } from "../../../shared/rules/matchStateMachine";
import { PlayerSlot } from "../../../shared/rules/possession";
import { getAirPose } from "../../../shared/rules/streetMoves";
import {
  APPEARANCE_PRESETS,
  LegacyPlayerCharacter3D,
} from "./legacyPlayerCharacter";
import { StreetballRig } from "./streetballRig";
import { smoothMotion } from "../../../shared/rules/motionCurves";
export { APPEARANCE_PRESETS } from "./legacyPlayerCharacter";
export type { AppearancePresetOption } from "./legacyPlayerCharacter";

const ASSET_URL = "/assets/player/streetball-player.glb";
let sharedAsset: Promise<GLTF> | undefined;
const loadAsset = () => (sharedAsset ??= new GLTFLoader().loadAsync(ASSET_URL));
export interface PlayerRenderParams {
  sim: PlayerSimState;
  isAttacker: boolean;
  showBlockEligibleRing: boolean;
  presentationDeltaSec: number;
  realDeltaSec: number;
  ballPosition?: { x: number; y: number; z: number };
  inPlace?: boolean;
}

/** The procedural player stays usable while the single shared GLB loads, or if it fails. */
export class PlayerCharacter3D {
  public readonly root = new THREE.Group();
  public readonly ready: Promise<void>;
  public assetState: "loading" | "ready" | "fallback" = "loading";
  private fallback: LegacyPlayerCharacter3D | null;
  private body = new THREE.Group();
  private rig: StreetballRig | null = null;
  private ring!: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private contest!: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private fireRing!: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private accentMaterial: THREE.MeshStandardMaterial | null = null;
  private auraPulse = 0;
  private shadow: THREE.Mesh<
    THREE.PlaneGeometry,
    THREE.MeshBasicMaterial
  > | null = null;
  private disposed = false;
  private initialized = false;
  private rotation = Math.PI;
  private visualYaw = Math.PI;
  private dunkStartYaw = Math.PI;
  private wasDunk = false;
  private jerseyName = "";
  private readonly canvas = document.createElement("canvas");
  private readonly texture: THREE.CanvasTexture;
  private ownedMaterials: THREE.Material[] = [];
  constructor(
    private slot: PlayerSlot,
    private presetId = 0,
  ) {
    this.canvas.width = 1024;
    this.canvas.height = 1024;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.flipY = false;
    this.texture.anisotropy = 4;
    this.fallback = new LegacyPlayerCharacter3D(slot, presetId);
    this.root.add(this.fallback.root);
    this.ready = loadAsset()
      .then((gltf) => {
        if (this.disposed) return;
        const avatar = clone(gltf.scene);
        avatar.scale.setScalar(1.05);
        const preset =
          APPEARANCE_PRESETS[presetId % 4] ?? APPEARANCE_PRESETS[0];
        avatar.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return;
          o.castShadow = true;
          o.receiveShadow = true;
          o.frustumCulled = false;
          const source = o.material as THREE.MeshStandardMaterial;
          const m = source.clone();
          this.ownedMaterials.push(m);
          o.material = m;
          if (m.name === "Skin")
            m.color
              .setHex(preset.skinHex)
              .lerp(new THREE.Color(0xbc815b), 0.18);
          if (m.name === "Hair") m.color.setHex(preset.hairHex);
          if (m.name === "TeamAccent") {
            m.color.setHex(slot === 0 ? 0xffbd2d : 0x29c6de);
            this.accentMaterial = m;
          }
          if (m.name === "Jersey") {
            m.color.setHex(0xffffff);
            m.map = this.texture;
            m.needsUpdate = true;
          }
        });
        this.body.add(avatar);
        this.root.add(this.body);
        this.rig = new StreetballRig(avatar, this.body, gltf.animations);
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 64;
        const context = canvas.getContext("2d")!,
          gradient = context.createRadialGradient(32, 32, 3, 32, 32, 32);
        gradient.addColorStop(0, "rgba(0,0,0,.7)");
        gradient.addColorStop(0.5, "rgba(0,0,0,.3)");
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        context.fillStyle = gradient;
        context.fillRect(0, 0, 64, 64);
        this.shadow = new THREE.Mesh(
          new THREE.PlaneGeometry(1.2, 0.95),
          new THREE.MeshBasicMaterial({
            map: new THREE.CanvasTexture(canvas),
            transparent: true,
            depthWrite: false,
            opacity: 0.48,
          }),
        );
        this.shadow.rotation.x = -Math.PI / 2;
        this.shadow.position.y = 0.009;
        this.root.add(this.shadow);
        this.fallback?.dispose();
        if (this.fallback) this.root.remove(this.fallback.root);
        this.fallback = null;
        this.ring = this.floorRing(
          0.37,
          0.41,
          slot === 0 ? 0xffbd2d : 0x29c6de,
        );
        this.contest = this.floorRing(0.53, 0.565, 0x34d399);
        this.contest.visible = false;
        this.fireRing = this.floorRing(0.45, 0.515, 0xff6b00);
        this.fireRing.visible = false;
        this.assetState = "ready";
      })
      .catch(() => {
        this.assetState = "fallback";
      });
  }
  private floorRing(inner: number, outer: number, color: number) {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(inner, outer, 48),
      new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.75,
      }),
    );
    mesh.position.y = 0.014;
    mesh.rotation.x = -Math.PI / 2;
    this.root.add(mesh);
    return mesh;
  }
  private printName(name: string): void {
    if (this.jerseyName === name) return;
    this.jerseyName = name;
    const ctx = this.canvas.getContext("2d")!;
    ctx.fillStyle = this.slot === 0 ? "#ffbd2d" : "#29c6de";
    ctx.fillRect(0, 0, 1024, 1024);
    // Subtle woven cloth, baked into the same surface as the name and number.
    ctx.fillStyle = "rgba(255,255,255,.055)";
    for (let y = 0; y < 1024; y += 6) ctx.fillRect(0, y, 1024, 1);
    ctx.fillStyle = "rgba(10,26,45,.035)";
    for (let x = 0; x < 1024; x += 6) ctx.fillRect(x, 0, 1, 1024);
    const ink = this.slot === 0 ? "#111e36" : "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const [x, back] of [
      [256, false],
      [768, true],
    ] as const) {
      ctx.fillStyle = ink;
      const label = back ? name.toLocaleUpperCase() : "COURTIQ";
      let size = back ? 48 : 43;
      do {
        ctx.font = `900 ${size}px "Arial",sans-serif`;
        size -= 2;
      } while (ctx.measureText(label).width > 290 && size > 16);
      ctx.fillText(label, x, back ? 215 : 255, 290);
      ctx.font = '900 340px "Arial",sans-serif';
      ctx.lineWidth = 8;
      ctx.strokeStyle = this.slot === 0 ? "#fff5db" : "#12213b";
      ctx.strokeText(this.slot === 0 ? "9" : "5", x, 570);
      ctx.fillText(this.slot === 0 ? "9" : "5", x, 570);
      ctx.font = '700 20px "Arial",sans-serif';
      ctx.fillText(back ? "STREETBALL" : "SPX  •  ATHLETICS", x, 845, 290);
    }
    this.texture.needsUpdate = true;
  }
  public update(params: PlayerRenderParams): void {
    if (this.disposed) return;
    this.printName(params.sim.pseudonym);
    if (this.fallback) {
      this.fallback.update(params);
      return;
    }
    const { sim: p } = params,
      air = getAirPose(p),
      target = new THREE.Vector3(air.x, 0, air.z);
    const dunk = p.finishKind === "dunk";
    if (dunk && !this.wasDunk) this.dunkStartYaw = this.visualYaw;
    if (!dunk && this.wasDunk) this.rotation = this.visualYaw;
    if (!this.initialized || this.root.position.distanceTo(target) > 3.5) {
      this.root.position.copy(target);
      this.rotation = p.facingAngle;
      this.dunkStartYaw = p.facingAngle;
      this.rig?.resetMotion();
    } else
      this.root.position.lerp(target, 1 - Math.exp(-params.realDeltaSec * 32));
    this.initialized = true;
    const delta = Math.atan2(
      Math.sin(p.facingAngle - this.rotation),
      Math.cos(p.facingAngle - this.rotation),
    );
    const turnDt =
      p.finishKind || p.defenseAction === "jump"
        ? Math.max(params.presentationDeltaSec, params.realDeltaSec)
        : params.presentationDeltaSec;
    this.rotation += delta * (1 - Math.exp(-turnDt * 25));
    // Turn through the gather, preserving the displayed spin/stance at entry.
    const gatherTurn = Math.atan2(
      Math.sin(p.facingAngle - this.dunkStartYaw),
      Math.cos(p.facingAngle - this.dunkStartYaw),
    );
    this.body.rotation.set(
      0,
      dunk
        ? this.dunkStartYaw +
            gatherTurn * smoothMotion(p.finishElapsedSec / 0.18)
        : this.rotation,
      0,
    );
    this.body.position.set(0, air.y, 0);
    this.rig?.update(
      p,
      params.isAttacker,
      params.presentationDeltaSec,
      params.ballPosition,
      { inPlace: params.inPlace },
    );
    this.visualYaw = this.body.rotation.y;
    this.wasDunk = dunk;
    this.contest.visible = !params.isAttacker && params.showBlockEligibleRing;
    this.auraPulse += params.presentationDeltaSec * 7.5;
    const comboGlow = p.onFire || p.trickCombo >= 2;
    this.fireRing.visible = comboGlow;
    if (comboGlow) {
      const pulse = 1 + Math.sin(this.auraPulse) * 0.085;
      this.fireRing.scale.setScalar(pulse * (p.onFire ? 1.12 : 1.0));
      this.fireRing.material.color.setHex(p.onFire ? 0xff6b00 : 0xfdb913);
      this.fireRing.material.opacity = p.onFire ? 0.86 : 0.58;
    }
    if (this.accentMaterial) {
      this.accentMaterial.emissive.setHex(
        p.onFire ? 0xff5500 : p.trickCombo >= 2 ? 0xfdb913 : 0x000000,
      );
      this.accentMaterial.emissiveIntensity = p.onFire
        ? 0.42
        : p.trickCombo >= 2
          ? 0.18
          : 0;
    }
    this.ring.material.opacity = params.isAttacker ? 0.88 : 0.4;
    this.ring.scale.setScalar(p.streetMove ? 1.2 : 1);
    if (this.shadow) {
      this.shadow.scale.setScalar(1 + Math.max(0, air.y) * 0.2);
      this.shadow.material.opacity = 0.34 / (1 + Math.max(0, air.y) * 1.2);
    }
  }
  /** A world-space contact point for asset verification, never used to decide game outcomes. */
  public getPalmPosition(): THREE.Vector3 | null {
    return this.rig?.palm.clone() ?? null;
  }
  public getAnimationState() {
    return this.rig?.animationState() ?? null;
  }
  public consumeFootContacts() {
    return this.rig?.consumeFootContacts() ?? [];
  }
  public dispose(): void {
    this.disposed = true;
    this.rig?.dispose();
    this.shadow?.geometry.dispose();
    this.shadow?.material.map?.dispose();
    this.shadow?.material.dispose();
    this.fallback?.dispose();
    this.ownedMaterials.forEach((m) => m.dispose());
    this.texture.dispose();
    for (const ring of [this.ring, this.contest, this.fireRing]) {
      ring?.geometry.dispose();
      ring?.material.dispose();
    }
    this.root.clear();
  }
}
