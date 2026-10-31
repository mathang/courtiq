import { canStealBall, DefenseAction } from './defense';
import type { PlayerSimState } from './matchStateMachine';
import type { StreetMove } from './streetMoves';
import {
  AI_DIFFICULTY_PRESETS,
  AiDifficultyId,
  COURT_GEOMETRY,
} from '../config/balance';
import { QuestionItem } from '../content/question-schema';
import { computeDistance2D, CourtPoint2D } from './block';
import { clamp } from './timing';

export interface AiCommittedQuestionPlan {
  readonly duelId: string;
  readonly willAnswerCorrectly: boolean;
  readonly chosenOptionId: string;
  readonly plannedAnswerTimeMs: number;
}

/**
 * Commits the computer opponent's question answer plan AT DUEL CREATION,
 * before the human player submits any response (Section 12).
 * Never inspects the human answer or uses live LLM calls.
 */
export function createAiQuestionPlanAtDuelStart(params: {
  duelId: string;
  difficulty: AiDifficultyId;
  question: QuestionItem;
  effectiveReadingMs: number;
  effectiveAnswerWindowMs: number;
  rng?: () => number;
}): AiCommittedQuestionPlan {
  const rng = params.rng ?? Math.random;
  const preset = AI_DIFFICULTY_PRESETS[params.difficulty];

  const willAnswerCorrectly = rng() < preset.answerAccuracy;
  let chosenOptionId = params.question.correctOptionId;

  if (!willAnswerCorrectly) {
    const distractors = params.question.options.filter(
      (o) => o.id !== params.question.correctOptionId
    );
    const pickIdx = Math.floor(rng() * distractors.length);
    chosenOptionId = distractors[pickIdx]?.id ?? params.question.options[0].id;
  }

  const rawTime =
    preset.minAnswerTimeMs +
    rng() * (preset.maxAnswerTimeMs - preset.minAnswerTimeMs);
  const plannedAnswerTimeMs = Math.round(
    clamp(
      rawTime,
      params.effectiveReadingMs + 250,
      params.effectiveAnswerWindowMs - 250
    )
  );

  return Object.freeze({
    duelId: params.duelId,
    willAnswerCorrectly,
    chosenOptionId,
    plannedAnswerTimeMs,
  });
}

// ============================================================================
// Computer Basketball Behaviour State Machine (Section 12)
// ============================================================================

export interface AiBasketballBrainState {
  targetSpot: CourtPoint2D;
  retargetTimerSec: number;
  possessionElapsedSec: number;
  minDribbleBeforeShotSec: number;
  observations: Array<{ age: number; x: number; z: number }>;
  wantsDunk: boolean;
  defenseTimerSec: number;
  driveSide: number;
  lastPosition: CourtPoint2D | null;
  stalledSec: number;
  escapeTarget: CourtPoint2D | null;
  escapeRemainingSec: number;
  trickTimerSec: number;
  shotDecisionDeadlineSec: number;
}

export function createAiBasketballBrainState(rng: () => number = Math.random): AiBasketballBrainState {
  const wantsDunk = rng() < 0.68;
  const driveSide = rng() < 0.5 ? -1 : 1;
  return {
    targetSpot: wantsDunk ? { x: driveSide * 1.4, z: -3.4 } : pickOffensiveTargetSpot(rng),
    retargetTimerSec: 2.0 + rng() * 0.8,
    possessionElapsedSec: 0,
    minDribbleBeforeShotSec: 0.85 + rng() * 0.75,
    observations: [], wantsDunk, driveSide,
    defenseTimerSec: 0.8 + rng() * 0.7,
    lastPosition: null, stalledSec: 0, escapeTarget: null, escapeRemainingSec: 0,
    trickTimerSec: 0.6, shotDecisionDeadlineSec: 3.6 + rng() * 0.8,
  };
}

function pickOffensiveTargetSpot(rng: () => number): CourtPoint2D {
  const spots = [
    { x: -2.7, z: -2.1 }, { x: 2.7, z: -2.1 }, { x: 0, z: -1.6 },
    { x: -1.6, z: -3.3 }, { x: 1.6, z: -3.3 },
    { x: -4.5, z: -0.3 }, { x: 4.5, z: -0.3 }, { x: 0, z: 1.6 },
  ];
  const spot = spots[Math.min(spots.length - 1, Math.floor(rng() * spots.length))];
  return { x: spot.x + (rng() - 0.5) * 0.5, z: spot.z + (rng() - 0.5) * 0.5 };
}

