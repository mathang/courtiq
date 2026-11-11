import { describe, it, expect } from "vitest";
import { AuthoritativeMatchEngine } from "../../shared/rules/matchStateMachine";
import { BUNDLED_QUESTION_PACKS } from "../../content/packRegistry";
import { getAirPose } from "../../shared/rules/streetMoves";
import {
  dunkRig,
  DUNK_STYLES,
  DUNK_FINISH_HAND,
} from "../../shared/rules/dunks";
import { dribbleBallPosition } from "../../shared/rules/dribble";
import { COURT_GEOMETRY } from "../../shared/config/balance";
function player() {
  return new AuthoritativeMatchEngine({
    matchId: "motion",
    mode: "solo",
    seed: 1,
    pack: BUNDLED_QUESTION_PACKS[0],
    roomPresetId: "standard",
    sessionLengthId: "quick",
    player0: { id: "a", pseudonym: "A" },
    player1: { id: "b", pseudonym: "B", isAi: false },
  }).players[0];
}
describe("continuous basketball motion", () => {
  it("has matching vertical speeds at gather, ascent, apex and question hold", () => {
    const p = player();
    p.finishKind = "dunk";
    p.finishResolutionSec = -1;
    const y = (t: number) => {
      p.finishElapsedSec = t;
      return getAirPose(p).y;
    };
    const h = 1e-5;
    for (const t of [0.1, 0.23, 0.48, 0.84])
      expect(
        Math.abs((y(t) - y(t - h)) / h - (y(t + h) - y(t)) / h),
      ).toBeLessThan(0.02);
  });
  it("eases both ends of the landing without a position jump", () => {
    const p = player();
    p.finishKind = "dunk";
    p.finishElapsedSec = 0.84;
    const y = (t: number) => {
      p.finishResolutionSec = t;
      return getAirPose(p).y;
    };
    const h = 1e-5;
    for (const t of [0.3, 0.78])
      expect(Math.abs((y(t + h) - y(t - h)) / (2 * h))).toBeLessThan(0.01);
    expect(y(0.78)).toBe(0);
  });
  it("uses one windmill sweep and holds the ball forward of the torso at the rim", () => {
    const p = player();
    p.finishKind = "dunk";
    p.dunkStyle = "windmill";
    let previous = -Infinity,
      first = 0,
      last = 0;
    for (let i = 0; i <= 84; i++) {
      p.finishElapsedSec = i / 100;
      const a = dunkRig(p).arm;
      if (i === 0) first = a;
      last = a;
      expect(a).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = a;
    }
    expect(last - first).toBeGreaterThan(Math.PI);
    expect(last - first).toBeLessThan(Math.PI * 2);
    expect(DUNK_FINISH_HAND.z).toBeGreaterThan(0.3);
  });
  it("steps clear of the basket during a launch directly beneath it", () => {
    for (const style of DUNK_STYLES) {
      const p = player();
      p.x = COURT_GEOMETRY.hoopX;
      p.z = COURT_GEOMETRY.hoopZ;
      p.facingAngle = 0;
      p.finishKind = "dunk";
      p.dunkStyle = style;
      p.finishElapsedSec = 0.35;
      const pose = getAirPose(p);
      expect(
        Math.hypot(
          pose.x - COURT_GEOMETRY.hoopX,
          pose.z - COURT_GEOMETRY.hoopZ,
        ),
      ).toBeGreaterThan(0.4);
    }
  });
  it("keeps the protected spin bounce attached to the same rotating hand path", () => {
    const p = player();
    p.x = p.z = p.facingAngle = 0;
    p.animState = "dribble";
    p.streetMove = "spin";
    p.moveSide = 1;
    const radius = Math.hypot(0.34, 0.28);
    let previous = dribbleBallPosition(p, 0),
      max = 0;
    for (let i = 0; i <= 48; i++) {
      p.moveElapsedSec = i * 0.01;
      const b = dribbleBallPosition(p, i * 0.01);
      expect(Math.hypot(b.x, b.z)).toBeCloseTo(radius, 6);
      max = Math.max(max, Math.hypot(b.x - previous.x, b.z - previous.z));
      previous = b;
    }
    expect(max).toBeLessThan(0.13);
    p.streetMove = null;
    const normal = dribbleBallPosition(p, 0.48);
    expect(normal.x).toBeCloseTo(previous.x, 6);
    expect(normal.z).toBeCloseTo(previous.z, 6);
  });
  it("leaves space between a blocking defender and the dunker's body", () => {
    for (const [x,z] of [[0,-3.7],[1,-4.5],[-1,-4.5],[0.1,-5],[0,-5.25]]) {
      const p=player();p.x=x;p.z=z;p.defenseAction='jump';
      p.defenseTargetX=0;p.defenseTargetZ=-5.25;
      p.defenseElapsedSec=.44;
      const pose=getAirPose(p);
      expect(Math.hypot(pose.x-p.defenseTargetX,pose.z-p.defenseTargetZ)).toBeGreaterThanOrEqual(.719);
      expect(pose.y).toBeCloseTo(1.25);
      for(const t of [0,.88]){p.defenseElapsedSec=t;const end=getAirPose(p);expect(end.x).toBeCloseTo(x);expect(end.z).toBeCloseTo(z);expect(end.y).toBeCloseTo(0);}
    }
  });
});
