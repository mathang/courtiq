import { describe, expect, it } from 'vitest';
import { HttpControlRetry, isTransientRoomMiss } from '../../client/game/network/httpControlRetry';
import type { ClientToServerMessage } from '../../shared/protocol/messages';

describe('HTTP room confirmation recovery', () => {
  it('retains the exact feedback duel acknowledgement after a missing-worker response', () => {
    const retry = new HttpControlRetry();
    const continueMessage: ClientToServerMessage = { type: 'CONTINUE_FEEDBACK', duelId: 'duel-42' };
    const recovered = retry.recover([continueMessage], []);
    expect(isTransientRoomMiss({ type: 'ERROR', message: 'Not currently in a room.' })).toBe(true);
    expect(recovered.queue).toEqual([continueMessage]);
    expect(recovered.queue[0]).toBe(continueMessage);
  });

  it('never replays movement, shots, answers, room creation or joins', () => {
    const retry = new HttpControlRetry();
    const batch: ClientToServerMessage[] = [
      { type: 'MOVE_INTENT', input: { moveX: 1, moveZ: 0, sprint: false, shoot: true } },
      { type: 'SUBMIT_ANSWER', duelId: 'duel-42', optionId: 'a' },
      { type: 'CREATE_ROOM', pseudonym: 'A', packId: 'p', roomPresetId: 'standard', sessionLengthId: 'quick', appearancePreset: 0 },
      { type: 'JOIN_ROOM', roomCode: 'ABC234', pseudonym: 'B', appearancePreset: 4 },
    ];
    expect(retry.recover(batch, []).queue).toEqual([]);
    expect(isTransientRoomMiss({ type: 'ERROR', message: 'Invalid reconnect token for this room.' })).toBe(false);
  });

  it('bounds retry traffic even if the worker never recovers', () => {
    const retry = new HttpControlRetry();
    const message: ClientToServerMessage = { type: 'CONTINUE_FEEDBACK', duelId: 'duel-42' };
    for (let i = 0; i < 3; i++) expect(retry.recover([message], []).requeued).toBe(1);
    expect(retry.recover([message], []).requeued).toBe(0);
  });

  it('keeps a newer ready choice and deduplicates multiple failed confirmations', () => {
    const retry = new HttpControlRetry();
    const old: ClientToServerMessage = { type: 'SET_READY', ready: true };
    const newer: ClientToServerMessage = { type: 'SET_READY', ready: false };
    expect(retry.recover([old], [newer]).queue).toEqual([newer]);
    expect(retry.recover([old, newer], []).queue).toEqual([newer]);
  });
});
