export type RoomPresetId = 'standard' | 'arcade' | 'learning' | 'practice';
export type SessionLengthId = 'quick' | 'standard' | 'practice';
export type AiDifficultyId = 'beginner' | 'intermediate' | 'advanced';
export type ShotZone = 'close' | 'mid-range' | 'three-pointer';

export interface RoomPresetConfig {
  id: RoomPresetId;
  label: string;
  description: string;
  readingMs: number;
  answerWindowMs: number;
  tieToleranceMs: number;
  explanationMs: number;
  movementClockMs: number;
  correctBaseBonus: number;
  speedBonusWeight: number;
  untimed: boolean;
}

export interface SessionLengthConfig {
  id: SessionLengthId;
  label: string;
  description: string;
  targetScore: number;
  maxPossessionsPerPlayer: number;
}

export interface AiDifficultyConfig {
  id: AiDifficultyId;
  label: string;
  answerAccuracy: number;
  minAnswerTimeMs: number;
  maxAnswerTimeMs: number;
  reactionDelayMs: number;
  moveSpeedMultiplier: number;
  contestAggression: number;
}

export const COURT_GEOMETRY = {
  /** Half-court playable bounds in metres */
  minX: -7.2,
  maxX: 7.2,
  minZ: -6.2,
  maxZ: 7.2,
  /** Hoop rim center coordinates in metres */
  hoopX: 0,
  hoopY: 3.05,
  hoopZ: -5.25,
  backboardZ: -5.62,
  paint: { minX: -2.45, maxX: 2.45, minZ: -6.5, maxZ: -0.65 },
  rimRadiusM: 0.225,
  /** Distance thresholds from (hoopX, hoopZ) on XZ plane */
  closeRangeMaxM: 2.8,
  threePointRadiusM: 6.75,
  /** Starting positions at possession reset */
  attackerStart: { x: 0, z: 2.6, facingAngle: Math.PI }, // Facing -Z (towards hoop)
  defenderStart: { x: 0, z: 0.6, facingAngle: 0 },       // Facing +Z (towards attacker)
} as const;

export const MOVEMENT_CONFIG = {
  baseSpeedMps: 5.5,
  dribbleSpeedMps: 5.95,
  sprintMultiplier: 1.5,
  acceleration: 25,
  braking: 34,
  playerCollisionRadiusM: 0.48,
  minPlayerSeparationM: 0.82,
  /** Soft body contact can compress this far before the torso safety limit. */
  contactCompressionM: 0.12,
  contactResponse: 22,
  contactVelocityResponse: 16,
  motionStepSec: 1 / 120,
  /** Sprint stamina (0..1) */
  sprintDrainPerSec: 0.30,
  sprintRegenPerSec: 0.35,
  minStaminaToStartSprint: 0.15,
  /** Settling window after releasing sprint during which shot still incurs sprint penalty */
  sprintSettleWindowMs: 350,
} as const;

export const STREET_FLOW_CONFIG = {
  /** Authoritative input buffer window across solo, WS, and HTTP rooms */
  inputBufferWindowSec: 0.28,
  /** Normalized progress [0..1] in current trick when a DISTINCT trick can cancel-chain */
  trickCancelFraction: 0.65,
  /** Normalized progress [0..1] in current trick when shoot/dunk can cancel-chain into gather */
  finishCancelFraction: 0.45,
  /** Post-move window to continue an active Trick Combo chain */
  comboGraceSec: 0.36,
  /** Maximum distinct moves in a single combo chain before cooldown resets */
  maxTrickChain: 3,
  /** Cooldown after a single unchained move or completed 3-move chain */
  baseMoveCooldownSec: 0.88,
  /** Vulnerability window if over-dribbling / repeating spam into a close defender */
  overexposedDurationSec: 0.55,
  /** Bounded shot setup quality bonus by combo count (0, 1x, 2x, 3x) — never bypasses learning */
  comboSetupBonus: [0, 0.02, 0.04, 0.05] as readonly number[],
  /** Flow meter gains & penalties */
  flowCleanTrick: 0.07,
  flowComboStepBonus: 0.05,
  flowAnkleBreaker: 0.13,
  flowCleanSteal: 0.24,
  flowTimedBlock: 0.26,
  flowQuestionBlock: 0.24,
  flowCorrectAnswerBase: 0.14,
  flowCorrectAnswerSpeedWeight: 0.12,
  flowTurnoverPenalty: 0.20,
  /** Post-cashout flow level after sinking an ON FIRE basket */
  onFireAfterMakeFlow: 0.42,
} as const;

export const LEARNING_STREAK_CONFIG = {
  correctAnswersToIgnite: 3,
  movementMultiplier: 1.20,
  shootingBonus: 0.20,
} as const;

