import { isDefenseAction } from '../../shared/rules/defense';
import { isDunkStyle } from '../../shared/rules/dunks';
import { isStreetMove } from '../../shared/rules/streetMoves';
import { RoomPresetId, SessionLengthId } from '../../shared/config/balance';
import {
  ClientToServerMessage,
  RoomLobbySnapshot,
  ServerToClientMessage,
} from '../../shared/protocol/messages';
import { PlayerSlot } from '../../shared/rules/possession';
import { buildSanitizedSnapshotForSlot } from '../match-events/eventLogger';
import { ServerPackService } from '../question-service/packService';
import {
  AuthoritativeRoomSimulation,
  ConnectedRoomPlayer,
} from '../simulation/authoritativeMatch';

export interface HttpRoomSyncRequest {
  clientId: string;
  roomCode?: string | null;
  reconnectToken?: string | null;
  messages?: ClientToServerMessage[];
}

export interface HttpRoomSyncResponse {
  serverTimeMs: number;
  messages: ServerToClientMessage[];
}

interface RoomEntry {
  roomCode: string;
  packId: string;
  roomPresetId: RoomPresetId;
  sessionLengthId: SessionLengthId;
  players: [ConnectedRoomPlayer | null, ConnectedRoomPlayer | null];
  simulation: AuthoritativeRoomSimulation | null;
  lastActivityMs: number;
  seed?: number;
}

const ROOM_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes inactivity expiry

export class RoomManager {
  private rooms = new Map<string, RoomEntry>();
  private clientToRoom = new Map<
    object,
    { roomCode: string; slot: PlayerSlot }
  >();
  private httpClientHandles = new Map<string, { clientId: string }>();
  private httpOutboxes = new Map<string, ServerToClientMessage[]>();
  private lastHttpTickMs = Date.now();
  private packService: ServerPackService;
  private defaultSeed?: number;

  constructor(packService: ServerPackService, options?: { defaultSeed?: number }) {
    this.packService = packService;
    this.defaultSeed = options?.defaultSeed;
  }

  private enqueueHttpOutbox(key: string, msg: ServerToClientMessage): void {
    let box = this.httpOutboxes.get(key);
    if (!box) {
      box = [];
      this.httpOutboxes.set(key, box);
    }
    if (msg.type === 'MATCH_SNAPSHOT' || msg.type === 'LOBBY_UPDATE') {
      const existingIdx = box.findIndex((m) => m.type === msg.type);
      if (existingIdx >= 0) {
        box.splice(existingIdx, 1);
      }
    }
    box.push(msg);
    if (box.length > 40) {
      box.shift();
    }
  }

  private generateRoomCode(): string {
    const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = '';
      for (let i = 0; i < 6; i++) {
        code += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
      if (!this.rooms.has(code)) {
        return code;
      }
    }
    return `CQ${Date.now().toString(36).slice(-4).toUpperCase()}`;
  }

