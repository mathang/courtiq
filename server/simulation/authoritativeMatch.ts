import { RoomPresetId, SessionLengthId } from '../../shared/config/balance';
import { QuestionPack } from '../../shared/content/question-schema';
import {
  AuthoritativeMatchEngine,
  PlayerMoveInput,
} from '../../shared/rules/matchStateMachine';
import { PlayerSlot } from '../../shared/rules/possession';
import { validateOnlineDuelSubmission } from '../answer-validation/duelValidator';
import { buildSanitizedSnapshotForSlot } from '../match-events/eventLogger';
import { ServerToClientMessage } from '../../shared/protocol/messages';

export interface ConnectedRoomPlayer {
  slot: PlayerSlot;
  id: string;
  pseudonym: string;
  reconnectToken: string;
  appearancePreset: number;
  ready: boolean;
  connected: boolean;
  measuredRttMs: number;
  latestInput: PlayerMoveInput;
  send: (msg: ServerToClientMessage) => void;
}

export class AuthoritativeRoomSimulation {
  public readonly roomCode: string;
  public readonly engine: AuthoritativeMatchEngine;
  private lastPreloadedDuelId: string | null = null;
  public suspendedForDisconnect = false;

  constructor(params: {
    roomCode: string;
    pack: QuestionPack;
    roomPresetId: RoomPresetId;
    sessionLengthId: SessionLengthId;
    players: [ConnectedRoomPlayer, ConnectedRoomPlayer];
    seed?: number;
  }) {
    this.roomCode = params.roomCode;
    this.engine = new AuthoritativeMatchEngine({
      matchId: `online-${params.roomCode}-${Date.now()}`,
      mode: 'online',
      pack: params.pack,
      roomPresetId: params.roomPresetId,
      sessionLengthId: params.sessionLengthId,
      player0: {
        id: params.players[0].id,
        pseudonym: params.players[0].pseudonym,
        appearancePreset: params.players[0].appearancePreset,
      },
      player1: {
        id: params.players[1].id,
        pseudonym: params.players[1].pseudonym,
        isAi: false,
        appearancePreset: params.players[1].appearancePreset,
      },
      seed: params.seed,
    });
    this.engine.startMatch();
  }

  public tick(
    realDeltaMs: number,
    players: [ConnectedRoomPlayer | null, ConnectedRoomPlayer | null]
  ): void {
    const p0 = players[0];
    const p1 = players[1];
    if (!p0 || !p1) {
      return;
    }

    // If a player is disconnected, pause at the Possession boundary (Section 14 & 19)
    const anyDisconnected = !p0.connected || !p1.connected;
    if (anyDisconnected && this.engine.phase === 'Possession') {
      this.suspendedForDisconnect = true;
      return;
    }
    this.suspendedForDisconnect = false;

    const prevPhase = this.engine.phase;
    this.engine.step(realDeltaMs, [p0.latestInput, p1.latestInput]);

    // Clear one-shot shoot intent after processing
    p0.latestInput.shoot = false;
    p1.latestInput.shoot = false;
    p0.latestInput.trick = undefined;
    p1.latestInput.trick = undefined;
    for (const p of [p0, p1]) { p.latestInput.defense = undefined; p.latestInput.dunk = false; p.latestInput.dunkStyle = undefined; }

    // If a shot just entered QuestionReady, preload the question on both devices without the answer key
    if (
      this.engine.phase === 'QuestionReady' &&
      this.engine.activeDuel &&
      this.lastPreloadedDuelId !== this.engine.activeDuel.duelId
    ) {
      this.lastPreloadedDuelId = this.engine.activeDuel.duelId;
      const revealAtServerMs = Date.now() + (this.engine.players[this.engine.scoreState.currentAttacker].finishKind === 'dunk' ? 840 : 320);
      for (const slot of [0, 1] as const) {
        const target = players[slot];
        if (target && target.connected) {
          target.send({
            type: 'DUEL_PRELOAD',
            duelId: this.engine.activeDuel.duelId,
            revealAtServerMs,
            publicQuestion: this.engine.activeDuel.publicQuestionsBySlot[slot],
            physicalBlock: this.engine.activeDuel.physicalBlock,
            blockEligibleAtRelease:
              this.engine.activeDuel.releaseSnapshot.blockEligibility.eligible,
          });
        }
      }
    }

    // Broadcast authoritative snapshot to both clients
    if (prevPhase !== this.engine.phase || true) {
      this.broadcastSnapshots(players);
    }
  }

  public broadcastSnapshots(
    players: [ConnectedRoomPlayer | null, ConnectedRoomPlayer | null]
  ): void {
    const now = Date.now();
    for (const slot of [0, 1] as const) {
      const target = players[slot];
      if (target && target.connected) {
        target.send({
          type: 'MATCH_SNAPSHOT',
          serverTimeMs: now,
          snapshot: buildSanitizedSnapshotForSlot(
            this.engine,
            this.roomCode,
            slot
          ),
        });
      }
    }
  }

  public handleAnswerSubmission(
    slot: PlayerSlot,
    duelId: string,
    optionId: string,
    players: [ConnectedRoomPlayer | null, ConnectedRoomPlayer | null]
  ): void {
    const p = players[slot];
    if (!p) {
      return;
    }

    const res = validateOnlineDuelSubmission({
      engine: this.engine,
      slot,
      duelId,
      optionId,
      measuredRttMs: p.measuredRttMs,
    });

    if (!res.accepted) {
      p.send({
        type: 'ANSWER_REJECTED',
        duelId,
        reason: res.rejectionReason ?? 'rejected',
      });
      return;
    }

    // Notify submitter of their accepted option ID, and notify opponent ONLY that a submission occurred
    for (const targetSlot of [0, 1] as const) {
      const target = players[targetSlot];
      if (target && target.connected) {
        target.send({
          type: 'ANSWER_STATUS',
          duelId,
          slot,
          submitted: true,
          yourAcceptedOptionId: targetSlot === slot ? optionId : undefined,
        });
      }
    }

    this.broadcastSnapshots(players);
  }
}