export const SHOT_BALANCE_CONFIG = {
  baseProbabilities: {
    close: 0.20,
    'mid-range': 0.12,
    'three-pointer': 0.07,
  } as Record<ShotZone, number>,
  heavilyContestedPenalty: 0.05,
  sprintingPenalty: 0.05,
  correctBaseBonus: 0.35,
  speedBonusWeight: 0.35,
  minProbability: 0.03,
  maxProbability: 0.95,
} as const;

export const BLOCK_BALANCE_CONFIG = {
  maxBlockDistanceM: 2.6,
  minBlockDistanceM: 0.2,
  /** Cosine of max half-angle for defender forward-facing cone (~100 degrees half-angle) */
  minFacingDotProduct: -0.17,
  /** Maximum lateral/behind-the-shooter tolerance relative to shooter-to-hoop vector */
  minContestPositionCos: -0.8,
} as const;

export const ROOM_PRESETS: Record<RoomPresetId, RoomPresetConfig> = {
  standard: {
    id: 'standard',
    label: 'Standard Classroom',
    description: 'Balanced 12s question window, 2s reading protection, and standard speed bonus.',
    readingMs: 2000,
    answerWindowMs: 12000,
    tieToleranceMs: 200,
    explanationMs: 3000,
    movementClockMs: 15000,
    correctBaseBonus: 0.35,
    speedBonusWeight: 0.35,
    untimed: false,
  },
  arcade: {
    id: 'arcade',
    label: 'Arcade Fast Duel',
    description: 'Shorter 10s window, 1.5s reading period, and stronger speed bonus.',
    readingMs: 1500,
    answerWindowMs: 10000,
    tieToleranceMs: 180,
    explanationMs: 2500,
    movementClockMs: 12000,
    correctBaseBonus: 0.35,
    speedBonusWeight: 0.42,
    untimed: false,
  },
  learning: {
    id: 'learning',
    label: 'Learning Focus',
    description: 'Extended 3s reading protection, 18s answer window, and gentler speed bonus.',
    readingMs: 3000,
    answerWindowMs: 18000,
    tieToleranceMs: 250,
    explanationMs: 4200,
    movementClockMs: 18000,
    correctBaseBonus: 0.45,
    speedBonusWeight: 0.20,
    untimed: false,
  },
  practice: {
    id: 'practice',
    label: 'Untimed Practice',
    description: 'Untimed questions against the computer with zero speed penalty for careful reading.',
    readingMs: 2000,
    answerWindowMs: 60000,
    tieToleranceMs: 250,
    explanationMs: 4500,
    movementClockMs: 25000,
    correctBaseBonus: 0.55,
    speedBonusWeight: 0.0,
    untimed: true,
  },
};

export const SESSION_LENGTH_PRESETS: Record<SessionLengthId, SessionLengthConfig> = {
  quick: {
    id: 'quick',
    label: 'Quick Match (~5 min)',
    description: 'First to 7 points, maximum 5 possessions each.',
    targetScore: 7,
    maxPossessionsPerPlayer: 5,
  },
  standard: {
    id: 'standard',
    label: 'Standard Match (~8–10 min)',
    description: 'First to 11 points, maximum 10 possessions each.',
    targetScore: 11,
    maxPossessionsPerPlayer: 10,
  },
  practice: {
    id: 'practice',
    label: 'Practice Session (8 Possessions)',
    description: '8 possessions each with untimed or selected room rules.',
    targetScore: 21,
    maxPossessionsPerPlayer: 8,
  },
};

export const AI_DIFFICULTY_PRESETS: Record<AiDifficultyId, AiDifficultyConfig> = {
  beginner: {
    id: 'beginner',
    label: 'Beginner (45% acc, 6–10s)',
    answerAccuracy: 0.45,
    minAnswerTimeMs: 6000,
    maxAnswerTimeMs: 10000,
    reactionDelayMs: 380,
    moveSpeedMultiplier: 0.82,
    contestAggression: 0.55,
  },
  intermediate: {
    id: 'intermediate',
    label: 'Intermediate (65% acc, 4–8s)',
    answerAccuracy: 0.65,
    minAnswerTimeMs: 4000,
    maxAnswerTimeMs: 8000,
    reactionDelayMs: 220,
    moveSpeedMultiplier: 0.94,
    contestAggression: 0.78,
  },
  advanced: {
    id: 'advanced',
    label: 'Advanced (80% acc, 3–6s)',
    answerAccuracy: 0.80,
    minAnswerTimeMs: 3000,
    maxAnswerTimeMs: 6000,
    reactionDelayMs: 120,
    moveSpeedMultiplier: 1.0,
    contestAggression: 0.94,
  },
};
