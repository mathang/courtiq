import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { handler as netlifyHealthHandler } from '../../netlify/functions/health';
import { createRoomHandler } from '../../netlify/functions/room';
import { startCourtIqServer, CourtIqServerInstance } from '../../server/index';
import {
  ClientToServerMessage,
  ServerToClientMessage,
} from '../../shared/protocol/messages';

// Retain the future multiplayer contract while the public release is solo-only.
const netlifyRoomHandler = createRoomHandler({ multiplayerEnabled: true });

function connectTestClient(port: number): Promise<{
  ws: WebSocket;
  messages: ServerToClientMessage[];
  send: (msg: ClientToServerMessage) => void;
  waitFor: <T extends ServerToClientMessage['type']>(
    type: T,
    predicate?: (msg: Extract<ServerToClientMessage, { type: T }>) => boolean,
    timeoutMs?: number
  ) => Promise<Extract<ServerToClientMessage, { type: T }>>;
}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const messages: ServerToClientMessage[] = [];
    const listeners = new Set<(msg: ServerToClientMessage) => void>();

    ws.on('message', (raw) => {
      const parsed = JSON.parse(String(raw)) as ServerToClientMessage;
      messages.push(parsed);
      for (const fn of listeners) {
        fn(parsed);
      }
    });

    ws.once('open', () => {
      resolve({
        ws,
        messages,
        send: (msg) => ws.send(JSON.stringify(msg)),
        waitFor: (type, predicate, timeoutMs = 4000) =>
          new Promise((resWait, rejWait) => {
            for (const existing of messages) {
              if (
                existing.type === type &&
                (!predicate || predicate(existing as never))
              ) {
                resWait(existing as never);
                return;
              }
            }
            const timer = setTimeout(() => {
              listeners.delete(onMsg);
              rejWait(new Error(`Timeout waiting for message type "${type}"`));
            }, timeoutMs);

            const onMsg = (m: ServerToClientMessage) => {
              if (m.type === type && (!predicate || predicate(m as never))) {
                clearTimeout(timer);
                listeners.delete(onMsg);
                resWait(m as never);
              }
            };
            listeners.add(onMsg);
          }),
      });
    });

    ws.once('error', reject);
  });
}

