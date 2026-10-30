import * as THREE from 'three';
import { COURT_GEOMETRY } from '../../shared/config/balance';
import { MatchPhase, PlayerSimState } from '../../shared/rules/matchStateMachine';
import { Vector3D } from '../../shared/rules/shot';
import { BallVisualController } from './animation/ballTrajectory';
import { CourtCameraController } from './camera/courtCamera';
import { PlayerCharacter3D } from './characters/playerCharacter';
import { CourtIqArena3D } from './court/arena';

export type RenderQualityMode = 'high' | 'low' | 'fallback2d';

export interface RenderFrameState {
  phase: MatchPhase;
  players: [PlayerSimState, PlayerSimState];
  attackerSlot: 0 | 1;
  scores: readonly [number, number];
  shotClockSec: number;
  ballPos: Vector3D;
  blockEligible: boolean;
  reducedMotion: boolean;
}

export class CourtIqRenderer {
  private container: HTMLElement;
  private qualityMode: RenderQualityMode = 'high';
  public webglAvailable = true;

  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private cameraCtrl: CourtCameraController | null = null;
  private arena: CourtIqArena3D | null = null;
  private chars: [PlayerCharacter3D, PlayerCharacter3D] | null = null;
  private ballCtrl: BallVisualController | null = null;

  private fallbackCanvas: HTMLCanvasElement | null = null;
  private fallbackCtx: CanvasRenderingContext2D | null = null;

  private currentPresets: [number, number] = [0, 1];

  constructor(container: HTMLElement) {
    this.container = container;
    this.initWebGLOrFallback();
    window.addEventListener('resize', () => this.handleResize());
  }

  private initWebGLOrFallback(): void {
    try {
      const renderer = new THREE.WebGLRenderer({
        antialias: this.qualityMode === 'high',
        powerPreference: 'high-performance',
      });
      renderer.setPixelRatio(
        this.qualityMode === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, 2)
      );
      renderer.setSize(
        this.container.clientWidth || window.innerWidth,
        this.container.clientHeight || window.innerHeight
      );
      renderer.outputColorSpace = THREE.SRGBColorSpace;

      this.renderer = renderer;
      this.container.innerHTML = '';
      this.container.appendChild(renderer.domElement);

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x091324);
      this.scene.fog = new THREE.FogExp2(0x091324, 0.018);

      // Inexpensive studio arena lighting (Section 20)
      const hemi = new THREE.HemisphereLight(0xf8fafc, 0x1e293b, 1.15);
      this.scene.add(hemi);

      const keyLight = new THREE.DirectionalLight(0xfffbeb, 1.35);
      keyLight.position.set(5, 14, 8);
      this.scene.add(keyLight);

