import * as THREE from 'three';
import { COURT_GEOMETRY } from '../../../shared/config/balance';

/**
 * Builds the 3D university basketball arena (Section 17 & 20):
 * - Polished maple hardwood floor with procedural canvas markings (key, free-throw circle, 6.75m 3PT arc, CourtIQ crest)
 * - Stanchion, tempered glass backboard, orange rim at (0, 3.05, -5.25), and ripple-animated net
 * - Electronic arena scoreboard above the baseline updated dynamically via CanvasTexture
 * - Instanced bench/bleacher crowd characters (THREE.InstancedMesh) scaled by quality mode
 */
export class CourtIqArena3D {
  public readonly group = new THREE.Group();
  private netMesh: THREE.Mesh;
  private netGeometry: THREE.CylinderGeometry;
  private netBasePositions: Float32Array;
  private netSwishTimer = 0;

  private scoreboardCanvas: HTMLCanvasElement;
  private scoreboardCtx: CanvasRenderingContext2D;
  private scoreboardTexture: THREE.CanvasTexture;
  private lastScoreboardSignature = '';

  private crowdInstancedBody: THREE.InstancedMesh | null = null;
  private crowdInstancedHead: THREE.InstancedMesh | null = null;
  private crowdCount = 0;
  private crowdBaseMatrices: Array<{
    x: number;
    y: number;
    z: number;
    rotY: number;
    phase: number;
  }> = [];
  private crowdCheerTimer = 0;

