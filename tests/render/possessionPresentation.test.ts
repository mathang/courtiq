import { describe, it, expect } from "vitest";
import { CourtCameraController } from "../../client/game/camera/courtCamera";
import { PossessionCueTracker } from "../../client/game/presentation/possessionCues";
import {
  createCourtSound,
  type DesignedSound,
} from "../../client/game/audio/courtSoundBank";
import { AuthoritativeMatchEngine } from "../../shared/rules/matchStateMachine";
import { BUNDLED_QUESTION_PACKS } from "../../content/packRegistry";
import { DUNK_STYLES, dunkBallPosition } from "../../shared/rules/dunks";
import { getAirPose } from "../../shared/rules/streetMoves";
import { dribbleBallPosition } from "../../shared/rules/dribble";
import { ShowcasePossession } from "../../client/game/presentation/showcasePossession";
function match() {
  return new AuthoritativeMatchEngine({
    matchId: "presentation",
    mode: "solo",
    seed: 9,
    pack: BUNDLED_QUESTION_PACKS[0],
    roomPresetId: "standard",
    sessionLengthId: "quick",
    player0: { id: "a", pseudonym: "A" },
    player1: { id: "b", pseudonym: "B", isAi: false },
  });
}
describe("possession presentation", () => {
  it("drives the preview through a real crossover and dunk at different frame rates", () => {
    for (const dt of [1000 / 60, 1000 / 30, 50, 100]) {
      const engine = new AuthoritativeMatchEngine({
        matchId: "showcase",
        mode: "solo",
        seed: 42,
        pack: BUNDLED_QUESTION_PACKS[0],
        roomPresetId: "standard",
        sessionLengthId: "quick",
        aiDifficulty: "beginner",
        player0: { id: "a", pseudonym: "A" },
        player1: { id: "b", pseudonym: "CourtBot", isAi: true },
      });
      engine.startMatch();
      const driver = new ShowcasePossession(),
        neutral = { moveX: 0, moveZ: 0, sprint: false, shoot: false };
      let crossed = false;
      for (let t = 0; t < 5000 && engine.phase === "Possession"; t += dt) {
        const input =
          driver.next(engine.players, engine.phase, 0, dt / 1000, neutral) ??
          neutral;
        engine.step(dt, [input, neutral]);
        if (engine.players[0].streetMove === "crossover") crossed = true;
      }
      expect(crossed).toBe(true);
      expect(engine.players[0].finishKind).toBe("dunk");
      expect(engine.players[0].dunkStyle).toBe("windmill");
      expect(engine.scoreState.scores).toEqual([0, 0]);
    }
  });
  it("gives control back immediately when the player moves during the preview", () => {
    const driver = new ShowcasePossession(),
      engine = match();
    expect(
      driver.next(engine.players, "Possession", 0, 1 / 60, {
        moveX: -1,
        moveZ: 0,
        sprint: false,
        shoot: false,
      }),
    ).toBeNull();
    expect(driver.active).toBe(false);
  });
  it("fits airborne players and ball above the question at desktop and portrait sizes", () => {
    for (const [width, height, top, bottom] of [
      [1440, 900, 0.13, 0.55],
      [390, 844, 0.25, 0.51],
    ])
      for (const style of DUNK_STYLES)
        for (const side of [-1, 1]) {
          const engine = match(),
            p = engine.players[0];
          p.x = side * 1.9;
          p.z = -3.2;
          p.facingAngle = Math.atan2(-p.x, -5.25 - p.z);
          p.finishKind = "dunk";
          p.dunkStyle = style;
          p.finishElapsedSec = 0.84;
          engine.players[1].x = 0;
          engine.players[1].z = -4.2;
          const camera = new CourtCameraController(width / height);
          camera.resize(width, height);
          for (let i = 0; i < 180; i++)
            camera.update({
              phase: "Duel",
              players: engine.players,
              attackerSlot: 0,
              ballPos: dunkBallPosition(p, getAirPose(p)),
              reducedMotion: false,
              deltaSec: 1 / 60,
              safeTop: top,
              safeBottom: bottom,
            });
          for (const point of camera.snapshot().subjects) {
            expect(point.x).toBeGreaterThan(0.045);
            expect(point.x).toBeLessThan(0.955);
            expect(point.y).toBeGreaterThan(top);
            expect(point.y).toBeLessThan(bottom);
          }
          expect(camera.snapshot().mode).toBe("hang");
        }
  });
  it("keeps reduced-motion framing steady through a dunk, swat and impact", () => {
    const engine = match(),
      camera = new CourtCameraController(16 / 9);
    camera.resize(1280, 720);
    camera.update({
      phase: "Possession",
      players: engine.players,
      ballPos: { x: 0, y: 1, z: 0 },
      reducedMotion: true,
      deltaSec: 1 / 60,
    });
    const before = camera.snapshot().position;
    engine.players[0].finishKind = "dunk";
    engine.players[0].finishElapsedSec = 0.5;
    camera.triggerImpact("basket");
    for (let i = 0; i < 120; i++)
      camera.update({
        phase: "Duel",
        players: engine.players,
        ballPos: { x: 0, y: 3.1, z: -5.25 },
        reducedMotion: true,
        deltaSec: 1 / 60,
      });
    expect(camera.snapshot().mode).toBe("steady");
    expect(camera.snapshot().position).toEqual(before);
  });
  it("makes one bounce sound per visible floor contact rather than an independent timer", () => {
    const engine = match(),
      tracker = new PossessionCueTracker(),
      p = engine.players[0];
    p.animState = "dribble";
    const contacts: number[] = [];
    for (let i = 0; i <= 120; i++)
      if (
        tracker
          .update(
            "Possession",
            engine.players,
            0,
            dribbleBallPosition(p, i / 60),
          )
          .includes("bounce")
      )
        contacts.push(i / 60);
    expect(contacts).toHaveLength(4);
    contacts.forEach((t, i) =>
      expect(Math.abs(t - ((i + 1) * Math.PI) / 7.5)).toBeLessThan(
        1 / 60 + 0.001,
      ),
    );
  });
  it("emits gather, takeoff, impact and landing once across repeated online snapshots", () => {
    const engine = match(),
      p = engine.players[0],
      tracker = new PossessionCueTracker(),
      events: string[] = [];
    p.finishKind = "dunk";
    p.finishOutcome = "basket";
    const frame = (phase: "QuestionReady" | "Duel" | "Resolution") =>
      events.push(
        ...tracker.update(phase, engine.players, 0, { x: 0, y: 3, z: -5.25 }),
      );
    frame("QuestionReady");
    p.finishElapsedSec = 0.2;
    frame("QuestionReady");
    for (let i = 0; i < 100; i++) {
      p.finishElapsedSec = 1 + i / 60;
      frame("Duel");
    }
    for (const r of [0, 0.29, 0.31, 0.31, 0.6, 0.79, 0.79, 1]) {
      p.finishResolutionSec = r;
      frame("Resolution");
    }
    expect(events).toEqual(["gather", "takeoff", "basket", "land"]);
  });
  it("does not replay stale launch or impact sounds after pause and resume", () => {
    const engine = match(),
      p = engine.players[0],
      tracker = new PossessionCueTracker();
    p.finishKind = "dunk";
    p.finishElapsedSec = 2;
    tracker.update("Duel", engine.players, 0, { x: 0, y: 3, z: -5.25 }, true);
    expect(
      tracker.update("Duel", engine.players, 0, { x: 0, y: 3, z: -5.25 }),
    ).toEqual([]);
    p.finishResolutionSec = 0.4;
    p.finishOutcome = "block";
    tracker.update(
      "Resolution",
      engine.players,
      0,
      { x: 0, y: 3, z: -5.25 },
      true,
    );
    expect(
      tracker.update("Resolution", engine.players, 0, { x: 0, y: 3, z: -5.25 }),
    ).toEqual([]);
  });
  it("generates reusable, finite sound buffers with headroom and no DC build-up", () => {
    for (const kind of [
      "step",
      "bounce",
      "gather",
      "flight",
      "slam",
      "net",
      "rim",
      "swat",
      "answer",
      "buzzer",
      "air",
    ] as DesignedSound[]) {
      const a = createCourtSound(kind, 24000);
      expect(a.length).toBeGreaterThan(1000);
      expect([...a].every(Number.isFinite)).toBe(true);
      expect(Math.max(...a.map(Math.abs))).toBeLessThanOrEqual(0.80001);
      expect(Math.abs(a.reduce((s, x) => s + x, 0) / a.length)).toBeLessThan(
        0.02,
      );
      expect(createCourtSound(kind, 24000)).toEqual(a);
    }
  });
});
