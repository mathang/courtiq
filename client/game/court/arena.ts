import * as THREE from 'three';
import { COURT_GEOMETRY } from '../../../shared/config/balance';
import type { MatchPhase } from '../../../shared/rules/matchStateMachine';

/**
 * Builds the 3D floodlit twilight university streetball amphitheater:
 * - High-definition 2048x2048 rock-maple court floor with multi-tone planks, staggered joints,
 *   painted two-tone lane, crisp 6.75m 3PT arc, restricted arc, and CourtIQ crest
 * - Pro overhang stanchion set safely behind the baseline (z = -7.38, zero lane/dunk clipping),
 *   spring-damped breakaway rim flex, backboard vibration, LED perimeter strip, and woven cord net
 * - Twilight sky dome, campus skyline silhouettes, steel/mesh court enclosure, 4 stadium floodlight
 *   towers with volumetric halos, and reframed SPX101 banners + Jumbotron positioned clear of #hud-top
 * - Articulated 4-part instanced streetwear spectators (torso, shoulders/arms, legs, head)
 */
export class CourtIqArena3D {
  public readonly group = new THREE.Group();

  private backboardPivot = new THREE.Group();
  private rimPivot = new THREE.Group();
  private ledBorderMat: THREE.MeshStandardMaterial;

  private netMesh: THREE.Mesh;
  private netWireMesh: THREE.Mesh;
  private netGeometry: THREE.CylinderGeometry;
  private netBasePositions: Float32Array;
  private netSwishTimer = 0;

  private rimFlexTimer = 0;
  private rimFlexStrength = 0;
  private boardFlashTimer = 0;
  private boardFlashMode: 'basket' | 'block' | null = null;

  private scoreboardCanvas: HTMLCanvasElement;
  private scoreboardCtx: CanvasRenderingContext2D;
  private scoreboardTexture: THREE.CanvasTexture;
  private lastScoreboardSignature = '';

  private crowdGroup = new THREE.Group();
  private crowdTorso: THREE.InstancedMesh | null = null;
  private crowdShoulders: THREE.InstancedMesh | null = null;
  private crowdLegs: THREE.InstancedMesh | null = null;
  private crowdHead: THREE.InstancedMesh | null = null;
  private crowdCount = 0;
  private crowdBaseMatrices: Array<{
    x: number;
    y: number;
    z: number;
    rotY: number;
    phase: number;
    standing: boolean;
  }> = [];
  private crowdCheerTimer = 0;