describe('Authoritative online multiplayer server & room synchronization (Sections 13, 14 & 22)', () => {
  let srv: CourtIqServerInstance | null = null;

  afterEach(async () => {
    if (srv) {
      await srv.close();
      srv = null;
    }
  });

  it('coordinates a two-player private room, hides answer keys pre-resolution, rejects stale/duplicate answers, and restores state on reconnect', async () => {
    srv = await startCourtIqServer({
      port: 0,
      multiplayerEnabled: true,
      tickIntervalMs: 10000, // Manual deterministic ticking via srv.roomManager.tickAllRooms
      defaultSeed: 99,
    });

    const c0 = await connectTestClient(srv.port);
    const c1 = await connectTestClient(srv.port);
    const c2 = await connectTestClient(srv.port);

    // 1. Player 0 creates room
    c0.send({
      type: 'CREATE_ROOM',
      pseudonym: 'StudentA',
      packId: 'spx101-w09-performance-analysis',
      roomPresetId: 'standard',
      sessionLengthId: 'quick',
      appearancePreset: 0,
    });
    const joined0 = await c0.waitFor('ROOM_JOINED');
    const roomCode = joined0.roomCode;
    expect(roomCode.length).toBeGreaterThanOrEqual(4);
    expect(joined0.yourSlot).toBe(0);

    // 2. Player 1 joins with room code
    c1.send({
      type: 'JOIN_ROOM',
      roomCode,
      pseudonym: 'StudentB',
      appearancePreset: 1,
    });
    const joined1 = await c1.waitFor('ROOM_JOINED');
    expect(joined1.yourSlot).toBe(1);

    // 3. Third client attempting to join the 2-player room is rejected
    c2.send({
      type: 'JOIN_ROOM',
      roomCode,
      pseudonym: 'Intruder',
      appearancePreset: 2,
    });
    const err2 = await c2.waitFor('ERROR');
    expect(err2.message).toContain('two active players');
    c2.ws.close();

    // 4. Both players mark ready -> Match starts in Possession phase
    c0.send({ type: 'SET_READY', ready: true });
    c1.send({ type: 'SET_READY', ready: true });

    const snap0 = await c0.waitFor(
      'MATCH_SNAPSHOT',
      (m) => m.snapshot.phase === 'Possession'
    );
    expect(snap0.snapshot.scoreState.scores).toEqual([0, 0]);

    // 5. Player 0 shoots -> Both receive DUEL_PRELOAD without correctOptionId or explanation
    c0.send({
      type: 'MOVE_INTENT',
      input: { moveX: 0, moveZ: 0, sprint: false, shoot: true },
    });

    const preload0 = await c0.waitFor('DUEL_PRELOAD');
    const preload1 = await c1.waitFor('DUEL_PRELOAD');
    expect(preload0.duelId).toBe(preload1.duelId);
    expect(preload0.revealAtServerMs).toBe(preload1.revealAtServerMs);
    expect(preload0.publicQuestion.id).toBe(preload1.publicQuestion.id);
    expect(preload0.publicQuestion.stem).toBe(preload1.publicQuestion.stem);
    expect([...preload0.publicQuestion.options].sort((a, b) => a.id.localeCompare(b.id)))
      .toEqual([...preload1.publicQuestion.options].sort((a, b) => a.id.localeCompare(b.id)));
    expect(preload0.publicQuestion.readingMs).toBe(preload1.publicQuestion.readingMs);
    expect(preload0.publicQuestion.answerWindowMs).toBe(preload1.publicQuestion.answerWindowMs);

    const rawQ0 = preload0.publicQuestion as unknown as Record<string, unknown>;
    expect('correctOptionId' in rawQ0).toBe(false);
    expect('explanation' in rawQ0).toBe(false);
    expect('optionFeedback' in rawQ0).toBe(false);

    // Acknowledge preload and step into Duel phase
    c0.send({ type: 'DUEL_PRELOAD_ACK', duelId: preload0.duelId });
    c1.send({ type: 'DUEL_PRELOAD_ACK', duelId: preload1.duelId });
    await new Promise((r) => setTimeout(r, 25));
    srv.roomManager.tickAllRooms(250);
    srv.roomManager.tickAllRooms(250);

    const duelSnap0 = await c0.waitFor(
      'MATCH_SNAPSHOT',
      (m) => m.snapshot.phase === 'Duel'
    );
    expect(duelSnap0.snapshot.activeDuel).not.toBeNull();
    expect(
      'correctOptionId' in
        (duelSnap0.snapshot.activeDuel!.publicQuestion as unknown as Record<
          string,
          unknown
        >)
    ).toBe(false);

    // 6. Submitting during the 2000ms protected reading period is rejected
    c0.send({
      type: 'SUBMIT_ANSWER',
      duelId: preload0.duelId,
      optionId: preload0.publicQuestion.options[0].id,
    });
    const rejectedEarly = await c0.waitFor('ANSWER_REJECTED');
    expect(rejectedEarly.reason).toBe('reading-period-protected');

    // Advance past 2000ms reading period (e.g. +2500ms)
    for (let i = 0; i < 12; i++) {
      srv.roomManager.tickAllRooms(250);
    }

    // 7. Reject stale duel ID
    c0.send({
      type: 'SUBMIT_ANSWER',
      duelId: 'stale-duel-id-999',
      optionId: preload0.publicQuestion.options[0].id,
    });
    const rejectedStale = await c0.waitFor(
      'ANSWER_REJECTED',
      (m) => m.duelId === 'stale-duel-id-999'
    );
    expect(rejectedStale.reason).toBe('wrong-duel-id');

    // 8. Player 0 submits valid answer; duplicate submission is rejected
    const chosenOpt0 = preload0.publicQuestion.options[0].id;
    c0.send({
      type: 'SUBMIT_ANSWER',
      duelId: preload0.duelId,
      optionId: chosenOpt0,
    });
    const status0 = await c0.waitFor(
      'ANSWER_STATUS',
      (m) => m.slot === 0 && m.duelId === preload0.duelId
    );
    expect(status0.yourAcceptedOptionId).toBe(chosenOpt0);

    // Opponent (c1) sees that slot 0 submitted, but NOT which option they chose!
    const oppStatusOnC1 = await c1.waitFor(
      'ANSWER_STATUS',
      (m) => m.slot === 0 && m.duelId === preload0.duelId
    );
    expect(oppStatusOnC1.yourAcceptedOptionId).toBeUndefined();

    // Duplicate answer from Player 0 is rejected
    c0.send({
      type: 'SUBMIT_ANSWER',
      duelId: preload0.duelId,
      optionId: preload0.publicQuestion.options[1].id,
    });
    const rejectedDup = await c0.waitFor(
      'ANSWER_REJECTED',
      (m) => m.reason === 'duplicate-submission'
    );
    expect(rejectedDup.reason).toBe('duplicate-submission');

    // 9. Player 1 submits -> Duel resolves -> Both devices agree on Feedback and scores
    c1.send({
      type: 'SUBMIT_ANSWER',
      duelId: preload1.duelId,
      optionId: preload1.publicQuestion.options[0].id,
    });
    await new Promise((r) => setTimeout(r, 25));

    // Step through Resolution animation into Feedback
    for (let i = 0; i < 12; i++) {
      srv.roomManager.tickAllRooms(200);
    }

    const fb0 = await c0.waitFor(
      'MATCH_SNAPSHOT',
      (m) => m.snapshot.phase === 'Feedback'
    );
    const fb1 = await c1.waitFor(
      'MATCH_SNAPSHOT',
      (m) => m.snapshot.phase === 'Feedback'
    );

    expect(fb0.snapshot.scoreState.scores).toEqual(
      fb1.snapshot.scoreState.scores
    );
    expect(fb0.snapshot.feedbackState?.outcome).toBe(
      fb1.snapshot.feedbackState?.outcome
    );
    expect(fb0.snapshot.feedbackState?.explanation.length).toBeGreaterThan(10);

    // 10. Test disconnect & reconnect restoration
    c1.ws.close();
    const discNotice = await c0.waitFor(
      'CONNECTION_STATUS',
      (m) => m.status === 'opponent-disconnected'
    );
    expect(discNotice.status).toBe('opponent-disconnected');

    const c1Reconnected = await connectTestClient(srv.port);
    c1Reconnected.send({
      type: 'RECONNECT_ROOM',
      roomCode,
      reconnectToken: joined1.reconnectToken,
    });
    const rejoined = await c1Reconnected.waitFor('ROOM_JOINED');
    expect(rejoined.yourSlot).toBe(1);

    const restoredSnap = await c1Reconnected.waitFor('MATCH_SNAPSHOT');
    expect(restoredSnap.snapshot.scoreState.scores).toEqual(
      fb0.snapshot.scoreState.scores
    );

    // Explanations do not time out. Each authenticated student confirms only their own slot.
    for (let i=0;i<80;i++) srv.roomManager.tickAllRooms(250);
    c0.send({type:'CONTINUE_FEEDBACK',duelId:'stale-feedback'});
    c0.send({type:'CONTINUE_FEEDBACK',duelId:preload0.duelId});
    const waiting=await c0.waitFor('MATCH_SNAPSHOT', m=>m.snapshot.phase==='Feedback' && m.snapshot.feedbackState?.continueReady?.[0]===true);
    expect(waiting.snapshot.feedbackState!.continueReady).toEqual([true,false]);
    c1Reconnected.send({type:'CONTINUE_FEEDBACK',duelId:preload0.duelId});
    await c1Reconnected.waitFor('MATCH_SNAPSHOT', m=>m.snapshot.phase==='Possession');

    c0.ws.close();
    c1Reconnected.ws.close();
  });

  it('supports serverless 2-player online rooms via the Netlify Functions HTTP adapter (/api/room)', async () => {
    const healthRes = await netlifyHealthHandler({ httpMethod: 'GET' });
    expect(healthRes.statusCode).toBe(200);
    const healthBody = JSON.parse(healthRes.body) as {
      status: string;
      packs: unknown[];
    };
    expect(healthBody.status).toBe('ok');
    expect(healthBody.packs.length).toBeGreaterThanOrEqual(2);

    // 1. Player A creates a room via Netlify Function
    const createRes = await netlifyRoomHandler({
      httpMethod: 'POST',
      body: JSON.stringify({
        clientId: 'netlify-client-A',
        messages: [
          {
            type: 'CREATE_ROOM',
            pseudonym: 'NetlifyA',
            packId: 'spx101-w09-performance-analysis',
            roomPresetId: 'standard',
            sessionLengthId: 'quick',
            appearancePreset: 0,
          },
        ],
      }),
    });
    expect(createRes.statusCode).toBe(200);
    const createPayload = JSON.parse(createRes.body) as {
      messages: ServerToClientMessage[];
    };
    const joinedA = createPayload.messages.find(
      (m): m is Extract<ServerToClientMessage, { type: 'ROOM_JOINED' }> =>
        m.type === 'ROOM_JOINED'
    );
    expect(joinedA).toBeDefined();
    const roomCode = joinedA!.roomCode;

    // 2. Player B joins via Netlify Function
    const joinRes = await netlifyRoomHandler({
      httpMethod: 'POST',
      body: JSON.stringify({
        clientId: 'netlify-client-B',
        messages: [
          {
            type: 'JOIN_ROOM',
            roomCode,
            pseudonym: 'NetlifyB',
            appearancePreset: 1,
          },
        ],
      }),
    });
    const joinPayload = JSON.parse(joinRes.body) as {
      messages: ServerToClientMessage[];
    };
    const joinedB = joinPayload.messages.find(
      (m): m is Extract<ServerToClientMessage, { type: 'ROOM_JOINED' }> =>
        m.type === 'ROOM_JOINED'
    );
    expect(joinedB?.yourSlot).toBe(1);

    // 3. Both mark ready -> Match starts in Possession
    await netlifyRoomHandler({
      httpMethod: 'POST',
      body: JSON.stringify({
        clientId: 'netlify-client-A',
        roomCode,
        reconnectToken: joinedA!.reconnectToken,
        messages: [{ type: 'SET_READY', ready: true }],
      }),
    });
    const readyBRes = await netlifyRoomHandler({
      httpMethod: 'POST',
      body: JSON.stringify({
        clientId: 'netlify-client-B',
        roomCode,
        reconnectToken: joinedB!.reconnectToken,
        messages: [{ type: 'SET_READY', ready: true }],
      }),
    });
    const readyBPayload = JSON.parse(readyBRes.body) as {
      messages: ServerToClientMessage[];
    };
    const snapB = readyBPayload.messages.find(
      (m): m is Extract<ServerToClientMessage, { type: 'MATCH_SNAPSHOT' }> =>
        m.type === 'MATCH_SNAPSHOT'
    );
    expect(snapB?.snapshot.phase).toBe('Possession');

    // 4. Player A initiates a shot -> DUEL_PRELOAD is delivered without answer key leakage
    const shootRes = await netlifyRoomHandler({
      httpMethod: 'POST',
      body: JSON.stringify({
        clientId: 'netlify-client-A',
        roomCode,
        reconnectToken: joinedA!.reconnectToken,
        messages: [
          {
            type: 'MOVE_INTENT',
            input: { moveX: 0, moveZ: 0, sprint: false, shoot: true },
          },
        ],
      }),
    });
    const shootPayload = JSON.parse(shootRes.body) as {
      messages: ServerToClientMessage[];
    };
    const preloadA = shootPayload.messages.find(
      (m): m is Extract<ServerToClientMessage, { type: 'DUEL_PRELOAD' }> =>
        m.type === 'DUEL_PRELOAD'
    );
    expect(preloadA).toBeDefined();
    const pollB = await netlifyRoomHandler({ httpMethod: 'POST', body: JSON.stringify({
      clientId: 'netlify-client-B', roomCode, reconnectToken: joinedB!.reconnectToken, messages: [],
    }) });
    const messagesB = JSON.parse(pollB.body).messages as ServerToClientMessage[];
    const preloadB = messagesB.find((m): m is Extract<ServerToClientMessage, { type: 'DUEL_PRELOAD' }> => m.type === 'DUEL_PRELOAD');
    expect(preloadB).toBeDefined();
    expect(preloadA!.duelId).toBe(preloadB!.duelId);
    expect(preloadA!.revealAtServerMs).toBe(preloadB!.revealAtServerMs);
    expect(preloadA!.publicQuestion.id).toBe(preloadB!.publicQuestion.id);
    expect(preloadA!.publicQuestion.stem).toBe(preloadB!.publicQuestion.stem);
    expect([...preloadA!.publicQuestion.options].sort((a, b) => a.id.localeCompare(b.id)))
      .toEqual([...preloadB!.publicQuestion.options].sort((a, b) => a.id.localeCompare(b.id)));
    expect(preloadA!.publicQuestion.readingMs).toBe(preloadB!.publicQuestion.readingMs);
    expect(preloadA!.publicQuestion.answerWindowMs).toBe(preloadB!.publicQuestion.answerWindowMs);
    expect('correctOptionId' in preloadB!.publicQuestion).toBe(false);
    expect('explanation' in preloadB!.publicQuestion).toBe(false);
    expect('optionFeedback' in preloadB!.publicQuestion).toBe(false);
    expect(
      'correctOptionId' in
        (preloadA!.publicQuestion as unknown as Record<string, unknown>)
    ).toBe(false);
  });
});