  private generateToken(): string {
    return `${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  }

  private toLobbySnapshot(room: RoomEntry): RoomLobbySnapshot {
    const pack = this.packService.getPackOrThrow(room.packId);
    return {
      roomCode: room.roomCode,
      packId: pack.packId,
      packTitle: pack.title,
      roomPresetId: room.roomPresetId,
      sessionLengthId: room.sessionLengthId,
      players: [
        room.players[0]
          ? {
              slot: 0,
              pseudonym: room.players[0].pseudonym,
              ready: room.players[0].ready,
              connected: room.players[0].connected,
              appearancePreset: room.players[0].appearancePreset,
            }
          : null,
        room.players[1]
          ? {
              slot: 1,
              pseudonym: room.players[1].pseudonym,
              ready: room.players[1].ready,
              connected: room.players[1].connected,
              appearancePreset: room.players[1].appearancePreset,
            }
          : null,
      ],
    };
  }

  public handleMessage(
    clientHandle: object,
    send: (msg: ServerToClientMessage) => void,
    msg: ClientToServerMessage
  ): void {
    if (msg.type === 'PING') {
      send({
        type: 'PONG',
        clientSendMs: msg.clientSendMs,
        serverTimeMs: Date.now(),
      });
      const assoc = this.clientToRoom.get(clientHandle);
      if (assoc) {
        const room = this.rooms.get(assoc.roomCode);
        const player = room?.players[assoc.slot];
        if (player) {
          const rtt = Date.now() - msg.clientSendMs;
          if (rtt >= 0 && rtt < 2000) {
            player.measuredRttMs = Math.round(player.measuredRttMs * 0.7 + rtt * 0.3);
          }
        }
      }
      return;
    }

    if (msg.type === 'CREATE_ROOM') {
      const roomCode = this.generateRoomCode();
      const reconnectToken = this.generateToken();
      const pack = this.packService.getPackOrThrow(msg.packId);

      const player0: ConnectedRoomPlayer = {
        slot: 0,
        id: `p0-${roomCode}`,
        pseudonym: (msg.pseudonym || 'Player 1').slice(0, 20),
        reconnectToken,
        appearancePreset: msg.appearancePreset ?? 0,
        ready: false,
        connected: true,
        measuredRttMs: 30,
        latestInput: { moveX: 0, moveZ: 0, sprint: false, shoot: false },
        send,
      };

      const room: RoomEntry = {
        roomCode,
        packId: pack.packId,
        roomPresetId: msg.roomPresetId,
        sessionLengthId: msg.sessionLengthId,
        players: [player0, null],
        simulation: null,
        lastActivityMs: Date.now(),
        seed: this.defaultSeed,
      };

      this.rooms.set(roomCode, room);
      this.clientToRoom.set(clientHandle, { roomCode, slot: 0 });

      send({
        type: 'ROOM_JOINED',
        roomCode,
        yourSlot: 0,
        reconnectToken,
        lobby: this.toLobbySnapshot(room),
      });
      return;
    }

    if (msg.type === 'JOIN_ROOM') {
      const code = msg.roomCode.trim().toUpperCase();
      const room = this.rooms.get(code);
      if (!room) {
        send({ type: 'ERROR', message: `Room "${code}" was not found.` });
        return;
      }
      if (room.players[0] && room.players[1]) {
        send({
          type: 'ERROR',
          message: `Room "${code}" already has two active players.`,
        });
        return;
      }

      const slot: PlayerSlot = room.players[0] === null ? 0 : 1;
      const reconnectToken = this.generateToken();
      const newPlayer: ConnectedRoomPlayer = {
        slot,
        id: `p${slot}-${code}`,
        pseudonym: (msg.pseudonym || `Player ${slot + 1}`).slice(0, 20),
        reconnectToken,
        appearancePreset: msg.appearancePreset ?? slot,
        ready: false,
        connected: true,
        measuredRttMs: 30,
        latestInput: { moveX: 0, moveZ: 0, sprint: false, shoot: false },
        send,
      };

      room.players[slot] = newPlayer;
      room.lastActivityMs = Date.now();
      this.clientToRoom.set(clientHandle, { roomCode: code, slot });

      const lobby = this.toLobbySnapshot(room);
      send({
        type: 'ROOM_JOINED',
        roomCode: code,
        yourSlot: slot,
        reconnectToken,
        lobby,
      });

      const otherSlot: PlayerSlot = slot === 0 ? 1 : 0;
      room.players[otherSlot]?.send({ type: 'LOBBY_UPDATE', lobby });
      return;
    }

    if (msg.type === 'RECONNECT_ROOM') {
      const code = msg.roomCode.trim().toUpperCase();
      const room = this.rooms.get(code);
      if (!room) {
        send({
          type: 'ERROR',
          message: `Room "${code}" has expired or does not exist.`,
        });
        return;
      }

      const matchPlayer =
        room.players[0]?.reconnectToken === msg.reconnectToken
          ? room.players[0]
          : room.players[1]?.reconnectToken === msg.reconnectToken
            ? room.players[1]
            : null;

      if (!matchPlayer) {
        send({
          type: 'ERROR',
          message: 'Invalid reconnect token for this room.',
        });
        return;
      }

      matchPlayer.connected = true;
      matchPlayer.send = send;
      room.lastActivityMs = Date.now();
      this.clientToRoom.set(clientHandle, {
        roomCode: code,
        slot: matchPlayer.slot,
      });

      send({
        type: 'ROOM_JOINED',
        roomCode: code,
        yourSlot: matchPlayer.slot,
        reconnectToken: matchPlayer.reconnectToken,
        lobby: this.toLobbySnapshot(room),
      });

      const otherSlot: PlayerSlot = matchPlayer.slot === 0 ? 1 : 0;
      room.players[otherSlot]?.send({
        type: 'CONNECTION_STATUS',
        status: 'opponent-reconnected',
        message: `${matchPlayer.pseudonym} reconnected. Play resumed!`,
      });

      if (room.simulation) {
        room.simulation.broadcastSnapshots(room.players);
      }
      return;
    }

    const assoc = this.clientToRoom.get(clientHandle);
    if (!assoc) {
      send({ type: 'ERROR', message: 'Not currently in a room.' });
      return;
    }

    const room = this.rooms.get(assoc.roomCode);
    if (!room) {
      send({ type: 'ERROR', message: 'Room no longer exists.' });
      return;
    }
    room.lastActivityMs = Date.now();

    if (msg.type === 'UPDATE_ROOM_SETTINGS') {
      if (room.simulation) {
        return;
      }
      const pack = this.packService.getPackOrThrow(msg.packId);
      room.packId = pack.packId;
      room.roomPresetId = msg.roomPresetId;
      room.sessionLengthId = msg.sessionLengthId;
      const lobby = this.toLobbySnapshot(room);
      room.players[0]?.send({ type: 'LOBBY_UPDATE', lobby });
      room.players[1]?.send({ type: 'LOBBY_UPDATE', lobby });
      return;
    }

    if (msg.type === 'SET_READY') {
      const player = room.players[assoc.slot];
      if (!player) {
        return;
      }
      player.ready = msg.ready;
      const lobby = this.toLobbySnapshot(room);
      room.players[0]?.send({ type: 'LOBBY_UPDATE', lobby });
      room.players[1]?.send({ type: 'LOBBY_UPDATE', lobby });

      if (
        !room.simulation &&
        room.players[0]?.ready &&
        room.players[1]?.ready
      ) {
        const pack = this.packService.getPackOrThrow(room.packId);
        room.simulation = new AuthoritativeRoomSimulation({
          roomCode: room.roomCode,
          pack,
          roomPresetId: room.roomPresetId,
          sessionLengthId: room.sessionLengthId,
          players: [room.players[0], room.players[1]],
          seed: room.seed,
        });
        room.simulation.broadcastSnapshots(room.players);
      }
      return;
    }

    if (msg.type === 'MOVE_INTENT') {
      const player = room.players[assoc.slot];
      if (player) {
        player.latestInput = {
          moveX: Number(msg.input.moveX) || 0,
          moveZ: Number(msg.input.moveZ) || 0,
          sprint: Boolean(msg.input.sprint),
          shoot: Boolean(msg.input.shoot) || player.latestInput.shoot,
          trick: isStreetMove(msg.input.trick) ? msg.input.trick : player.latestInput.trick,
          defense: isDefenseAction(msg.input.defense) ? msg.input.defense : player.latestInput.defense,
          dunk: Boolean(msg.input.dunk) || player.latestInput.dunk,
          dunkStyle: isDunkStyle(msg.input.dunkStyle) ? msg.input.dunkStyle : player.latestInput.dunkStyle,
        };
        if (
          (player.latestInput.shoot || player.latestInput.dunk) &&
          room.simulation &&
          room.simulation.engine.phase === 'Possession' &&
          room.simulation.engine.scoreState.currentAttacker === assoc.slot
        ) {
          room.simulation.tick(16, room.players);
        }
      }
      return;
    }

    if (msg.type === 'DUEL_PRELOAD_ACK') {
      room.simulation?.engine.confirmClientDuelReady(assoc.slot, msg.duelId);
      room.simulation?.broadcastSnapshots(room.players);
      return;
    }

    if (msg.type === 'CONTINUE_FEEDBACK') {
      room.simulation?.engine.acknowledgeFeedback(assoc.slot, msg.duelId);
      room.simulation?.broadcastSnapshots(room.players);
      return;
    }

    if (msg.type === 'SUBMIT_ANSWER') {
      room.simulation?.handleAnswerSubmission(
        assoc.slot,
        msg.duelId,
        msg.optionId,
        room.players
      );
      return;
    }
  }

  public handleDisconnect(clientHandle: object): void {
    const assoc = this.clientToRoom.get(clientHandle);
    if (!assoc) {
      return;
    }
    this.clientToRoom.delete(clientHandle);

    const room = this.rooms.get(assoc.roomCode);
    if (!room) {
      return;
    }

    const player = room.players[assoc.slot];
    if (player) {
      player.connected = false;
      player.latestInput = { moveX: 0, moveZ: 0, sprint: false, shoot: false };
    }

    const otherSlot: PlayerSlot = assoc.slot === 0 ? 1 : 0;
    const other = room.players[otherSlot];
    if (other && other.connected) {
      other.send({
        type: 'CONNECTION_STATUS',
        status: 'opponent-disconnected',
        message: `${player?.pseudonym ?? 'Opponent'} disconnected. Waiting for reconnection...`,
      });
    }
  }

  public tickAllRooms(realDeltaMs: number): void {
    const now = Date.now();
    for (const [code, room] of this.rooms.entries()) {
      if (now - room.lastActivityMs > ROOM_EXPIRY_MS) {
        room.players[0]?.send({
          type: 'CONNECTION_STATUS',
          status: 'room-expired',
          message: 'Room expired due to inactivity.',
        });
        room.players[1]?.send({
          type: 'CONNECTION_STATUS',
          status: 'room-expired',
          message: 'Room expired due to inactivity.',
        });
        this.rooms.delete(code);
        continue;
      }

      if (room.simulation) {
        room.simulation.tick(realDeltaMs, room.players);
      }
    }
  }

  public handleHttpSync(req: HttpRoomSyncRequest): HttpRoomSyncResponse {
    const now = Date.now();
    const deltaMs = Math.min(250, Math.max(0, now - this.lastHttpTickMs));
    this.lastHttpTickMs = now;
    if (deltaMs > 0) {
      this.tickAllRooms(deltaMs);
    }

    const clientId = String(req.clientId || 'anon-http-client');
    let handle = this.httpClientHandles.get(clientId);
    if (!handle) {
      handle = { clientId };
      this.httpClientHandles.set(clientId, handle);
    }

    // Re-bind handle if roomCode + reconnectToken were supplied
    if (!this.clientToRoom.has(handle) && req.roomCode && req.reconnectToken) {
      const code = req.roomCode.trim().toUpperCase();
      const room = this.rooms.get(code);
      if (room) {
        const matched =
          room.players[0]?.reconnectToken === req.reconnectToken
            ? room.players[0]
            : room.players[1]?.reconnectToken === req.reconnectToken
              ? room.players[1]
              : null;
        if (matched) {
          matched.connected = true;
          const outboxKey = `${code}:${matched.slot}`;
          matched.send = (m) => this.enqueueHttpOutbox(outboxKey, m);
          this.clientToRoom.set(handle, { roomCode: code, slot: matched.slot });
        }
      }
    }

    const directReplies: ServerToClientMessage[] = [];
    const incoming = Array.isArray(req.messages) ? req.messages : [];

    for (const msg of incoming) {
      const staged: ServerToClientMessage[] = [];
      this.handleMessage(handle, (reply) => staged.push(reply), msg);

      const assoc = this.clientToRoom.get(handle);
      if (assoc) {
        const outboxKey = `${assoc.roomCode}:${assoc.slot}`;
        const room = this.rooms.get(assoc.roomCode);
        const player = room?.players[assoc.slot];
        if (player) {
          player.send = (m) => this.enqueueHttpOutbox(outboxKey, m);
        }
        for (const s of staged) {
          this.enqueueHttpOutbox(outboxKey, s);
        }
      } else {
        directReplies.push(...staged);
      }
    }

    const assoc = this.clientToRoom.get(handle);
    if (assoc) {
      const outboxKey = `${assoc.roomCode}:${assoc.slot}`;
      const drained = this.httpOutboxes.get(outboxKey) ?? [];
      this.httpOutboxes.set(outboxKey, []);
      directReplies.push(...drained);

      const room = this.rooms.get(assoc.roomCode);
      if (room) {
        room.lastActivityMs = now;
        if (room.simulation) {
          const hasSnapshot = directReplies.some(
            (m) => m.type === 'MATCH_SNAPSHOT'
          );
          if (!hasSnapshot) {
            directReplies.push({
              type: 'MATCH_SNAPSHOT',
              serverTimeMs: now,
              snapshot: buildSanitizedSnapshotForSlot(
                room.simulation.engine,
                room.roomCode,
                assoc.slot
              ),
            });
          }
        }
      }
    }

    return {
      serverTimeMs: now,
      messages: directReplies,
    };
  }
}
