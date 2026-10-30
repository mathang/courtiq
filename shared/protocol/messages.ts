import {
  AiDifficultyId,
  RoomPresetId,
  SessionLengthId,
} from '../config/balance';
import { PublicDuelQuestion } from '../content/question-schema';
import { BlockEligibilitySnapshot } from '../rules/block';
import {
  FeedbackBannerState,
  MatchPhase,
  PlayerMoveInput,
  PlayerSimState,
} from '../rules/matchStateMachine';
import {
  MatchAttemptEvent,
  MatchRulesConfig,
  PlayerLearningSummary,
  PlayerSlot,
  PossessionScoreState,
} from '../rules/possession';
import { Vector3D } from '../rules/shot';

export interface RoomPlayerInfo {
  slot: PlayerSlot;
  pseudonym: string;
  ready: boolean;
  connected: boolean;
  appearancePreset: number;
}

export interface RoomLobbySnapshot {
  roomCode: string;
  packId: string;
  packTitle: string;
  roomPresetId: RoomPresetId;
  sessionLengthId: SessionLengthId;
  players: [RoomPlayerInfo | null, RoomPlayerInfo | null];
}

export interface AuthoritativeMatchStateSnapshot {
  matchId: string;
  roomCode: string;
  yourSlot: PlayerSlot;
  phase: MatchPhase;
  rules: MatchRulesConfig;
  scoreState: PossessionScoreState;
  movementClockRemainingMs: number;
  players: [PlayerSimState, PlayerSimState];
  ballPosition: Vector3D;
  liveBlockEligibility: BlockEligibilitySnapshot;
  activeDuel: {
    duelId: string;
    publicQuestion: PublicDuelQuestion;
    elapsedRealMs: number;
    readingProtected: boolean;
    yourSubmittedOptionId: string | null;
    opponentSubmitted: boolean;
    blockEligibleAtRelease: boolean;
    physicalBlock: boolean;
  } | null;
  feedbackState: FeedbackBannerState | null;
  learningSummaries: [PlayerLearningSummary, PlayerLearningSummary] | null;
  attemptEvents: MatchAttemptEvent[] | null;
}

// ============================================================================
// Client -> Server Messages (Intentions Only — Never Trusted Outcomes)
// ============================================================================

export type ClientToServerMessage =
  | {
      type: 'CREATE_ROOM';
      pseudonym: string;
      packId: string;
      roomPresetId: RoomPresetId;
      sessionLengthId: SessionLengthId;
      appearancePreset: number;
    }
  | {
      type: 'JOIN_ROOM';
      roomCode: string;
      pseudonym: string;
      appearancePreset: number;
    }
  | {
      type: 'RECONNECT_ROOM';
      roomCode: string;
      reconnectToken: string;
    }
  | {
      type: 'UPDATE_ROOM_SETTINGS';
      packId: string;
      roomPresetId: RoomPresetId;
      sessionLengthId: SessionLengthId;
    }
  | {
      type: 'SET_READY';
      ready: boolean;
    }
  | {
      type: 'MOVE_INTENT';
      input: PlayerMoveInput;
    }
  | {
      type: 'DUEL_PRELOAD_ACK';
      duelId: string;
    }
  | {
      type: 'SUBMIT_ANSWER';
      duelId: string;
      optionId: string;
    }
  | {
      type: 'PING';
      clientSendMs: number;
    };

// ============================================================================
// Server -> Client Messages (Authoritative State & Sanitized Payloads)
// ============================================================================

export type ServerToClientMessage =
  | {
      type: 'ROOM_JOINED';
      roomCode: string;
      yourSlot: PlayerSlot;
      reconnectToken: string;
      lobby: RoomLobbySnapshot;
    }
  | {
      type: 'LOBBY_UPDATE';
      lobby: RoomLobbySnapshot;
    }
  | {
      type: 'DUEL_PRELOAD';
      duelId: string;
      revealAtServerMs: number;
      publicQuestion: PublicDuelQuestion;
      blockEligibleAtRelease: boolean;
      physicalBlock: boolean;
    }
  | {
      type: 'ANSWER_STATUS';
      duelId: string;
      slot: PlayerSlot;
      submitted: true;
      yourAcceptedOptionId?: string;
    }
  | {
      type: 'ANSWER_REJECTED';
      duelId: string;
      reason: string;
    }
  | {
      type: 'MATCH_SNAPSHOT';
      serverTimeMs: number;
      snapshot: AuthoritativeMatchStateSnapshot;
    }
  | {
      type: 'CONNECTION_STATUS';
      status: 'opponent-disconnected' | 'opponent-reconnected' | 'room-expired';
      message: string;
    }
  | {
      type: 'ERROR';
      message: string;
    }
  | {
      type: 'PONG';
      clientSendMs: number;
      serverTimeMs: number;
    };