export interface AiMovementIntent {
  moveX: number;
  moveZ: number;
  sprint: boolean;
  shoot: boolean;
  dunk?: boolean;
  defense?: DefenseAction;
  trick?: StreetMove;
}

interface BasketballDecisionParams {
  brain: AiBasketballBrainState;
  isAttacker: boolean;
  aiPos: CourtPoint2D;
  opponentPos: CourtPoint2D;
  movementClockRemainingMs: number;
  difficulty: AiDifficultyId;
  deltaSec: number;
  rng?: () => number;
  self?: PlayerSimState;
  opponent?: PlayerSimState;
  ballPos?: { x: number; y: number; z: number };
}

function safeCourtTarget(p: CourtPoint2D): CourtPoint2D {
  // Keep planned routes on the playable side of the hoop/backboard.
  return { x: clamp(p.x, COURT_GEOMETRY.minX + 0.5, COURT_GEOMETRY.maxX - 0.5),
    z: clamp(p.z, COURT_GEOMETRY.hoopZ + 0.6, COURT_GEOMETRY.maxZ - 0.5) };
}

/** Commit to a short route around a body instead of repeatedly running into it. */
function routeAroundDefender(params: BasketballDecisionParams, goal: CourtPoint2D): CourtPoint2D {
  const { brain, aiPos, opponentPos } = params;
  if (brain.escapeTarget && (brain.escapeRemainingSec <= 0 || computeDistance2D(aiPos, brain.escapeTarget) < 0.3)) {
    brain.escapeTarget = null;
  }
  if (brain.escapeTarget) return brain.escapeTarget;
  const dx = goal.x - aiPos.x, dz = goal.z - aiPos.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.35) return goal;
  const nx = dx / len, nz = dz / len;
  const ox = opponentPos.x - aiPos.x, oz = opponentPos.z - aiPos.z;
  const along = ox * nx + oz * nz, lateral = ox * -nz + oz * nx;
  const bodyInLane = along > 0 && along < Math.min(len, 2.3) && Math.abs(lateral) < 1.05;
  if (bodyInLane || brain.stalledSec > 0.45) {
    if (brain.stalledSec > 0.45) brain.driveSide *= -1;
    let side = brain.driveSide;
    let candidate = { x: opponentPos.x - nz * side * 1.45 + nx * 0.25,
      z: opponentPos.z + nx * side * 1.45 + nz * 0.25 };
    if (candidate.x < COURT_GEOMETRY.minX + 0.7 || candidate.x > COURT_GEOMETRY.maxX - 0.7 || candidate.z < COURT_GEOMETRY.hoopZ + 0.6) {
      side *= -1;
      candidate = { x: opponentPos.x - nz * side * 1.45 + nx * 0.25,
        z: opponentPos.z + nx * side * 1.45 + nz * 0.25 };
    }
    brain.driveSide = side;
    brain.escapeTarget = safeCourtTarget(candidate);
    brain.escapeRemainingSec = 0.70;
    brain.stalledSec = 0;
    return brain.escapeTarget;
  }
  return goal;
}

function movementToward(from: CourtPoint2D, target: CourtPoint2D, multiplier: number) {
  const dx = target.x - from.x, dz = target.z - from.z, len = Math.hypot(dx, dz);
  // Brake near a destination; full-speed normalised input caused overshoot/shuffling.
  const scale = len < 0.15 ? 0 : Math.min(1, len / 0.7) * multiplier;
  return { moveX: len ? dx / len * scale : 0, moveZ: len ? dz / len * scale : 0 };
}