  constructor(lowQuality = false) {
    // 1. Hardwood court floor + apron
    const courtTex = this.createCourtFloorTexture();
    const floorGeo = new THREE.PlaneGeometry(18.4, 16.8);
    const floorMat = new THREE.MeshStandardMaterial({
      map: courtTex,
      roughness: 0.28,
      metalness: 0.06,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.set(0, 0, 0.4);
    floorMesh.receiveShadow = true;
    this.group.add(floorMesh);

    // Sub-floor surround
    const hallFloorGeo = new THREE.PlaneGeometry(42, 36);
    const hallFloorMat = new THREE.MeshStandardMaterial({
      color: 0x0b1526,
      roughness: 0.75,
    });
    const hallFloor = new THREE.Mesh(hallFloorGeo, hallFloorMat);
    hallFloor.rotation.x = -Math.PI / 2;
    hallFloor.position.set(0, -0.02, 0);
    this.group.add(hallFloor);

    // 2. Hoop Stanchion, Backboard, Rim, and Dynamic Net
    const hoopGroup = new THREE.Group();
    const postMat = new THREE.MeshStandardMaterial({
      color: 0x162944,
      roughness: 0.4,
      metalness: 0.5,
    });

    const basePad = new THREE.Mesh(
      new THREE.BoxGeometry(0.95, 2.1, 0.95),
      new THREE.MeshStandardMaterial({ color: 0x004b87, roughness: 0.6 })
    );
    basePad.position.set(0, 1.05, -6.55);
    hoopGroup.add(basePad);

    const verticalPost = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.16, 3.6, 12),
      postMat
    );
    verticalPost.position.set(0, 1.8, -6.45);
    hoopGroup.add(verticalPost);

    const boomArm = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.22, 1.05),
      postMat
    );
    boomArm.position.set(0, 3.35, -6.05);
    hoopGroup.add(boomArm);

    // Tempered glass backboard with crisp white border & shooter's square
    const boardTex = this.createBackboardTexture();
    const backboard = new THREE.Mesh(
      new THREE.BoxGeometry(1.82, 1.08, 0.05),
      new THREE.MeshStandardMaterial({
        map: boardTex,
        transparent: true,
        opacity: 0.94,
        roughness: 0.15,
        metalness: 0.1,
      })
    );
    backboard.position.set(
      COURT_GEOMETRY.hoopX,
      3.38,
      COURT_GEOMETRY.backboardZ
    );
    hoopGroup.add(backboard);

    // Breakaway orange rim at exact (0, 3.05, -5.25)
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0xff5722,
      roughness: 0.3,
      metalness: 0.6,
    });
    const rimTorus = new THREE.Mesh(
      new THREE.TorusGeometry(COURT_GEOMETRY.rimRadiusM, 0.016, 12, 28),
      rimMat
    );
    rimTorus.rotation.x = Math.PI / 2;
    rimTorus.position.set(
      COURT_GEOMETRY.hoopX,
      COURT_GEOMETRY.hoopY,
      COURT_GEOMETRY.hoopZ
    );
    hoopGroup.add(rimTorus);

    // Procedural dynamic net
    this.netGeometry = new THREE.CylinderGeometry(
      COURT_GEOMETRY.rimRadiusM,
      0.14,
      0.44,
      16,
      6,
      true
    );
    this.netBasePositions = new Float32Array(
      this.netGeometry.attributes.position.array
    );
    const netMat = new THREE.MeshBasicMaterial({
      color: 0xf4f7fb,
      wireframe: true,
      transparent: true,
      opacity: 0.85,
    });
    this.netMesh = new THREE.Mesh(this.netGeometry, netMat);
    this.netMesh.position.set(
      COURT_GEOMETRY.hoopX,
      COURT_GEOMETRY.hoopY - 0.22,
      COURT_GEOMETRY.hoopZ
    );
    hoopGroup.add(this.netMesh);

    this.group.add(hoopGroup);

    // 3. University Sports Hall Architecture & Electronic Scoreboard
    this.buildArenaWallsAndBanners();

    this.scoreboardCanvas = document.createElement('canvas');
    this.scoreboardCanvas.width = 512;
    this.scoreboardCanvas.height = 192;
    this.scoreboardCtx = this.scoreboardCanvas.getContext('2d')!;
    this.scoreboardTexture = new THREE.CanvasTexture(this.scoreboardCanvas);

    const jumbotronFrame = new THREE.Mesh(
      new THREE.BoxGeometry(5.6, 2.2, 0.25),
      new THREE.MeshStandardMaterial({
        color: 0x0a1322,
        roughness: 0.4,
        metalness: 0.6,
      })
    );
    jumbotronFrame.position.set(0, 5.75, -7.85);
    this.group.add(jumbotronFrame);

    const jumbotronScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(5.3, 1.95),
      new THREE.MeshBasicMaterial({ map: this.scoreboardTexture })
    );
    jumbotronScreen.position.set(0, 5.75, -7.71);
    this.group.add(jumbotronScreen);

    this.updateScoreboard({
      p0Name: 'PLAYER 1',
      p1Name: 'COURTBOT',
      score0: 0,
      score1: 0,
      shotClockSec: 15,
      attackerSlot: 0,
    });

    // 4. Bleachers & Instanced Crowd
    this.buildBleachersAndCrowd(lowQuality ? 16 : 44);
  }

  public setQualityMode(lowQuality: boolean): void {
    if (this.crowdInstancedBody) {
      this.group.remove(this.crowdInstancedBody);
    }
    if (this.crowdInstancedHead) {
      this.group.remove(this.crowdInstancedHead);
    }
    this.buildBleachersAndCrowd(lowQuality ? 16 : 44);
  }

  public triggerNetSwish(): void {
    this.netSwishTimer = 0.75;
    this.crowdCheerTimer = 1.6;
  }

  public triggerCrowdExcitement(): void {
    this.crowdCheerTimer = 1.4;
  }

  public updateScoreboard(params: {
    p0Name: string;
    p1Name: string;
    score0: number;
    score1: number;
    shotClockSec: number;
    attackerSlot: 0 | 1;
  }): void {
    const sig = `${params.p0Name}|${params.p1Name}|${params.score0}|${params.score1}|${params.shotClockSec}|${params.attackerSlot}`;
    if (sig === this.lastScoreboardSignature) {
      return;
    }
    this.lastScoreboardSignature = sig;

    const ctx = this.scoreboardCtx;
    ctx.fillStyle = '#071120';
    ctx.fillRect(0, 0, 512, 192);

    ctx.strokeStyle = '#fdb913';
    ctx.lineWidth = 5;
    ctx.strokeRect(6, 6, 500, 180);

    // Header
    ctx.fillStyle = '#fdb913';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('COURTIQ UNIVERSITY ARENA • 1v1 DUEL', 256, 34);

    // Player 0 (Home Gold)
    ctx.fillStyle = params.attackerSlot === 0 ? '#fdb913' : '#94a3b8';
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.fillText(
      `${params.attackerSlot === 0 ? '🏀 ' : ''}${params.p0Name.toUpperCase().slice(0, 10)}`,
      115,
      74
    );
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 64px monospace';
    ctx.fillText(String(params.score0).padStart(2, '0'), 115, 148);

    // Shot clock center
    ctx.fillStyle = '#112238';
    ctx.fillRect(204, 56, 104, 112);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.strokeRect(204, 56, 104, 112);
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillText('SHOT CLOCK', 256, 78);
    ctx.fillStyle = params.shotClockSec <= 4 ? '#ef4444' : '#38bdf8';
    ctx.font = 'bold 48px monospace';
    ctx.fillText(String(params.shotClockSec).padStart(2, '0'), 256, 138);

    // Player 1 (Away Cyan)
    ctx.fillStyle = params.attackerSlot === 1 ? '#38bdf8' : '#94a3b8';
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.fillText(
      `${params.attackerSlot === 1 ? '🏀 ' : ''}${params.p1Name.toUpperCase().slice(0, 10)}`,
      397,
      74
    );
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 64px monospace';
    ctx.fillText(String(params.score1).padStart(2, '0'), 397, 148);

    this.scoreboardTexture.needsUpdate = true;
  }

  public update(deltaSec: number, nowSec: number, reducedMotion: boolean): void {
    // Animate net ripple when swished
    if (this.netSwishTimer > 0) {
      this.netSwishTimer = Math.max(0, this.netSwishTimer - deltaSec);
      const posAttr = this.netGeometry.attributes
        .position as THREE.BufferAttribute;
      const intensity = this.netSwishTimer / 0.75;
      for (let i = 0; i < posAttr.count; i++) {
        const bx = this.netBasePositions[i * 3];
        const by = this.netBasePositions[i * 3 + 1];
        const bz = this.netBasePositions[i * 3 + 2];
        // Top vertices stay pinned to rim (by near +0.22)
        const depthFactor = Math.max(0, (0.22 - by) / 0.44);
        const flare =
          1 +
          Math.sin(nowSec * 26 - depthFactor * 4) * 0.42 * intensity * depthFactor;
        posAttr.setXYZ(i, bx * flare, by, bz * flare);
      }
      posAttr.needsUpdate = true;
    }

    if (this.crowdCheerTimer > 0) {
      this.crowdCheerTimer = Math.max(0, this.crowdCheerTimer - deltaSec);
    }

    if (
      !reducedMotion &&
      this.crowdInstancedBody &&
      this.crowdInstancedHead
    ) {
      const dummy = new THREE.Object3D();
      const cheerBoost = this.crowdCheerTimer > 0 ? 3.5 : 1.0;
      const amp = this.crowdCheerTimer > 0 ? 0.16 : 0.035;

      for (let i = 0; i < this.crowdCount; i++) {
        const c = this.crowdBaseMatrices[i];
        const bob = Math.abs(Math.sin(nowSec * 2.8 * cheerBoost + c.phase)) * amp;
        dummy.position.set(c.x, c.y + bob, c.z);
        dummy.rotation.set(0, c.rotY, 0);
        dummy.updateMatrix();
        this.crowdInstancedBody.setMatrixAt(i, dummy.matrix);

        dummy.position.set(c.x, c.y + 0.48 + bob * 1.15, c.z);
        dummy.updateMatrix();
        this.crowdInstancedHead.setMatrixAt(i, dummy.matrix);
      }
      this.crowdInstancedBody.instanceMatrix.needsUpdate = true;
      this.crowdInstancedHead.instanceMatrix.needsUpdate = true;
    }
  }

  private createCourtFloorTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d')!;

    // Outer apron (Deep UniSC Navy)
    ctx.fillStyle = '#0c223f';
    ctx.fillRect(0, 0, 1024, 1024);

    // Map world X in [-9.2, 9.2] -> [0, 1024], world Z in [-8.0, 8.8] -> [0, 1024]
    const toPxX = (wx: number) => ((wx + 9.2) / 18.4) * 1024;
    const toPxZ = (wz: number) => ((wz + 8.0) / 16.8) * 1024;
    const scaleX = 1024 / 18.4;
    const scaleZ = 1024 / 16.8;

    const courtLeft = toPxX(-7.5);
    const courtRight = toPxX(7.5);
    const courtTop = toPxZ(-6.5);
    const courtBottom = toPxZ(7.5);
    const courtW = courtRight - courtLeft;
    const courtH = courtBottom - courtTop;

    // Warm maple hardwood planks inside playable court
    ctx.save();
    ctx.beginPath();
    ctx.rect(courtLeft, courtTop, courtW, courtH);
    ctx.clip();

    ctx.fillStyle = '#d99b52';
    ctx.fillRect(courtLeft, courtTop, courtW, courtH);

    const plankCount = 46;
    const plankW = courtW / plankCount;
    for (let i = 0; i < plankCount; i++) {
      const shade = i % 3 === 0 ? '#cfa05e' : i % 2 === 0 ? '#dea45d' : '#c9914b';
      ctx.fillStyle = shade;
      ctx.fillRect(courtLeft + i * plankW, courtTop, plankW - 1, courtH);
    }

    // Subtle center court CourtIQ watermark badge
    ctx.fillStyle = 'rgba(0, 75, 135, 0.14)';
    ctx.beginPath();
    ctx.arc(toPxX(0), toPxZ(3.2), 2.1 * scaleX, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(253, 185, 19, 0.28)';
    ctx.lineWidth = 6;
    ctx.stroke();

    // Painted Key / Lane (4.9m wide, from baseline z=-6.5 to free-throw line z=-0.65)
    const keyLeft = toPxX(-2.45);
    const keyRight = toPxX(2.45);
    const keyTop = toPxZ(-6.5);
    const keyBottom = toPxZ(-0.65);
    ctx.fillStyle = 'rgba(0, 75, 135, 0.85)';
    ctx.fillRect(keyLeft, keyTop, keyRight - keyLeft, keyBottom - keyTop);

    // Three-point arc (6.75m radius around hoop (0, -5.25))
    const hoopPxX = toPxX(COURT_GEOMETRY.hoopX);
    const hoopPxZ = toPxZ(COURT_GEOMETRY.hoopZ);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(
      hoopPxX,
      hoopPxZ,
      COURT_GEOMETRY.threePointRadiusM * ((scaleX + scaleZ) * 0.5),
      0.16 * Math.PI,
      0.84 * Math.PI
    );
    ctx.stroke();

    // Corner 3-point straight lines to baseline
    const cornerOffset = 6.6;
    ctx.beginPath();
    ctx.moveTo(toPxX(-cornerOffset), courtTop);
    ctx.lineTo(toPxX(-cornerOffset), toPxZ(-2.3));
    ctx.moveTo(toPxX(cornerOffset), courtTop);
    ctx.lineTo(toPxX(cornerOffset), toPxZ(-2.3));
    ctx.stroke();

    // Free-throw circle
    ctx.beginPath();
    ctx.arc(toPxX(0), keyBottom, 1.8 * scaleX, 0, Math.PI * 2);
    ctx.stroke();

    // Restricted area arc under basket
    ctx.strokeStyle = '#fdb913';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(hoopPxX, hoopPxZ, 1.25 * scaleX, 0, Math.PI);
    ctx.stroke();

    // Key border & court boundary lines
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 5;
    ctx.strokeRect(keyLeft, keyTop, keyRight - keyLeft, keyBottom - keyTop);
    ctx.lineWidth = 6;
    ctx.strokeRect(courtLeft, courtTop, courtW, courtH);

    ctx.restore();

    // Baseline branding text
    ctx.fillStyle = '#fdb913';
    ctx.font = 'bold 28px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('COURTIQ • SPX101 ARENA', 512, courtTop - 16);

    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    return tex;
  }

  private createBackboardTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 300;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = 'rgba(220, 238, 255, 0.24)';
    ctx.fillRect(0, 0, 512, 300);

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 12;
    ctx.strokeRect(8, 8, 496, 284);

    // Shooter's square
    ctx.strokeStyle = '#fdb913';
    ctx.lineWidth = 8;
    ctx.strokeRect(176, 130, 160, 120);

    return new THREE.CanvasTexture(canvas);
  }

  private buildArenaWallsAndBanners(): void {
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x0f1d33,
      roughness: 0.8,
    });
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(26, 9, 0.4), wallMat);
    backWall.position.set(0, 4.5, -8.2);
    this.group.add(backWall);

    // Hanging championship / course banners
    const bannerTitles = [
      { text: 'VALIDITY', sub: 'TRUE SCORE', x: -6.8, color: '#004b87' },
      { text: 'RELIABILITY', sub: 'CONSISTENCY', x: -4.2, color: '#0d3b66' },
      { text: 'SPECIFICITY', sub: 'TASK DEMANDS', x: 4.2, color: '#0d3b66' },
      { text: 'SENSITIVITY', sub: 'DETECT CHANGE', x: 6.8, color: '#004b87' },
    ];

    for (const b of bannerTitles) {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 384;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = b.color;
      ctx.fillRect(0, 0, 256, 384);
      ctx.strokeStyle = '#fdb913';
      ctx.lineWidth = 10;
      ctx.strokeRect(8, 8, 240, 368);
      ctx.fillStyle = '#fdb913';
      ctx.font = 'bold 30px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('SPX101', 128, 80);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 28px system-ui, sans-serif';
      ctx.fillText(b.text, 128, 195);
      ctx.fillStyle = '#93c5fd';
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.fillText(b.sub, 128, 255);

      const bannerMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1.65, 2.45),
        new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c) })
      );
      bannerMesh.position.set(b.x, 5.7, -7.92);
      this.group.add(bannerMesh);
    }
  }

  private buildBleachersAndCrowd(targetCrowdCount: number): void {
    const bleacherMat = new THREE.MeshStandardMaterial({
      color: 0x192b46,
      roughness: 0.7,
    });

    // Left and right sideline bench tiers
    for (const side of [-1, 1]) {
      for (let tier = 0; tier < 2; tier++) {
        const bench = new THREE.Mesh(
          new THREE.BoxGeometry(0.9, 0.45 + tier * 0.45, 11.5),
          bleacherMat
        );
        bench.position.set(
          side * (8.8 + tier * 0.95),
          0.22 + tier * 0.22,
          -0.2
        );
        this.group.add(bench);
      }
    }

    this.crowdCount = targetCrowdCount;
    this.crowdBaseMatrices = [];

    const bodyGeo = new THREE.CylinderGeometry(0.2, 0.24, 0.62, 8);
    const headGeo = new THREE.SphereGeometry(0.16, 8, 8);
    const bodyMat = new THREE.MeshStandardMaterial({
      roughness: 0.6,
      vertexColors: false,
      color: 0xffffff,
    });
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xe0ac69,
      roughness: 0.5,
    });

    this.crowdInstancedBody = new THREE.InstancedMesh(
      bodyGeo,
      bodyMat,
      this.crowdCount
    );
    this.crowdInstancedHead = new THREE.InstancedMesh(
      headGeo,
      headMat,
      this.crowdCount
    );

    const palette = [
      new THREE.Color(0xfdb913),
      new THREE.Color(0x004b87),
      new THREE.Color(0x38bdf8),
      new THREE.Color(0xf43f5e),
      new THREE.Color(0x10b981),
    ];

    const dummy = new THREE.Object3D();
    for (let i = 0; i < this.crowdCount; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const tier = i % 4 < 2 ? 0 : 1;
      const rowProgress = (i / Math.max(1, this.crowdCount - 1)) * 10 - 5.2;
      const x = side * (8.8 + tier * 0.95);
      const y = 0.72 + tier * 0.45;
      const z = rowProgress;
      const rotY = side < 0 ? Math.PI / 2 : -Math.PI / 2;

      this.crowdBaseMatrices.push({
        x,
        y,
        z,
        rotY,
        phase: i * 0.7,
      });

      dummy.position.set(x, y, z);
      dummy.rotation.set(0, rotY, 0);
      dummy.updateMatrix();
      this.crowdInstancedBody.setMatrixAt(i, dummy.matrix);
      this.crowdInstancedBody.setColorAt(i, palette[i % palette.length]);

      dummy.position.set(x, y + 0.48, z);
      dummy.updateMatrix();
      this.crowdInstancedHead.setMatrixAt(i, dummy.matrix);
    }

    this.crowdInstancedBody.instanceMatrix.needsUpdate = true;
    if (this.crowdInstancedBody.instanceColor) {
      this.crowdInstancedBody.instanceColor.needsUpdate = true;
    }
    this.crowdInstancedHead.instanceMatrix.needsUpdate = true;

    this.group.add(this.crowdInstancedBody);
    this.group.add(this.crowdInstancedHead);
  }
}
