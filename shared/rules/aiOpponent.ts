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
}

export function createAiBasketballBrainState(
  rng: () => number = Math.random
): AiBasketballBrainState {
  return {
    targetSpot: pickOffensiveTargetSpot(rng),
    retargetTimerSec: 1.8 + rng() * 1.4,
    possessionElapsedSec: 0,
    observations: [],
    minDribbleBeforeShotSec: 1.6 + rng() * 2.2,
  };
}

function pickOffensiveTargetSpot(rng: () => number): CourtPoint2D {
  const spots: CourtPoint2D[] = [
    { x: -2.4, z: -2.2 }, // Left wing mid-range
    { x: 2.4, z: -2.2 },  // Right wing mid-range
    { x: 0.0, z: -1.6 },  // High post / free-throw line
    { x: -1.4, z: -3.5 }, // Left block close range
    { x: 1.4, z: -3.5 },  // Right block close range
    { x: -4.2, z: -0.4 }, // Left 3-point wing
    { x: 4.2, z: -0.4 },  // Right 3-point wing
    { x: 0.0, z: 1.85 },  // Top of the arc 3-pointer
  ];
  const chosen = spots[Math.floor(rng() * spots.length)] ?? spots[0];
  return {
    x: clamp(chosen.x + (rng() - 0.5) * 0.8, COURT_GEOMETRY.minX + 0.8, COURT_GEOMETRY.maxX - 0.8),
    z: clamp(chosen.z + (rng() - 0.5) * 0.8, COURT_GEOMETRY.minZ + 1.4, COURT_GEOMETRY.maxZ - 0.8),
  };
}

export interface AiMovementIntent {
  moveX: number; // -1..1
  moveZ: number; // -1..1
  sprint: boolean;
  shoot: boolean;
}

/**
 * Computes the AI's basketball movement and shooting intentions for one simulation tick.
 */
export function stepAiBasketballDecision(params: {
  brain: AiBasketballBrainState;
  isAttacker: boolean;
  aiPos: CourtPoint2D;
  opponentPos: CourtPoint2D;
  movementClockRemainingMs: number;
  difficulty: AiDifficultyId;
  deltaSec: number;
  rng?: () => number;
}): AiMovementIntent {
  const rng = params.rng ?? Math.random;
  const preset = AI_DIFFICULTY_PRESETS[params.difficulty];
  const brain = params.brain;

  brain.possessionElapsedSec += params.deltaSec;
  brain.retargetTimerSec -= params.deltaSec;

  if (params.isAttacker) {
    if (brain.retargetTimerSec <= 0) {
      brain.targetSpot = pickOffensiveTargetSpot(rng);
      brain.retargetTimerSec = 1.6 + rng() * 1.5;
    }

    const distToTarget = computeDistance2D(params.aiPos, brain.targetSpot);
    const distToDefender = computeDistance2D(params.aiPos, params.opponentPos);
    const distToHoop = computeDistance2D(params.aiPos, {
      x: COURT_GEOMETRY.hoopX,
      z: COURT_GEOMETRY.hoopZ,
    });

    // Shoot if open at a good spot after minimum dribble, or if movement clock is running low (< 2.5s)
    const isOpen = distToDefender > 2.05;
    const nearTarget = distToTarget < 0.85;
    const clockUrgent = params.movementClockRemainingMs <= 2600;
    const readyToShoot =
      brain.possessionElapsedSec >= brain.minDribbleBeforeShotSec &&
      distToHoop <= 7.4 &&
      ((isOpen && distToHoop <= 6.9) || (nearTarget && distToDefender > 1.55));

    if (clockUrgent || readyToShoot) {
      return { moveX: 0, moveZ: 0, sprint: false, shoot: true };
    }

    if (distToTarget < 0.35) {
      brain.targetSpot = pickOffensiveTargetSpot(rng);
    }

    const dx = brain.targetSpot.x - params.aiPos.x;
    const dz = brain.targetSpot.z - params.aiPos.z;
    const len = Math.hypot(dx, dz) || 1;
    const shouldSprint = distToDefender < 1.5 && distToTarget > 1.4;

    return {
      moveX: (dx / len) * preset.moveSpeedMultiplier,
      moveZ: (dz / len) * preset.moveSpeedMultiplier,
      sprint: shouldSprint,
      shoot: false,
    };
  } else {
    for (const o of brain.observations) o.age += params.deltaSec;
    brain.observations.push({ age: 0, ...params.opponentPos });
    const delay = preset.reactionDelayMs / 1000;
    while (brain.observations.length > 1 && brain.observations[1].age >= delay) brain.observations.shift();
    const observed = brain.observations[0];
    // Defensive AI: position between attacker and basket at contesting distance (~1.25m)
    const hoopX = COURT_GEOMETRY.hoopX;
    const hoopZ = COURT_GEOMETRY.hoopZ;
    const attToHoopX = hoopX - observed.x;
    const attToHoopZ = hoopZ - observed.z;
    const attToHoopLen = Math.hypot(attToHoopX, attToHoopZ) || 1;

    const guardDist = 1.25;
    const desiredX = clamp(
      observed.x + (attToHoopX / attToHoopLen) * guardDist,
      COURT_GEOMETRY.minX + 0.6,
      COURT_GEOMETRY.maxX - 0.6
    );
    const desiredZ = clamp(
      observed.z + (attToHoopZ / attToHoopLen) * guardDist,
      COURT_GEOMETRY.minZ + 1.1,
      COURT_GEOMETRY.maxZ - 0.6
    );

    const dx = desiredX - params.aiPos.x;
    const dz = desiredZ - params.aiPos.z;
    const dist = Math.hypot(dx, dz);

    if (dist < 0.18) {
      return { moveX: 0, moveZ: 0, sprint: false, shoot: false };
    }

    return {
      moveX: (dx / dist) * preset.moveSpeedMultiplier * preset.contestAggression,
      moveZ: (dz / dist) * preset.moveSpeedMultiplier * preset.contestAggression,
      sprint: dist > 2.2,
      shoot: false,
    };
  }
}