  constructor(lowQuality = false) {
    // 0. Atmospheric twilight sky dome & distant campus skyline
    this.buildSkyDomeAndSkyline();

    // 1. Hardwood court floor + apron
    const courtTex = this.createCourtFloorTexture();
    const floorGeo = new THREE.PlaneGeometry(18.4, 16.8);
    const floorMat = new THREE.MeshStandardMaterial({
      map: courtTex,
      roughness: 0.24,
      metalness: 0.08,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.set(0, 0, 0.4);
    floorMesh.receiveShadow = true;
    this.group.add(floorMesh);

    // Asphalt / rubberized rooftop court deck surround
    const hallFloorGeo = new THREE.PlaneGeometry(54, 46);
    const hallFloorMat = new THREE.MeshStandardMaterial({
      color: 0x0d1829,
      roughness: 0.82,
      metalness: 0.06,
    });
    const hallFloor = new THREE.Mesh(hallFloorGeo, hallFloorMat);
    hallFloor.rotation.x = -Math.PI / 2;
    hallFloor.position.set(0, -0.02, 0);
    hallFloor.receiveShadow = true;
    this.group.add(hallFloor);

    // Raised court deck curb trim
    const curbMat = new THREE.MeshStandardMaterial({
      color: 0xfdb913,
      roughness: 0.45,
      metalness: 0.25,
    });
    const frontCurb = new THREE.Mesh(
      new THREE.BoxGeometry(18.44, 0.035, 0.09),
      curbMat
    );
    frontCurb.position.set(0, 0.005, 8.8);
    this.group.add(frontCurb);

    // 2. Pro Overhang Hoop Stanchion, LED Backboard, Breakaway Rim & Woven Net
    const hoopGroup = new THREE.Group();
    const postMat = new THREE.MeshStandardMaterial({
      color: 0x15253d,
      roughness: 0.35,
      metalness: 0.65,
    });
    const padMat = new THREE.MeshStandardMaterial({
      color: 0x004b87,
      roughness: 0.58,
      metalness: 0.08,
    });
    const goldTrimMat = new THREE.MeshStandardMaterial({
      color: 0xfdb913,
      roughness: 0.35,
      metalness: 0.4,
    });

    // Pro base pad & angled stanchion safely behind baseline (z = -7.38; front face z = -6.95,
    // 0.75m behind playable minZ = -6.2 so baseline drives & dunks NEVER clip!)
    const basePad = new THREE.Mesh(
      new THREE.BoxGeometry(0.86, 2.05, 0.86),
      padMat
    );
    basePad.position.set(0, 1.025, -7.38);
    basePad.castShadow = true;
    basePad.receiveShadow = true;
    hoopGroup.add(basePad);

    const padStripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.88, 0.09, 0.88),
      goldTrimMat
    );
    padStripe.position.set(0, 1.88, -7.38);
    hoopGroup.add(padStripe);

    const verticalPost = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 3.55, 0.3),
      postMat
    );
    verticalPost.position.set(0, 1.78, -7.36);
    verticalPost.castShadow = true;
    hoopGroup.add(verticalPost);

    // Angled overhang truss boom reaching cleanly over the baseline to the backboard
    const diagonalBoom = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.22, 1.42),
      postMat
    );
    diagonalBoom.position.set(0, 3.12, -6.78);
    diagonalBoom.rotation.x = 0.52;
    diagonalBoom.castShadow = true;
    hoopGroup.add(diagonalBoom);

    const upperBoom = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.2, 1.24),
      postMat
    );
    upperBoom.position.set(0, 3.44, -6.24);
    upperBoom.castShadow = true;
    hoopGroup.add(upperBoom);

    const supportStrutL = new THREE.Mesh(
      new THREE.CylinderGeometry(0.032, 0.032, 1.18, 8),
      postMat
    );
    supportStrutL.position.set(-0.46, 3.24, -6.12);
    supportStrutL.rotation.x = Math.PI / 2 - 0.18;
    supportStrutL.rotation.z = -0.35;
    hoopGroup.add(supportStrutL);

    const supportStrutR = supportStrutL.clone();
    supportStrutR.position.x = 0.46;
    supportStrutR.rotation.z = 0.35;
    hoopGroup.add(supportStrutR);

    // Backboard assembly pivot (allows subtle impact vibration on slams/blocks)
    this.backboardPivot.position.set(
      COURT_GEOMETRY.hoopX,
      3.38,
      COURT_GEOMETRY.backboardZ
    );
    hoopGroup.add(this.backboardPivot);

    const boardTex = this.createBackboardTexture();
    const backboard = new THREE.Mesh(
      new THREE.BoxGeometry(1.82, 1.08, 0.046),
      new THREE.MeshStandardMaterial({
        map: boardTex,
        transparent: true,
        opacity: 0.92,
        roughness: 0.12,
        metalness: 0.16,
      })
    );
    backboard.castShadow = true;
    this.backboardPivot.add(backboard);

    // Bottom safety padding along lower edge of backboard
    const boardBottomPad = new THREE.Mesh(
      new THREE.BoxGeometry(1.85, 0.075, 0.075),
      padMat
    );
    boardBottomPad.position.set(0, -0.54, 0);
    this.backboardPivot.add(boardBottomPad);

    // Emissive arena LED strip framing the backboard perimeter
    this.ledBorderMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.45,
      roughness: 0.25,
    });
    const topLed = new THREE.Mesh(
      new THREE.BoxGeometry(1.86, 0.034, 0.056),
      this.ledBorderMat
    );
    topLed.position.set(0, 0.555, 0);
    this.backboardPivot.add(topLed);

    for (const side of [-1, 1]) {
      const sideLed = new THREE.Mesh(
        new THREE.BoxGeometry(0.034, 1.12, 0.056),
        this.ledBorderMat
      );
      sideLed.position.set(side * 0.92, 0, 0);
      this.backboardPivot.add(sideLed);
    }

    // Breakaway orange rim hinged at (0, 3.05, -5.48) with torus center at exact (0, 3.05, -5.25)
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0xff5722,
      roughness: 0.26,
      metalness: 0.68,
    });
    const hingeZ = COURT_GEOMETRY.hoopZ - COURT_GEOMETRY.rimRadiusM;
    this.rimPivot.position.set(
      COURT_GEOMETRY.hoopX,
      COURT_GEOMETRY.hoopY,
      hingeZ
    );
    hoopGroup.add(this.rimPivot);

    const rimBracket = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.08, 0.14),
      rimMat
    );
    rimBracket.position.set(0, -0.02, -0.05);
    this.rimPivot.add(rimBracket);

    const rimOffsetZ = COURT_GEOMETRY.hoopZ - hingeZ;
    const rimTorus = new THREE.Mesh(
      new THREE.TorusGeometry(COURT_GEOMETRY.rimRadiusM, 0.017, 14, 32),
      rimMat
    );
    rimTorus.rotation.x = Math.PI / 2;
    rimTorus.position.set(0, 0, rimOffsetZ);
    rimTorus.castShadow = true;
    this.rimPivot.add(rimTorus);

    // Pro tapered hourglass diamond-cord net attached to rimPivot
    this.netGeometry = new THREE.CylinderGeometry(
      COURT_GEOMETRY.rimRadiusM * 0.98,
      0.135,
      0.45,
      18,
      7,
      true
    );
    const posAttr = this.netGeometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < posAttr.count; i++) {
      const bx = posAttr.getX(i);
      const by = posAttr.getY(i);
      const bz = posAttr.getZ(i);
      const depth = (0.225 - by) / 0.45;
      // Subtle pro hourglass pinch at 72% depth then slight bottom flare
      const pinch = 1 - Math.sin(Math.min(1, depth * 1.15) * Math.PI) * 0.14;
      posAttr.setXYZ(i, bx * pinch, by, bz * pinch);
    }
    posAttr.needsUpdate = true;
    this.netBasePositions = new Float32Array(posAttr.array);

    const netCordTex = this.createNetCordTexture();
    const netSurfaceMat = new THREE.MeshBasicMaterial({
      map: netCordTex,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.netMesh = new THREE.Mesh(this.netGeometry, netSurfaceMat);
    this.netMesh.position.set(0, -0.225, rimOffsetZ);
    this.rimPivot.add(this.netMesh);

    const netWireMat = new THREE.MeshBasicMaterial({
      color: 0xf8fafc,
      wireframe: true,
      transparent: true,
      opacity: 0.34,
    });
    this.netWireMesh = new THREE.Mesh(this.netGeometry, netWireMat);
    this.netWireMesh.position.set(0, -0.225, rimOffsetZ);
    this.rimPivot.add(this.netWireMesh);

    this.group.add(hoopGroup);

    // 3. Twilight Streetball Enclosure, Stadium Floodlight Towers, Banners & Scoreboard
    this.buildStreetballEnclosureAndTowers();

    this.scoreboardCanvas = document.createElement('canvas');
    this.scoreboardCanvas.width = 512;
    this.scoreboardCanvas.height = 192;
    this.scoreboardCtx = this.scoreboardCanvas.getContext('2d')!;
    this.scoreboardTexture = new THREE.CanvasTexture(this.scoreboardCanvas);
    this.scoreboardTexture.colorSpace = THREE.SRGBColorSpace;

    // Positioned at y = 3.72 so the full Jumbotron stays 100% visible below #hud-top!
    const jumbotronFrame = new THREE.Mesh(
      new THREE.BoxGeometry(4.8, 1.44, 0.24),
      new THREE.MeshStandardMaterial({
        color: 0x091322,
        roughness: 0.38,
        metalness: 0.68,
      })
    );
    jumbotronFrame.position.set(0, 3.72, -8.12);
    this.group.add(jumbotronFrame);

    const jumbotronScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(4.56, 1.26),
      new THREE.MeshBasicMaterial({ map: this.scoreboardTexture })
    );
    jumbotronScreen.position.set(0, 3.72, -7.99);
    this.group.add(jumbotronScreen);

    this.updateScoreboard({
      p0Name: 'PLAYER 1',
      p1Name: 'COURTBOT',
      score0: 0,
      score1: 0,
      shotClockSec: 15,
      attackerSlot: 0,
      onFire: false,
      comboCount: 0,
    });

    // 4. Bleachers & Articulated Multi-Part Instanced Crowd
    this.group.add(this.crowdGroup);
    this.buildBleacherBenches();
    this.buildArticulatedCrowd(lowQuality ? 18 : 52);
  }

  public setQualityMode(lowQuality: boolean): void {
    this.disposeCrowdMeshes();
    this.buildArticulatedCrowd(lowQuality ? 18 : 52);
  }

  private disposeCrowdMeshes(): void {
    for (const mesh of [
      this.crowdTorso,
      this.crowdShoulders,
      this.crowdLegs,
      this.crowdHead,
    ]) {
      if (mesh) {
        this.crowdGroup.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
    }
    this.crowdTorso = null;
    this.crowdShoulders = null;
    this.crowdLegs = null;
    this.crowdHead = null;
  }

  public triggerNetSwish(isDunk = false): void {
    this.netSwishTimer = isDunk ? 0.92 : 0.75;
    this.crowdCheerTimer = isDunk ? 2.1 : 1.6;
    this.boardFlashTimer = 1.1;
    this.boardFlashMode = 'basket';
    if (isDunk) {
      this.rimFlexTimer = 0.85;
      this.rimFlexStrength = 1.0;
    }
  }

  public triggerRimFlex(
    strength = 0.65,
    flashMode: 'basket' | 'block' | null = null
  ): void {
    this.rimFlexTimer = 0.72;
    this.rimFlexStrength = Math.max(0.2, Math.min(1.1, strength));
    if (flashMode) {
      this.boardFlashTimer = 0.9;
      this.boardFlashMode = flashMode;
    }
    this.crowdCheerTimer = Math.max(this.crowdCheerTimer, 1.4);
  }

  public triggerCrowdExcitement(): void {
    this.crowdCheerTimer = 1.5;
  }

  public updateScoreboard(params: {
    p0Name: string;
    p1Name: string;
    score0: number;
    score1: number;
    shotClockSec: number;
    attackerSlot: 0 | 1;
    onFire?: boolean;
    comboCount?: number;
  }): void {
    const fireFlag = params.onFire ? '1' : '0';
    const combo = params.comboCount ?? 0;
    const sig = `${params.p0Name}|${params.p1Name}|${params.score0}|${params.score1}|${params.shotClockSec}|${params.attackerSlot}|${fireFlag}|${combo}`;
    if (sig === this.lastScoreboardSignature) {
      return;
    }
    this.lastScoreboardSignature = sig;

    const ctx = this.scoreboardCtx;
    ctx.fillStyle = '#06101f';
    ctx.fillRect(0, 0, 512, 192);

    ctx.strokeStyle = params.onFire ? '#ff6b00' : '#fdb913';
    ctx.lineWidth = 5;
    ctx.strokeRect(6, 6, 500, 180);

    // Header
    ctx.fillStyle = params.onFire ? '#ff8c38' : '#fdb913';
    ctx.font = '900 19px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      params.onFire
        ? '🔥 STREET FLOW ON FIRE • SPX101 DUEL 🔥'
        : combo >= 2
          ? `⚡ ${combo}x TRICK CHAIN • COURTIQ ARENA ⚡`
          : 'COURTIQ STREETBALL • SPX101 DUEL',
      256,
      33
    );

    // Player 0 (Home Gold)
    ctx.fillStyle = params.attackerSlot === 0 ? '#fdb913' : '#94a3b8';
    ctx.font = 'bold 21px system-ui, sans-serif';
    ctx.fillText(
      `${params.attackerSlot === 0 ? '🏀 ' : ''}${params.p0Name.toUpperCase().slice(0, 10)}`,
      114,
      74
    );
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 64px monospace';
    ctx.fillText(String(params.score0).padStart(2, '0'), 114, 148);

    // Shot clock center
    ctx.fillStyle = '#0f2038';
    ctx.fillRect(204, 54, 104, 114);
    ctx.strokeStyle = params.shotClockSec <= 4 ? '#ef4444' : '#38bdf8';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(204, 54, 104, 114);
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText('SHOT CLOCK', 256, 76);
    ctx.fillStyle = params.shotClockSec <= 4 ? '#ef4444' : '#38bdf8';
    ctx.font = 'bold 48px monospace';
    ctx.fillText(String(params.shotClockSec).padStart(2, '0'), 256, 138);

    // Player 1 (Away Cyan)
    ctx.fillStyle = params.attackerSlot === 1 ? '#38bdf8' : '#94a3b8';
    ctx.font = 'bold 21px system-ui, sans-serif';
    ctx.fillText(
      `${params.attackerSlot === 1 ? '🏀 ' : ''}${params.p1Name.toUpperCase().slice(0, 10)}`,
      398,
      74
    );
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 64px monospace';
    ctx.fillText(String(params.score1).padStart(2, '0'), 398, 148);

    this.scoreboardTexture.needsUpdate = true;
  }

  public update(
    deltaSec: number,
    nowSec: number,
    reducedMotion: boolean,
    context?: {
      phase?: MatchPhase;
      shotClockSec?: number;
      onFire?: boolean;
    }
  ): void {
    // Update backboard LED perimeter color & intensity
    if (this.boardFlashTimer > 0) {
      this.boardFlashTimer = Math.max(0, this.boardFlashTimer - deltaSec);
    }
    const phase = context?.phase ?? 'Possession';
    const shotClock = context?.shotClockSec ?? 15;
    const onFire = context?.onFire ?? false;

    if (this.boardFlashTimer > 0 && this.boardFlashMode === 'basket') {
      this.ledBorderMat.color.setHex(0xfdb913);
      this.ledBorderMat.emissive.setHex(0xfdb913);
      this.ledBorderMat.emissiveIntensity = 1.25;
    } else if (
      (this.boardFlashTimer > 0 && this.boardFlashMode === 'block') ||
      (phase === 'Possession' && shotClock <= 4)
    ) {
      this.ledBorderMat.color.setHex(0xef4444);
      this.ledBorderMat.emissive.setHex(0xef4444);
      this.ledBorderMat.emissiveIntensity = 1.1;
    } else if (phase === 'QuestionReady' || phase === 'Duel') {
      this.ledBorderMat.color.setHex(0x38bdf8);
      this.ledBorderMat.emissive.setHex(0x38bdf8);
      this.ledBorderMat.emissiveIntensity = 0.95;
    } else if (onFire) {
      this.ledBorderMat.color.setHex(0xff6b00);
      this.ledBorderMat.emissive.setHex(0xff6b00);
      this.ledBorderMat.emissiveIntensity = 0.85;
    } else {
      this.ledBorderMat.color.setHex(0x38bdf8);
      this.ledBorderMat.emissive.setHex(0x38bdf8);
      this.ledBorderMat.emissiveIntensity = 0.35;
    }

    // Dynamic breakaway rim flex & backboard shudder
    if (this.rimFlexTimer > 0) {
      this.rimFlexTimer = Math.max(0, this.rimFlexTimer - deltaSec);
      if (reducedMotion) {
        this.rimPivot.rotation.x = 0;
        this.backboardPivot.rotation.set(0, 0, 0);
      } else {
        const elapsed = 0.85 - this.rimFlexTimer;
        const decay = Math.exp(-elapsed * 6.2) * (this.rimFlexTimer / 0.85);
        const downSnap =
          Math.max(0, Math.sin(elapsed * 26)) * 0.22 * this.rimFlexStrength * decay +
          Math.sin(elapsed * 34) * 0.045 * this.rimFlexStrength * decay;
        this.rimPivot.rotation.x = downSnap;
        this.backboardPivot.rotation.z =
          Math.sin(elapsed * 44) * 0.014 * this.rimFlexStrength * decay;
        this.backboardPivot.rotation.x =
          Math.cos(elapsed * 38) * 0.01 * this.rimFlexStrength * decay;
      }
    } else {
      this.rimPivot.rotation.x = 0;
      this.backboardPivot.rotation.set(0, 0, 0);
    }

    // Animate net whip & ripple when swished or dunked
    if (this.netSwishTimer > 0) {
      this.netSwishTimer = Math.max(0, this.netSwishTimer - deltaSec);
      const posAttr = this.netGeometry.attributes
        .position as THREE.BufferAttribute;
      const intensity = Math.min(1, this.netSwishTimer / 0.75);
      for (let i = 0; i < posAttr.count; i++) {
        const bx = this.netBasePositions[i * 3];
        const by = this.netBasePositions[i * 3 + 1];
        const bz = this.netBasePositions[i * 3 + 2];
        const depthFactor = Math.max(0, (0.225 - by) / 0.45);
        const flare =
          1 +
          Math.sin(nowSec * 28 - depthFactor * 4.4) *
            0.52 *
            intensity *
            depthFactor;
        const kickUp =
          Math.max(0, Math.sin(nowSec * 22)) * 0.09 * intensity * depthFactor;
        posAttr.setXYZ(i, bx * flare, by + kickUp, bz * flare);
      }
      posAttr.needsUpdate = true;
    }

    if (this.crowdCheerTimer > 0) {
      this.crowdCheerTimer = Math.max(0, this.crowdCheerTimer - deltaSec);
    }

    if (
      !reducedMotion &&
      this.crowdTorso &&
      this.crowdShoulders &&
      this.crowdLegs &&
      this.crowdHead
    ) {
      const dummy = new THREE.Object3D();
      const excited = this.crowdCheerTimer > 0 || onFire;
      const cheerBoost = excited ? 3.2 : 1.0;
      const amp = excited ? 0.13 : 0.024;

      for (let i = 0; i < this.crowdCount; i++) {
        const c = this.crowdBaseMatrices[i];
        const wave = Math.sin(nowSec * 2.6 * cheerBoost + c.phase);
        const bob = Math.abs(wave) * amp * (c.standing ? 1.25 : 0.85);
        const sway = wave * (excited ? 0.07 : 0.02);

        // Legs remain grounded on bleacher/deck
        dummy.position.set(c.x, c.y - 0.24, c.z);
        dummy.rotation.set(0, c.rotY, 0);
        dummy.scale.set(1, c.standing ? 1.15 : 0.86, 1);
        dummy.updateMatrix();
        this.crowdLegs.setMatrixAt(i, dummy.matrix);

        // Torso / hoodie
        dummy.position.set(c.x, c.y + 0.12 + bob * 0.75, c.z);
        dummy.rotation.set(0, c.rotY + sway, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        this.crowdTorso.setMatrixAt(i, dummy.matrix);

        // Shoulders / cheering arms bar
        const armRaise = excited ? 0.08 + Math.abs(wave) * 0.14 : 0;
        dummy.position.set(c.x, c.y + 0.24 + bob + armRaise, c.z);
        dummy.rotation.set(0, c.rotY + sway, wave * (excited ? 0.18 : 0.03));
        dummy.scale.set(1, excited ? 1.25 : 1, 1);
        dummy.updateMatrix();
        this.crowdShoulders.setMatrixAt(i, dummy.matrix);

        // Head
        dummy.position.set(c.x, c.y + 0.46 + bob * 1.05, c.z);
        dummy.rotation.set(0, c.rotY + sway * 0.6, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        this.crowdHead.setMatrixAt(i, dummy.matrix);
      }
      this.crowdLegs.instanceMatrix.needsUpdate = true;
      this.crowdTorso.instanceMatrix.needsUpdate = true;
      this.crowdShoulders.instanceMatrix.needsUpdate = true;
      this.crowdHead.instanceMatrix.needsUpdate = true;
    }
  }

  private buildSkyDomeAndSkyline(): void {
    const skyCanvas = document.createElement('canvas');
    skyCanvas.width = 64;
    skyCanvas.height = 512;
    const ctx = skyCanvas.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0.0, '#040914');
    grad.addColorStop(0.36, '#0b1b36');
    grad.addColorStop(0.56, '#163259');
    grad.addColorStop(0.68, '#2b4d70');
    grad.addColorStop(0.75, '#4c5368');
    grad.addColorStop(0.82, '#132238');
    grad.addColorStop(1.0, '#07101f');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 512);

    const skyTex = new THREE.CanvasTexture(skyCanvas);
    skyTex.colorSpace = THREE.SRGBColorSpace;
    const skyDome = new THREE.Mesh(
      new THREE.SphereGeometry(50, 24, 16),
      new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false })
    );
    this.group.add(skyDome);

    // Distant campus & urban skyline silhouettes around the perimeter
    const skylineMat = new THREE.MeshBasicMaterial({
      color: 0x0a1628,
      fog: true,
    });
    const windowGlowMat = new THREE.MeshBasicMaterial({
      color: 0xfde68a,
      transparent: true,
      opacity: 0.35,
    });
    const blocks: Array<[number, number, number, number, number]> = [
      [-18, -19, 5.2, 11.5, 4.2],
      [-11.5, -21, 6.4, 14.2, 4.5],
      [-4.2, -22, 5.8, 10.4, 4.0],
      [3.8, -21.5, 6.2, 15.0, 4.4],
      [11.6, -20.5, 5.6, 12.2, 4.2],
      [18.2, -18.5, 5.0, 9.8, 4.2],
      [-21, -9, 4.4, 10.6, 5.8],
      [21, -9, 4.4, 11.4, 5.8],
    ];
    for (const [bx, bz, bw, bh, bd] of blocks) {
      const bldg = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), skylineMat);
      bldg.position.set(bx, bh * 0.5 - 0.5, bz);
      this.group.add(bldg);

      const litStrip = new THREE.Mesh(
        new THREE.PlaneGeometry(bw * 0.62, 0.28),
        windowGlowMat
      );
      litStrip.position.set(bx, bh * 0.72, bz + bd * 0.51);
      if (Math.abs(bx) > 19) {
        litStrip.position.set(
          bx + (bx < 0 ? bd * 0.51 : -bd * 0.51),
          bh * 0.72,
          bz
        );
        litStrip.rotation.y = bx < 0 ? Math.PI / 2 : -Math.PI / 2;
      }
      this.group.add(litStrip);
    }
  }

  private buildStreetballEnclosureAndTowers(): void {
    const steelMat = new THREE.MeshStandardMaterial({
      color: 0x111d30,
      roughness: 0.45,
      metalness: 0.65,
    });
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x0e1d34,
      roughness: 0.76,
    });

    // Architectural low concrete & steel court wall behind baseline (y = 0..2.3m)
    const baseWall = new THREE.Mesh(
      new THREE.BoxGeometry(23.2, 2.2, 0.36),
      wallMat
    );
    baseWall.position.set(0, 1.1, -8.35);
    baseWall.receiveShadow = true;
    this.group.add(baseWall);

    const wallCap = new THREE.Mesh(
      new THREE.BoxGeometry(23.3, 0.09, 0.44),
      new THREE.MeshStandardMaterial({
        color: 0xfdb913,
        roughness: 0.4,
        metalness: 0.3,
      })
    );
    wallCap.position.set(0, 2.22, -8.35);
    this.group.add(wallCap);

    // Semi-transparent architectural chain-link mesh fence above wall (y = 2.25..5.25m)
    const fenceTex = this.createChainLinkTexture();
    const fenceMat = new THREE.MeshBasicMaterial({
      map: fenceTex,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const backFence = new THREE.Mesh(new THREE.PlaneGeometry(22.6, 3.1), fenceMat);
    backFence.position.set(0, 3.78, -8.32);
    this.group.add(backFence);

    // Vertical steel fence posts along back enclosure
    for (const px of [-11.2, -7.8, -3.6, 0, 3.6, 7.8, 11.2]) {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.065, 0.075, 5.4, 8),
        steelMat
      );
      post.position.set(px, 2.7, -8.32);
      this.group.add(post);
    }
    const topRail = new THREE.Mesh(
      new THREE.BoxGeometry(22.6, 0.09, 0.1),
      steelMat
    );
    topRail.position.set(0, 5.34, -8.32);
    this.group.add(topRail);

    // SPX101 Course Banners hung cleanly on the steel court fence at y = 3.55 (100% below #hud-top!)
    const bannerTitles = [
      { text: 'VALIDITY', sub: 'TRUE SCORE', x: -6.75, color: '#004b87' },
      { text: 'RELIABILITY', sub: 'CONSISTENCY', x: -4.25, color: '#0d3b66' },
      { text: 'SPECIFICITY', sub: 'TASK DEMANDS', x: 4.25, color: '#0d3b66' },
      { text: 'SENSITIVITY', sub: 'DETECT CHANGE', x: 6.75, color: '#004b87' },
    ];

    for (const b of bannerTitles) {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 320;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = b.color;
      ctx.fillRect(0, 0, 256, 320);
      ctx.strokeStyle = '#fdb913';
      ctx.lineWidth = 10;
      ctx.strokeRect(8, 8, 240, 304);
      ctx.fillStyle = '#fdb913';
      ctx.font = '900 28px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('SPX101', 128, 66);
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 27px system-ui, sans-serif';
      ctx.fillText(b.text, 128, 166);
      ctx.fillStyle = '#93c5fd';
      ctx.font = '800 19px system-ui, sans-serif';
      ctx.fillText(b.sub, 128, 222);

      const bannerTex = new THREE.CanvasTexture(c);
      bannerTex.colorSpace = THREE.SRGBColorSpace;
      const bannerMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1.42, 1.62),
        new THREE.MeshBasicMaterial({ map: bannerTex })
      );
      bannerMesh.position.set(b.x, 3.22, -8.14);
      this.group.add(bannerMesh);
    }

    // 4 Stadium Floodlight Towers with volumetric glow sprites
    const glowTex = this.createFloodlightGlowTexture();
    const towerCoords: Array<[number, number, number]> = [
      [-10.4, -8.35, 0.55],
      [10.4, -8.35, -0.55],
      [-11.4, 5.8, 2.2],
      [11.4, 5.8, -2.2],
    ];

    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff7ed });
    for (const [tx, tz, yaw] of towerCoords) {
      const tower = new THREE.Group();
      tower.position.set(tx, 0, tz);
      tower.rotation.y = yaw;

      const mast = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11, 0.18, 9.2, 10),
        steelMat
      );
      mast.position.y = 4.6;
      tower.add(mast);

      const headRig = new THREE.Mesh(
        new THREE.BoxGeometry(1.75, 0.62, 0.26),
        steelMat
      );
      headRig.position.set(0, 9.15, 0.12);
      headRig.rotation.x = 0.42;
      tower.add(headRig);

      for (const lx of [-0.55, 0, 0.55]) {
        const lamp = new THREE.Mesh(
          new THREE.PlaneGeometry(0.42, 0.36),
          lampMat
        );
        lamp.position.set(lx, 9.08, 0.27);
        lamp.rotation.x = 0.42;
        tower.add(lamp);
      }

      const halo = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTex,
          color: tz < 0 ? 0xffe4b5 : 0xbae6fd,
          transparent: true,
          opacity: 0.62,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      halo.position.set(0, 9.05, 0.35);
      halo.scale.set(5.4, 5.4, 1);
      tower.add(halo);

      this.group.add(tower);
    }
  }

  private buildBleacherBenches(): void {
    const bleacherMat = new THREE.MeshStandardMaterial({
      color: 0x162742,
      roughness: 0.62,
      metalness: 0.2,
    });
    const seatWoodMat = new THREE.MeshStandardMaterial({
      color: 0xb87d3e,
      roughness: 0.45,
    });

    for (const side of [-1, 1]) {
      for (let tier = 0; tier < 2; tier++) {
        const x = side * (9.0 + tier * 0.98);
        const h = 0.42 + tier * 0.44;
        const bench = new THREE.Mesh(
          new THREE.BoxGeometry(0.88, h, 11.8),
          bleacherMat
        );
        bench.position.set(x, h * 0.5, -0.2);
        bench.receiveShadow = true;
        this.group.add(bench);

        const plank = new THREE.Mesh(
          new THREE.BoxGeometry(0.76, 0.06, 11.82),
          seatWoodMat
        );
        plank.position.set(x, h + 0.02, -0.2);
        this.group.add(plank);
      }
    }
  }

  private buildArticulatedCrowd(targetCrowdCount: number): void {
    this.crowdCount = targetCrowdCount;
    this.crowdBaseMatrices = [];

    const torsoGeo = new THREE.BoxGeometry(0.36, 0.46, 0.24);
    const shouldersGeo = new THREE.BoxGeometry(0.52, 0.18, 0.22);
    const legsGeo = new THREE.BoxGeometry(0.32, 0.38, 0.26);
    const headGeo = new THREE.SphereGeometry(0.135, 10, 10);

    const clothMat = new THREE.MeshStandardMaterial({
      roughness: 0.68,
      color: 0xffffff,
    });
    const pantsMat = new THREE.MeshStandardMaterial({
      roughness: 0.8,
      color: 0x1e293b,
    });
    const skinMat = new THREE.MeshStandardMaterial({
      roughness: 0.52,
      color: 0xffffff,
    });

    this.crowdTorso = new THREE.InstancedMesh(torsoGeo, clothMat, this.crowdCount);
    this.crowdShoulders = new THREE.InstancedMesh(
      shouldersGeo,
      clothMat.clone(),
      this.crowdCount
    );
    this.crowdLegs = new THREE.InstancedMesh(legsGeo, pantsMat, this.crowdCount);
    this.crowdHead = new THREE.InstancedMesh(headGeo, skinMat, this.crowdCount);

    const streetwearPalette = [
      new THREE.Color(0x004b87), // UniSC Navy hoodie
      new THREE.Color(0xfdb913), // Varsity Gold jersey
      new THREE.Color(0x1e293b), // Charcoal crewneck
      new THREE.Color(0xe2e8f0), // Heather grey tee
      new THREE.Color(0x0284c7), // Ocean blue jacket
      new THREE.Color(0xbe123c), // Crimson streetwear
      new THREE.Color(0x0f766e), // Deep teal hoodie
      new THREE.Color(0x334155), // Slate bomber
    ];
    const skinTones = [
      new THREE.Color(0xf1c27d),
      new THREE.Color(0xe0ac69),
      new THREE.Color(0xc68642),
      new THREE.Color(0x8d5524),
      new THREE.Color(0xffdbac),
    ];

    const dummy = new THREE.Object3D();
    for (let i = 0; i < this.crowdCount; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const tier = i % 4 < 2 ? 0 : 1;
      const standing = tier === 1 && i % 3 === 0;
      const rowProgress = (i / Math.max(1, this.crowdCount - 1)) * 10.8 - 5.5;
      const x = side * (8.98 + tier * 0.98);
      const y = (standing ? 0.88 : 0.72) + tier * 0.44;
      const z = rowProgress;
      const rotY =
        (side < 0 ? Math.PI / 2 : -Math.PI / 2) +
        Math.atan2(-5.25 - z, Math.abs(x)) * (side < 0 ? -0.35 : 0.35);

      this.crowdBaseMatrices.push({
        x,
        y,
        z,
        rotY,
        phase: i * 0.83,
        standing,
      });

      const shirtColor = streetwearPalette[i % streetwearPalette.length];
      const sleeveColor =
        streetwearPalette[(i + (i % 2 === 0 ? 0 : 2)) % streetwearPalette.length];
      const skinColor = skinTones[i % skinTones.length];

      dummy.position.set(x, y - 0.24, z);
      dummy.rotation.set(0, rotY, 0);
      dummy.scale.set(1, standing ? 1.15 : 0.86, 1);
      dummy.updateMatrix();
      this.crowdLegs.setMatrixAt(i, dummy.matrix);

      dummy.position.set(x, y + 0.12, z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      this.crowdTorso.setMatrixAt(i, dummy.matrix);
      this.crowdTorso.setColorAt(i, shirtColor);

      dummy.position.set(x, y + 0.24, z);
      dummy.updateMatrix();
      this.crowdShoulders.setMatrixAt(i, dummy.matrix);
      this.crowdShoulders.setColorAt(i, sleeveColor);

      dummy.position.set(x, y + 0.46, z);
      dummy.updateMatrix();
      this.crowdHead.setMatrixAt(i, dummy.matrix);
      this.crowdHead.setColorAt(i, skinColor);
    }

    for (const mesh of [
      this.crowdLegs,
      this.crowdTorso,
      this.crowdShoulders,
      this.crowdHead,
    ]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.crowdGroup.add(mesh);
    }
  }

  private createCourtFloorTexture(): THREE.CanvasTexture {
    const S = 2048;
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext('2d')!;

    // Outer apron (Deep UniSC Navy with subtle architectural border)
    ctx.fillStyle = '#091d36';
    ctx.fillRect(0, 0, S, S);

    const toPxX = (wx: number) => ((wx + 9.2) / 18.4) * S;
    const toPxZ = (wz: number) => ((wz + 8.0) / 16.8) * S;
    const scaleX = S / 18.4;
    const scaleZ = S / 16.8;

    const courtLeft = toPxX(-7.5);
    const courtRight = toPxX(7.5);
    const courtTop = toPxZ(-6.5);
    const courtBottom = toPxZ(7.5);
    const courtW = courtRight - courtLeft;
    const courtH = courtBottom - courtTop;

    // Gold outer court accent frame on apron
    ctx.strokeStyle = 'rgba(253, 185, 19, 0.42)';
    ctx.lineWidth = 4;
    ctx.strokeRect(courtLeft - 14, courtTop - 14, courtW + 28, courtH + 28);

    // Rich rock-maple hardwood planks inside playable court
    ctx.save();
    ctx.beginPath();
    ctx.rect(courtLeft, courtTop, courtW, courtH);
    ctx.clip();

    ctx.fillStyle = '#d89b52';
    ctx.fillRect(courtLeft, courtTop, courtW, courtH);

    const plankCount = 68;
    const plankW = courtW / plankCount;
    const tones = [
      '#dda45f',
      '#d2944c',
      '#e2ab68',
      '#c98b44',
      '#d99d56',
      '#e5b271',
      '#cf9049',
    ];
    for (let i = 0; i < plankCount; i++) {
      const px = courtLeft + i * plankW;
      ctx.fillStyle = tones[(i * 5 + (i % 3)) % tones.length];
      ctx.fillRect(px, courtTop, plankW - 1.2, courtH);

      // Subtle staggered horizontal board end-joints & woodgrain streaks
      const segs = 5;
      const offset = ((i * 37) % 100) / 100;
      ctx.strokeStyle = 'rgba(84, 48, 16, 0.18)';
      ctx.lineWidth = 1.5;
      for (let s = 1; s < segs; s++) {
        const jy = courtTop + (((s + offset) % segs) / segs) * courtH;
        ctx.beginPath();
        ctx.moveTo(px, jy);
        ctx.lineTo(px + plankW, jy);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255, 238, 205, 0.06)';
      ctx.fillRect(px + plankW * 0.25, courtTop, plankW * 0.22, courtH);
    }

    // Subtle two-tone perimeter stain inside 3PT arc vs outside
    const hoopPxX = toPxX(COURT_GEOMETRY.hoopX);
    const hoopPxZ = toPxZ(COURT_GEOMETRY.hoopZ);
    const arcRadiusPx = COURT_GEOMETRY.threePointRadiusM * ((scaleX + scaleZ) * 0.5);
    ctx.fillStyle = 'rgba(255, 224, 172, 0.08)';
    ctx.beginPath();
    ctx.arc(hoopPxX, hoopPxZ, arcRadiusPx, 0, Math.PI * 2);
    ctx.fill();

    // Center-court original CourtIQ streetball medallion
    const crestZ = toPxZ(3.35);
    ctx.fillStyle = 'rgba(0, 75, 135, 0.20)';
    ctx.beginPath();
    ctx.arc(toPxX(0), crestZ, 2.15 * scaleX, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(253, 185, 19, 0.52)';
    ctx.lineWidth = 10;
    ctx.stroke();
    ctx.fillStyle = 'rgba(253, 185, 19, 0.26)';
    ctx.font = '900 74px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('COURTIQ', toPxX(0), crestZ - 14);
    ctx.font = '800 32px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.fillText('STREETBALL • SPX101', toPxX(0), crestZ + 44);

    // Painted Key / Lane (4.9m wide, baseline z=-6.5 to free-throw line z=-0.65)
    const keyLeft = toPxX(-2.45);
    const keyRight = toPxX(2.45);
    const keyTop = toPxZ(-6.5);
    const keyBottom = toPxZ(-0.65);
    const keyGrad = ctx.createLinearGradient(0, keyTop, 0, keyBottom);
    keyGrad.addColorStop(0, 'rgba(0, 62, 118, 0.92)');
    keyGrad.addColorStop(1, 'rgba(0, 88, 158, 0.86)');
    ctx.fillStyle = keyGrad;
    ctx.fillRect(keyLeft, keyTop, keyRight - keyLeft, keyBottom - keyTop);

    // Subtle gold inner lane accent border & hash marks
    ctx.strokeStyle = 'rgba(253, 185, 19, 0.65)';
    ctx.lineWidth = 4;
    ctx.strokeRect(
      keyLeft + 10,
      keyTop + 10,
      keyRight - keyLeft - 20,
      keyBottom - keyTop - 20
    );

    // Lane block hash marks along the key
    ctx.fillStyle = '#ffffff';
    for (const hz of [-4.7, -3.7, -2.7, -1.7]) {
      const py = toPxZ(hz);
      ctx.fillRect(keyLeft - 18, py - 4, 18, 8);
      ctx.fillRect(keyRight, py - 4, 18, 8);
    }

    // Three-point arc (6.75m radius around hoop (0, -5.25))
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(hoopPxX, hoopPxZ, arcRadiusPx, 0.16 * Math.PI, 0.84 * Math.PI);
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
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(hoopPxX, hoopPxZ, 1.25 * scaleX, 0, Math.PI);
    ctx.stroke();

    // Key border & court boundary lines
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 10;
    ctx.strokeRect(keyLeft, keyTop, keyRight - keyLeft, keyBottom - keyTop);
    ctx.lineWidth = 12;
    ctx.strokeRect(courtLeft, courtTop, courtW, courtH);

    ctx.restore();

    // Baseline branding text split cleanly left & right of the center overhang stanchion
    ctx.fillStyle = '#fdb913';
    ctx.font = '900 44px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('COURTIQ STREETBALL', S * 0.275, courtTop - 38);
    ctx.fillText('SPX101 DUEL ARENA', S * 0.725, courtTop - 38);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }

  private createBackboardTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 300;
    const ctx = canvas.getContext('2d')!;

    const glassGrad = ctx.createLinearGradient(0, 0, 512, 300);
    glassGrad.addColorStop(0, 'rgba(216, 238, 255, 0.28)');
    glassGrad.addColorStop(0.48, 'rgba(255, 255, 255, 0.14)');
    glassGrad.addColorStop(1, 'rgba(186, 224, 255, 0.26)');
    ctx.fillStyle = glassGrad;
    ctx.fillRect(0, 0, 512, 300);

    // Subtle diagonal specular reflection streak on tempered glass
    ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.beginPath();
    ctx.moveTo(70, 0);
    ctx.lineTo(155, 0);
    ctx.lineTo(65, 300);
    ctx.lineTo(-20, 300);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 12;
    ctx.strokeRect(8, 8, 496, 284);

    // Crisp shooter's square
    ctx.strokeStyle = '#fdb913';
    ctx.lineWidth = 9;
    ctx.strokeRect(176, 130, 160, 120);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private createNetCordTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, 256, 256);

    ctx.strokeStyle = 'rgba(248, 250, 252, 0.92)';
    ctx.lineWidth = 4.2;
    const cells = 12;
    const step = 256 / cells;
    for (let i = -cells; i <= cells * 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * step, 0);
      ctx.lineTo((i + cells * 0.55) * step, 256);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(i * step, 0);
      ctx.lineTo((i - cells * 0.55) * step, 256);
      ctx.stroke();
    }

    // Top red/white/blue streetball loop knots near rim collar
    ctx.fillStyle = 'rgba(253, 185, 19, 0.9)';
    ctx.fillRect(0, 0, 256, 10);

    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }

  private createChainLinkTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, 128, 128);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.42)';
    ctx.lineWidth = 2;
    for (let i = -128; i <= 256; i += 16) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 128, 128);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i - 128, 128);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(22, 4);
    return tex;
  }

  private createFloodlightGlowTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    g.addColorStop(0, 'rgba(255, 252, 240, 0.95)');
    g.addColorStop(0.25, 'rgba(253, 224, 171, 0.48)');
    g.addColorStop(0.6, 'rgba(56, 189, 248, 0.14)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }
}