      const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.55);
      rimLight.position.set(-7, 9, -6);
      this.scene.add(rimLight);

      this.cameraCtrl = new CourtCameraController(
        (this.container.clientWidth || window.innerWidth) /
          Math.max(1, this.container.clientHeight || window.innerHeight)
      );

      this.arena = new CourtIqArena3D(this.qualityMode === 'low');
      this.scene.add(this.arena.group);

      this.chars = [
        new PlayerCharacter3D(0, this.currentPresets[0]),
        new PlayerCharacter3D(1, this.currentPresets[1]),
      ];
      this.scene.add(this.chars[0].root);
      this.scene.add(this.chars[1].root);

      this.ballCtrl = new BallVisualController();
      this.scene.add(this.ballCtrl.group);
      this.webglAvailable = true;
    } catch {
      this.webglAvailable = false;
      this.qualityMode = 'fallback2d';
      this.initFallback2D();
    }
  }

  private initFallback2D(): void {
    this.container.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.width = this.container.clientWidth || window.innerWidth;
    canvas.height = this.container.clientHeight || window.innerHeight;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    this.container.appendChild(canvas);
    this.fallbackCanvas = canvas;
    this.fallbackCtx = canvas.getContext('2d');
  }

  public setQualityMode(mode: RenderQualityMode): void {
    if (mode === this.qualityMode) return;
    this.qualityMode = mode;

    if (mode === 'fallback2d' || !this.webglAvailable) {
      if (this.renderer) {
        this.renderer.dispose();
        this.renderer = null;
      }
      this.initFallback2D();
      return;
    }

    if (!this.renderer) {
      this.initWebGLOrFallback();
      return;
    }

    this.renderer.setPixelRatio(
      mode === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, 2)
    );
    this.arena?.setQualityMode(mode === 'low');
  }

  public setPlayerAppearances(preset0: number, preset1: number): void {
    if (
      this.currentPresets[0] === preset0 &&
      this.currentPresets[1] === preset1
    ) {
      return;
    }
    this.currentPresets = [preset0, preset1];
    if (this.scene && this.chars) {
      this.scene.remove(this.chars[0].root);
      this.scene.remove(this.chars[1].root);
      this.chars = [
        new PlayerCharacter3D(0, preset0),
        new PlayerCharacter3D(1, preset1),
      ];
      this.scene.add(this.chars[0].root);
      this.scene.add(this.chars[1].root);
    }
  }

  public triggerBasketCelebration(): void {
    this.arena?.triggerNetSwish();
  }

  public triggerBlockEffect(): void {
    this.arena?.triggerCrowdExcitement();
  }

  public handleResize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;

    if (this.renderer && this.cameraCtrl) {
      this.renderer.setSize(w, h);
      this.cameraCtrl.resize(w, h);
    }
    if (this.fallbackCanvas) {
      this.fallbackCanvas.width = w;
      this.fallbackCanvas.height = h;
    }
  }

  public renderFrame(
    state: RenderFrameState,
    realDeltaSec: number,
    nowSec: number
  ): void {
    // Slow-motion presentation clock scaling during QuestionReady & Duel (Section 9)
    const presentationScale =
      state.phase === 'QuestionReady' || state.phase === 'Duel' ? 0.14 : 1.0;
    const presentationDeltaSec = realDeltaSec * presentationScale;

    if (
      this.qualityMode === 'fallback2d' ||
      !this.webglAvailable ||
      !this.renderer ||
      !this.scene ||
      !this.cameraCtrl ||
      !this.arena ||
      !this.chars ||
      !this.ballCtrl
    ) {
      this.renderFallback2D(state);
      return;
    }

    this.setPlayerAppearances(
      state.players[0].appearancePreset,
      state.players[1].appearancePreset
    );

    this.arena.updateScoreboard({
      p0Name: state.players[0].pseudonym,
      p1Name: state.players[1].pseudonym,
      score0: state.scores[0],
      score1: state.scores[1],
      shotClockSec: state.shotClockSec,
      attackerSlot: state.attackerSlot,
    });
    this.arena.update(realDeltaSec, nowSec, state.reducedMotion);

    this.chars[0].update({
      sim: state.players[0],
      isAttacker: state.attackerSlot === 0,
      showBlockEligibleRing: state.blockEligible,
      presentationDeltaSec,
      realDeltaSec,
    });
    this.chars[1].update({
      sim: state.players[1],
      isAttacker: state.attackerSlot === 1,
      showBlockEligibleRing: state.blockEligible,
      presentationDeltaSec,
      realDeltaSec,
    });

    this.ballCtrl.update({
      pos: state.ballPos,
      phase: state.phase,
      reducedMotion: state.reducedMotion,
      deltaSec: realDeltaSec,
    });

    this.cameraCtrl.update({
      phase: state.phase,
      players: state.players,
      ballPos: state.ballPos,
      reducedMotion: state.reducedMotion,
      deltaSec: realDeltaSec,
    });

    this.renderer.render(this.scene, this.cameraCtrl.camera);
  }

  private renderFallback2D(state: RenderFrameState): void {
    if (!this.fallbackCanvas || !this.fallbackCtx) return;
    const ctx = this.fallbackCtx;
    const w = this.fallbackCanvas.width;
    const h = this.fallbackCanvas.height;

    ctx.fillStyle = '#091324';
    ctx.fillRect(0, 0, w, h);

    const courtSize = Math.min(w * 0.85, h * 0.65);
    const ox = (w - courtSize) * 0.5;
    const oy = h * 0.1;

    ctx.fillStyle = '#c88d48';
    ctx.fillRect(ox, oy, courtSize, courtSize * 0.88);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.strokeRect(ox, oy, courtSize, courtSize * 0.88);

    const toX = (wx: number) => ox + ((wx + 7.5) / 15) * courtSize;
    const toY = (wz: number) => oy + ((wz + 6.5) / 14) * (courtSize * 0.88);

    // 3PT arc
    ctx.beginPath();
    ctx.arc(
      toX(COURT_GEOMETRY.hoopX),
      toY(COURT_GEOMETRY.hoopZ),
      (COURT_GEOMETRY.threePointRadiusM / 15) * courtSize,
      0.15 * Math.PI,
      0.85 * Math.PI
    );
    ctx.stroke();

    // Hoop
    ctx.fillStyle = '#ff5722';
    ctx.beginPath();
    ctx.arc(
      toX(COURT_GEOMETRY.hoopX),
      toY(COURT_GEOMETRY.hoopZ),
      9,
      0,
      Math.PI * 2
    );
    ctx.fill();

    // Players
    for (const slot of [0, 1] as const) {
      const p = state.players[slot];
      const px = toX(p.x);
      const py = toY(p.z);
      ctx.fillStyle = slot === 0 ? '#fdb913' : '#38bdf8';
      ctx.beginPath();
      ctx.arc(px, py, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#091324';
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(p.pseudonym.slice(0, 4), px, py + 4);
    }

    // Ball
    ctx.fillStyle = '#ea580c';
    ctx.beginPath();
    ctx.arc(
      toX(state.ballPos.x),
      toY(state.ballPos.z),
      8 + state.ballPos.y * 1.5,
      0,
      Math.PI * 2
    );
    ctx.fill();

    // Compatibility notice banner
    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      this.webglAvailable
        ? '2D Tactical Court Mode Active (Switch to 3D Arena in Settings)'
        : 'WebGL Unavailable — Running 2D Tactical Court & Question Practice Fallback',
      w * 0.5,
      oy + courtSize * 0.88 + 24
    );
  }
}