export function stepAiBasketballDecision(params: BasketballDecisionParams): AiMovementIntent {
  const rng = params.rng ?? Math.random;
  const { brain, aiPos, opponentPos, deltaSec, self } = params;
  const preset = AI_DIFFICULTY_PRESETS[params.difficulty];
  const recovering = !!self && (self.defenseRecoverySec > 0 || self.wrongFootSec > 0);
  brain.possessionElapsedSec += deltaSec;
  brain.retargetTimerSec -= deltaSec;
  brain.escapeRemainingSec -= deltaSec;
  brain.trickTimerSec = Math.max(0, brain.trickTimerSec - deltaSec);
  const moved = brain.lastPosition ? computeDistance2D(aiPos, brain.lastPosition) : Infinity;
  if (!recovering && brain.lastPosition && moved / Math.max(deltaSec, 0.001) < 0.35 && computeDistance2D(aiPos, brain.targetSpot) > 0.6) {
    brain.stalledSec += deltaSec;
  } else brain.stalledSec = 0;
  brain.lastPosition = { ...aiPos };

  const defenderDistance = computeDistance2D(aiPos, opponentPos);
  if (params.isAttacker) {
    const hoopDistance = computeDistance2D(aiPos, { x: COURT_GEOMETRY.hoopX, z: COURT_GEOMETRY.hoopZ });
    const behindRim = aiPos.z < COURT_GEOMETRY.hoopZ + 0.55;
    const frontOfRim = !behindRim;
    const clockUrgent = params.movementClockRemainingMs <= 2600;
    const rimFinish = frontOfRim && hoopDistance <= 2.35 && brain.possessionElapsedSec >= 0.35;
    const settled = brain.possessionElapsedSec >= brain.minDribbleBeforeShotSec;
    const nearTarget = computeDistance2D(aiPos, brain.targetSpot) < 0.8;
    const open = defenderDistance > 1.85;
    const plannedShot = settled && frontOfRim && hoopDistance <= (brain.wantsDunk ? 3.3 : 7.4) &&
      (open || (nearTarget && brain.possessionElapsedSec > 1.5));
    const decisiveShot = frontOfRim && hoopDistance <= 7.4 && brain.possessionElapsedSec >= brain.shotDecisionDeadlineSec;
    if (!recovering && (rimFinish || plannedShot || decisiveShot || clockUrgent)) {
      return { moveX: 0, moveZ: 0, sprint: false, shoot: true, dunk: frontOfRim && hoopDistance <= 3.4 };
    }

    // A drive's lane is selected once, not from the sign of x on every tick.
    if (!brain.wantsDunk && brain.retargetTimerSec <= 0 && !nearTarget) {
      brain.targetSpot = pickOffensiveTargetSpot(rng);
      brain.retargetTimerSec = 1.8;
    }
    const goal = behindRim ? safeCourtTarget({ x: Math.abs(aiPos.x) < 0.4 ? brain.driveSide * 1.2 : aiPos.x, z: COURT_GEOMETRY.hoopZ + 1.8 }) : brain.targetSpot;
    const route = routeAroundDefender(params, goal);
    const canTrick = !recovering && brain.trickTimerSec <= 0 && defenderDistance < 1.9 &&
      (!self || (self.moveCooldownSec <= 0 && !self.streetMove && self.sprintStamina > 0.3));
    let trick: StreetMove | undefined;
    if (canTrick) {
      trick = brain.wantsDunk ? (params.difficulty === 'beginner' ? 'crossover' : 'spin') : 'stepback';
      brain.trickTimerSec = 1.35;
    }
    return { ...movementToward(aiPos, route, preset.moveSpeedMultiplier),
      sprint: !recovering && (!self || self.sprintStamina > 0.25) && computeDistance2D(aiPos, route) > 1.3,
      shoot: false, ...(trick ? { trick } : {}) };
  }

  // Preserve difficulty-specific reaction time; use observed court positions, never human intentions.
  for (const observation of brain.observations) observation.age += deltaSec;
  brain.observations.push({ age: 0, ...opponentPos });
  const delay = preset.reactionDelayMs / 1000;
  while (brain.observations.length > 1 && brain.observations[1].age >= delay) brain.observations.shift();
  const observed = brain.observations[0];
  const hx = COURT_GEOMETRY.hoopX - observed.x, hz = COURT_GEOMETRY.hoopZ - observed.z;
  const hoopDistance = Math.hypot(hx, hz);
  const guardGap = Math.min(1.15, Math.max(0.6, hoopDistance * 0.3));
  const goal = safeCourtTarget({ x: observed.x + hx / Math.max(hoopDistance, 0.01) * guardGap,
    z: observed.z + hz / Math.max(hoopDistance, 0.01) * guardGap });
  brain.targetSpot = goal;
  const route = routeAroundDefender(params, goal);
  brain.defenseTimerSec -= deltaSec;
  const canChallenge = !recovering && (!self || (self.defenseCooldownSec <= 0 && self.sprintStamina > 0.18));
  const exposedBall = self && params.opponent && params.ballPos ? canStealBall(self, params.opponent, params.ballPos) : defenderDistance < 1.4;
  const swipe = brain.defenseTimerSec <= 0 && canChallenge && exposedBall;
  if (brain.defenseTimerSec <= 0) brain.defenseTimerSec = swipe ? 1.5 + rng() * 1.0 : 0.25 + rng() * 0.2;
  return { ...movementToward(aiPos, route, preset.moveSpeedMultiplier * preset.contestAggression),
    sprint: !recovering && computeDistance2D(aiPos, goal) > 2.4 && (!self || self.sprintStamina > 0.25),
    shoot: false, ...(swipe ? { defense: 'swipe' as const } : {}) };
}
