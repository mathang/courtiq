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
  private disposed = false;
  private initialized = false;
  private rotation = Math.PI;
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
          if (m.name === "Jersey" || m.name === "TeamAccent")
            m.color.setHex(slot === 0 ? 0xffbd2d : 0x29c6de);
          if (m.name === "JerseyPrint") {
            m.opacity = 1;
            m.map = this.texture;
            m.polygonOffset = true;
            m.polygonOffsetFactor = -1;
            m.needsUpdate = true;
          }
        });
        this.body.add(avatar);
        this.root.add(this.body);
        this.rig = new StreetballRig(avatar, this.body);
        this.fallback?.dispose();
        if (this.fallback) this.root.remove(this.fallback.root);
        this.fallback = null;
        this.ring = this.floorRing(
          0.37,
          0.405,
          slot === 0 ? 0xffbd2d : 0x29c6de,
        );
        this.contest = this.floorRing(0.53, 0.56, 0x34d399);
        this.contest.visible = false;
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
    ctx.clearRect(0, 0, 1024, 1024);
    const ink = this.slot === 0 ? "#111e36" : "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const [x, back] of [
      [256, false],
      [768, true],
    ] as const) {
      ctx.fillStyle = ink;
      const label = back ? name.toLocaleUpperCase() : "COURTIQ";
      let size = back ? 72 : 64;
      do {
        ctx.font = `900 ${size}px "Arial",sans-serif`;
        size -= 2;
      } while (ctx.measureText(label).width > 466 && size > 16);
      ctx.fillText(label, x, back ? 115 : 130, 466);
      ctx.font = '900 540px "Arial",sans-serif';
      ctx.lineWidth = 13;
      ctx.strokeStyle = this.slot === 0 ? "#fff5db" : "#12213b";
      ctx.strokeText(this.slot === 0 ? "9" : "5", x, 520);
      ctx.fillText(this.slot === 0 ? "9" : "5", x, 520);
      ctx.font = '700 26px "Arial",sans-serif';
      ctx.fillText(back ? "STREETBALL" : "SPX  •  ATHLETICS", x, 890, 450);
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
    if (!this.initialized || this.root.position.distanceTo(target) > 3.5)
      this.root.position.copy(target);
    else
      this.root.position.lerp(target, 1 - Math.exp(-params.realDeltaSec * 32));
    this.initialized = true;
    const delta = Math.atan2(
      Math.sin(p.facingAngle - this.rotation),
      Math.cos(p.facingAngle - this.rotation),
    );
    this.rotation += delta * (1 - Math.exp(-params.presentationDeltaSec * 25));
    // Dunks use the exact shared facing angle to keep the palm on the authoritative ball.
    this.body.rotation.set(
      0,
      p.finishKind === "dunk" ? p.facingAngle : this.rotation,
      0,
    );
    this.body.position.set(0, air.y, 0);
    this.rig?.update(
      p,
      params.isAttacker,
      params.presentationDeltaSec,
      params.ballPosition,
    );
    this.contest.visible = !params.isAttacker && params.showBlockEligibleRing;
    this.ring.material.opacity = params.isAttacker ? 0.85 : 0.38;
    this.ring.scale.setScalar(p.streetMove ? 1.2 : 1);
  }
  /** A world-space contact point for asset verification, never used to decide game outcomes. */
  public getPalmPosition(): THREE.Vector3 | null {
    return this.rig?.palm.clone() ?? null;
  }
  public dispose(): void {
    this.disposed = true;
    this.fallback?.dispose();
    this.ownedMaterials.forEach((m) => m.dispose());
    this.texture.dispose();
    for (const ring of [this.ring, this.contest]) {
      ring?.geometry.dispose();
      ring?.material.dispose();
    }
    this.root.clear();
  }
}
