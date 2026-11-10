import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PlayerCharacter3D } from "./game/characters/playerCharacter";
import { AuthoritativeMatchEngine } from "../shared/rules/matchStateMachine";
import { BUNDLED_QUESTION_PACKS } from "../content/packRegistry";
import { COURT_GEOMETRY } from "../shared/config/balance";
import { dunkBallPosition, type DunkStyle } from "../shared/rules/dunks";
import { getAirPose } from "../shared/rules/streetMoves";

const host = document.getElementById("player-stage")!;
const status = document.getElementById("asset-status")!;
const engine = new AuthoritativeMatchEngine({
  matchId: "player-lab",
  mode: "solo",
  seed: 7,
  pack: BUNDLED_QUESTION_PACKS[0],
  roomPresetId: "standard",
  sessionLengthId: "quick",
  player0: { id: "preview", pseudonym: "CLARK" },
  player1: { id: "bot", pseudonym: "CourtBot", isAi: true },
});
const sim = engine.players[0];
let team: 0 | 1 = 0,
  look = 0,
  mode = "dribble",
  time = 0,
  manual = false,
  paused = matchMedia("(prefers-reduced-motion: reduce)").matches;
let character = new PlayerCharacter3D(team, look);
const scene = new THREE.Scene();
const stage = new THREE.Group();
stage.position.z = -COURT_GEOMETRY.hoopZ;
scene.add(stage);
stage.add(character.root);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
host.append(renderer.domElement);
const camera = new THREE.PerspectiveCamera(33, 1, 0.1, 60);
camera.position.set(2.7, 1.85, 4.5);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 1, 0);
orbit.enablePan = false;
orbit.enableDamping = true;
orbit.minDistance = 1.3;
orbit.maxDistance = 10;
orbit.maxPolarAngle = Math.PI * 0.51;
orbit.minPolarAngle = 0.25;
const hemi = new THREE.HemisphereLight(0xffffff, 0x8a9173, 2);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff0d6, 3.2);
key.position.set(3, 6, 4);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.left = -3;
key.shadow.camera.right = 3;
key.shadow.camera.top = 5;
key.shadow.camera.bottom = -2;
key.shadow.normalBias = 0.015;
scene.add(key);
const rim = new THREE.DirectionalLight(0xe6f7ff, 2.5);
rim.position.set(-3, 3, -3);
scene.add(rim);
const fill = new THREE.DirectionalLight(0xffffff, 0.5);
fill.position.set(-3, 2, 4);
scene.add(fill);
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(2.5, 96),
  new THREE.ShadowMaterial({ opacity: 0.19 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.018;
floor.receiveShadow = true;
scene.add(floor);
const courtLine = new THREE.Mesh(
  new THREE.RingGeometry(0.95, 0.958, 96),
  new THREE.MeshBasicMaterial({
    color: 0xb7bba8,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.6,
  }),
);
courtLine.rotation.x = -Math.PI / 2;
courtLine.position.y = -0.012;
scene.add(courtLine);
const ball = new THREE.Mesh(
  new THREE.SphereGeometry(0.119, 24, 18),
  new THREE.MeshStandardMaterial({ color: 0xc26926, roughness: 0.95 }),
);
ball.castShadow = true;
stage.add(ball);
for (const axis of [0, 1, 2]) {
  const seam = new THREE.Mesh(
    new THREE.TorusGeometry(0.1197, 0.002, 4, 48),
    new THREE.MeshStandardMaterial({ color: 0x342820, roughness: 1 }),
  );
  if (axis === 1) seam.rotation.y = Math.PI / 2;
  if (axis === 2) seam.rotation.x = Math.PI / 2;
  ball.add(seam);
}
const goal = new THREE.Group();
scene.add(goal);
goal.visible = false;
const hoop = new THREE.Mesh(
  new THREE.TorusGeometry(0.23, 0.018, 10, 48),
  new THREE.MeshStandardMaterial({ color: 0xc55e26 }),
);
hoop.rotation.x = Math.PI / 2;
hoop.position.set(0, 3.17, 0);
goal.add(hoop);
const board = new THREE.Mesh(
  new THREE.BoxGeometry(1.25, 0.73, 0.045),
  new THREE.MeshPhysicalMaterial({
    color: 0xdde5d3,
    roughness: 0.3,
    transparent: true,
    opacity: 0.35,
  }),
);
board.position.set(0, 3.63, 0.49);
goal.add(board);
for (let i = 0; i < 12; i++) {
  const a = (i / 12) * Math.PI * 2,
    pts = [
      new THREE.Vector3(Math.cos(a) * 0.224, 3.16, Math.sin(a) * 0.224),
      new THREE.Vector3(
        Math.cos(a + 0.2) * 0.15,
        2.85,
        Math.sin(a + 0.2) * 0.15,
      ),
    ];
  const rope = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 6, 0.003, 4, false),
    new THREE.MeshStandardMaterial({ color: 0xf9f5e6 }),
  );
  goal.add(rope);
}
const notes: Record<string, string> = {
  dribble: "A low stance, articulated hands and a ball-synced dribble.",
  run: "Bending knees, a lifted swing foot and relaxed arm motion.",
  defend: "A wider base, bent knees and active hands.",
  dunk: "A full gather, airborne finish and controlled landing.",
  block: "Meet the finisher in the air with both arms extended.",
  swipe: "Reach for the ball, then recover before the next move.",
};
function resize() {
  const w = host.clientWidth,
    h = host.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
  render(0);
}
new ResizeObserver(resize).observe(host);
resize();
async function loadCharacter() {
  const current = character;
  await current.ready;
  if (current !== character) return;
  status.textContent =
    current.assetState === "ready"
      ? "YOUR PLAYER IS READY"
      : "SIMPLIFIED PLAYER · RELOAD TO RETRY";
  render(0);
}
function rebuild() {
  const old = character;
  character = new PlayerCharacter3D(team, look);
  stage.add(character.root);
  stage.remove(old.root);
  old.dispose();
  status.textContent = "Changing your look…";
  void loadCharacter();
}
function frameView(view: string) {
  const dunk = mode === "dunk" || mode === "block";
  const target = dunk
    ? new THREE.Vector3(0, 1.95, 0)
    : new THREE.Vector3(0, 1, 0);
  if (view === "close") {
    orbit.target.set(0, 1.48, 0);
    camera.position.set(1.05, 1.62, 1.65);
  } else {
    orbit.target.copy(target);
    camera.position
      .copy(target)
      .add(
        new THREE.Vector3(
          view === "back" ? -2.2 : 2.7,
          dunk ? 0.4 : 0.85,
          view === "back" ? -4.6 : 4.5,
        ).multiplyScalar(dunk ? 1.7 : 1),
      );
  }
  orbit.update();
  render(0);
}
function setMode(value: string) {
  mode = value;
  time = 0;
  for (const b of document.querySelectorAll<HTMLButtonElement>(
    "[data-motion]",
  )) {
    const active = b.dataset.motion === mode;
    b.classList.toggle("selected", active);
    b.setAttribute("aria-pressed", String(active));
  }
  document.querySelector<HTMLElement>(".dunk-options")!.hidden =
    mode !== "dunk";
  document.getElementById("motion-note")!.textContent = notes[mode];
  frameView("front");
}
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-motion]"))
  b.addEventListener("click", () => setMode(b.dataset.motion!));
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-team]"))
  b.addEventListener("click", () => {
    team = Number(b.dataset.team) as 0 | 1;
    for (const t of document.querySelectorAll<HTMLButtonElement>(
      "[data-team]",
    )) {
      const active = t === b;
      t.classList.toggle("selected", active);
      t.setAttribute("aria-pressed", String(active));
    }
    rebuild();
  });
document.getElementById("player-look")!.addEventListener("change", (e) => {
  look = Number((e.target as HTMLSelectElement).value);
  rebuild();
});
document
  .getElementById("show-name")!
  .addEventListener("click", () => frameView("back"));
for (const view of ["front", "back", "close"])
  document
    .getElementById("view-" + view)!
    .addEventListener("click", () => frameView(view));
const pauseButton = document.getElementById("toggle-animation")!;
function updatePause() {
  pauseButton.textContent = paused ? "Play motion" : "Pause motion";
  pauseButton.setAttribute("aria-pressed", String(paused));
  document.getElementById("motion-label")!.textContent = paused
    ? "PAUSED"
    : "LIVE PREVIEW";
}
updatePause();
pauseButton.addEventListener("click", () => {
  paused = !paused;
  updatePause();
});
document
  .getElementById("jersey-name")!
  .addEventListener("input", () => render(0));
document.getElementById("dunk-style")!.addEventListener("change", () => {
  time = 0;
  render(0);
});
host.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "f") {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  }
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    const offset = camera.position.clone().sub(orbit.target);
    offset.applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      e.key === "ArrowLeft" ? -0.2 : 0.2,
    );
    camera.position.copy(orbit.target).add(offset);
    orbit.update();
    e.preventDefault();
  }
});
function render(dt: number) {
  const t = time % 3.1;
  sim.x = 0;
  sim.z = COURT_GEOMETRY.hoopZ;
  sim.pseudonym =
    (document.getElementById("jersey-name") as HTMLInputElement).value.trim() ||
    "PLAYER";
  sim.facingAngle = 0;
  sim.vx = sim.vz = 0;
  sim.animState = "dribble";
  sim.streetMove = null;
  sim.finishKind = null;
  sim.finishElapsedSec = 0;
  sim.finishResolutionSec = -1;
  sim.defenseAction = null;
  sim.defenseRecoverySec = 0;
  sim.dunkStyle = (document.getElementById("dunk-style") as HTMLSelectElement)
    .value as DunkStyle;
  goal.visible = mode === "dunk" || mode === "block";
  const attacking = mode !== "defend" && mode !== "block" && mode !== "swipe";
  let ballPos = {
    x: 0.34,
    y: 0.24 + Math.abs(Math.sin(time * 14)) * 0.65,
    z: sim.z + 0.28,
  };
  if (mode === "run") sim.vz = 3.2;
  if (mode === "defend") {
    sim.vx = Math.sin(time * 2) * 0.9;
    ball.visible = false;
  } else ball.visible = mode !== "swipe" && mode !== "block";
  if (mode === "dunk") {
    sim.finishKind = "dunk";
    sim.animState = "shoot";
    sim.finishElapsedSec = Math.min(0.84, t);
    sim.finishResolutionSec = t > 1.15 ? t - 1.15 : -1;
    sim.dunkBallStart = { x: 0.34, y: 0.86, z: sim.z + 0.28 };
    ballPos = dunkBallPosition(sim, getAirPose(sim));
    if (t > 1.45) {
      const d = t - 1.45;
      ballPos = {
        x: 0,
        z: sim.z,
        y: Math.max(0.12, 3.17 - 1.5 * d - 4.9 * d * d),
      };
    }
  } else if (mode === "block") {
    sim.defenseAction = t < 0.88 ? "jump" : null;
    sim.defenseElapsedSec = t;
    sim.defenseTargetX = 0;
    sim.defenseTargetZ = sim.z;
  } else if (mode === "swipe") {
    sim.defenseAction = t < 1.32 ? "swipe" : null;
    sim.defenseElapsedSec = t;
    sim.defenseRecoverySec = t < 1.32 ? 1 : 0;
  }
  character.update({
    sim,
    isAttacker: attacking,
    showBlockEligibleRing: false,
    presentationDeltaSec: dt,
    realDeltaSec: Math.max(dt, 1 / 60),
    ballPosition: ballPos,
  });
  ball.position.set(ballPos.x, ballPos.y, ballPos.z);
  ball.rotation.x = time * 2;
  ball.rotation.z = time;
  orbit.update();
  renderer.render(scene, camera);
}
const hooks = window as unknown as {
  advanceTime: (ms: number) => void;
  render_game_to_text: () => string;
};
hooks.advanceTime = (ms) => {
  manual = true;
  const n = Math.max(1, Math.ceil(ms / 16.667));
  for (let i = 0; i < n; i++) {
    if (!paused) time += ms / n / 1000;
    render(ms / n / 1000);
  }
};
hooks.render_game_to_text = () =>
  JSON.stringify({
    mode,
    asset: character.assetState,
    name: sim.pseudonym,
    team,
    look,
    paused,
    time,
    ball: ball.position.toArray(),
    palm: character.getPalmPosition()?.toArray(),
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    coordinates: "metres; +Y up; +Z forward",
  });
let last = performance.now();
function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!manual) {
    if (!paused) time += dt;
    render(dt);
  }
  requestAnimationFrame(loop);
}
void loadCharacter();
requestAnimationFrame(loop);
