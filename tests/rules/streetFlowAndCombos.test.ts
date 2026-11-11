import { describe, expect, it } from 'vitest';
import { BUNDLED_QUESTION_PACKS } from '../../content/packRegistry';
import { AuthoritativeMatchEngine, PlayerMoveInput } from '../../shared/rules/matchStateMachine';
import { getAirPose } from '../../shared/rules/streetMoves';
import { STREET_FLOW_CONFIG } from '../../shared/config/balance';
import { RoomManager } from '../../server/rooms/roomManager';
import { ServerPackService } from '../../server/question-service/packService';
import { ServerToClientMessage } from '../../shared/protocol/messages';

const NEUTRAL: PlayerMoveInput = { moveX: 0, moveZ: 0, sprint: false, shoot: false };

function createMatch(seed = 2026) {
  const engine = new AuthoritativeMatchEngine({
    matchId: 'combo-test',
    mode: 'solo',
    pack: BUNDLED_QUESTION_PACKS[0],
    roomPresetId: 'standard',
    sessionLengthId: 'quick',
    player0: { id: 'p0', pseudonym: 'StudentA' },
    player1: { id: 'p1', pseudonym: 'StudentB', isAi: false },
    seed,
  });
  engine.startMatch();
  return engine;
}

describe('NBA Street input buffering, trick chains, counter-steals & Street Flow synergy', () => {
  it.each([1000 / 60, 1000 / 30, 50, 100])(
    'buffers an early distinct trick, then chains crossover -> spin -> jumper outside the paint at a %sms step',
    (dtMs) => {
      const e = createMatch(11);
      e.players[0].x = 0;
      e.players[0].z = -1.2;
      e.players[1].x = 3.5; // Clear lane to test pure chain timing

      // Trigger crossover
      e.step(dtMs, [{ ...NEUTRAL, moveZ: -1, trick: 'crossover' }, NEUTRAL]);
      expect(e.players[0].streetMove).toBe('crossover');
      expect(e.players[0].trickCombo).toBe(1);

      // Step to ~120ms (well before 0.34 * 0.65 = 221ms cancel window) and press spin!
      let elapsed = dtMs;
      while (elapsed < 115) {
        e.step(dtMs, [{ ...NEUTRAL, moveZ: -1 }, NEUTRAL]);
        elapsed += dtMs;
      }
      e.step(dtMs, [{ ...NEUTRAL, moveZ: -1, trick: 'spin' }, NEUTRAL]);

      // Advance past cancel window with neutral trick input — buffered spin MUST fire automatically!
      let sawSpinChain = false;
      for (let t = 0; t < 320; t += dtMs) {
        e.step(dtMs, [{ ...NEUTRAL, moveZ: -1 }, NEUTRAL]);
        if (e.players[0].streetMove === 'spin' && e.players[0].trickCombo === 2) {
          sawSpinChain = true;
          break;
        }
      }
      expect(sawSpinChain).toBe(true);

      // Buffer the primary action mid-spin; this route ends outside the paint.
      e.step(dtMs, [{ ...NEUTRAL, moveZ: -1, shoot: true }, NEUTRAL]);
      for (let t = 0; t < 400 && e.phase === 'Possession'; t += dtMs) {
        e.step(dtMs, [{ ...NEUTRAL, moveZ: -1 }, NEUTRAL]);
      }
      expect(e.phase).toBe('QuestionReady');
      expect(e.players[0].finishKind).toBe('jump');
      expect(Math.abs(e.activeDuel!.releaseSnapshot.shooterPos.x)).toBeGreaterThan(2.45);
      expect(e.activeDuel?.releaseSnapshot.comboCount).toBe(2);
      expect(e.activeDuel?.releaseSnapshot.setupBonus).toBe(0.04);
    },
  );

  it('protects a clean first crossover from an immediate swipe and freezes the swiping defender for 1.0s', () => {
    const e = createMatch(19);
    // Reproduce exact baseline playtest geometry: attacker at z=2.6, defender at z=1.35 facing attacker
    e.players[0].x = 0;
    e.players[0].z = 2.6;
    e.players[1].x = 0;
    e.players[1].z = 1.35;
    e.players[1].facingAngle = 0;

    // Defender swipes while attacker initiates clean crossover
    e.step(16, [
      { ...NEUTRAL, moveZ: -1, trick: 'crossover' },
      { ...NEUTRAL, defense: 'swipe' },
    ]);
    for (let t = 0; t < 200; t += 16) {
      e.step(16, [{ ...NEUTRAL, moveZ: -1 }, NEUTRAL]);
    }
    expect(e.scoreState.currentAttacker).toBe(0);
    expect(e.players[1].defenseResult).toBe('miss');
    expect(e.players[1].defenseRecoverySec).toBeGreaterThan(0.75);
  });

  it('exposes the ball for a counter-steal when spamming the same trick into a close defender', () => {
    const e = createMatch(23);
    e.players[0].x = 0;
    e.players[0].z = 2.0;
    e.players[1].x = 0.28;
    e.players[1].z = 1.05;
    e.players[1].facingAngle = 0;

    // First crossover finishes; attacker stays right in defender's face and spams crossover again on cooldown
    e.players[0].lastTrick = 'crossover';
    e.players[0].moveCooldownSec = 0.65;
    e.step(16, [
      { ...NEUTRAL, trick: 'crossover' },
      { ...NEUTRAL, defense: 'swipe' },
    ]);
    expect(e.players[0].trickOverexposedSec).toBeGreaterThan(0.4);
    for (let t = 0; t < 180; t += 16) {
      e.step(16, [NEUTRAL, NEUTRAL]);
    }
    expect(e.scoreState.currentAttacker).toBe(1);
    expect(e.attemptEvents[0]?.basketballOutcome).toBe('steal-turnover');
    expect(e.players[1].streetFlow).toBeCloseTo(STREET_FLOW_CONFIG.flowCleanSteal, 3);
  });

  it('keeps Street Flow separate from the learning Fire streak, whose boost never overrides blocks', () => {
    const e = createMatch(31);
    e.players[0].streetFlow = 0.72;
    e.players[1].x = 0;
    e.players[1].z = 1.2;

    // Clean tricks build style momentum; only a learning streak can ignite Fire.
    e.step(16, [{ ...NEUTRAL, trick: 'crossover' }, NEUTRAL]);
    expect(e.players[0].streetFlow).toBeGreaterThanOrEqual(0.8);
    expect(e.players[0].onFire).toBe(false);

    // A drive anywhere in the paint uses the same primary action.
    e.players[0].x = 0;
    e.players[0].z = -1.5; // dist to hoop (0, -5.25) = 3.75m
    e.players[1].x = 4.5; // Uncontested
    e.players[0].streetMove = null;
    e.players[0].vz = -2;
    e.players[0].onFire = true;
    e.players[0].correctAnswerStreak = 3;
    e.initiateShotAttempt({ ...NEUTRAL, shoot: true });
    expect(e.players[0].finishKind).toBe('dunk');
    expect(e.activeDuel?.releaseSnapshot.onFire).toBe(true);

    // Verify that even with ON FIRE + combo setup bonus, a WRONG answer keeps probability low (never automatic!)
    const wrongOpt = e.activeDuel!.question.options.find(
      (o) => o.id !== e.activeDuel!.question.correctOptionId,
    )!.id;
    for (let t = 0; t < 4200; t += 50) e.step(50, [NEUTRAL, NEUTRAL]);
    expect(e.submitAnswer({ slot: 0, duelId: e.activeDuel!.duelId, optionId: wrongOpt }).accepted).toBe(true);
    expect(e.submitAnswer({ slot: 1, duelId: e.activeDuel!.duelId, optionId: wrongOpt }).accepted).toBe(true);
    expect(e.activeDuel!.resolvedOutcome!.finalProbability).toBeLessThanOrEqual(0.32);

    // Verify a valid question-duel block STILL overrides ON FIRE completely!
    const e2 = createMatch(32);
    e2.players[0].streetFlow = 0.95;
    e2.players[0].onFire = true;
    e2.players[0].correctAnswerStreak = 3;
    e2.players[0].trickCombo = 3;
    e2.players[0].comboGraceSec = 0.3;
    e2.players[0].x = 0;
    e2.players[0].z = -2.5;
    e2.players[1].x = 0;
    e2.players[1].z = -3.6;
    e2.players[1].facingAngle = 0;
    e2.initiateShotAttempt({ ...NEUTRAL, dunk: true });
    expect(e2.activeDuel!.releaseSnapshot.blockEligibility.eligible).toBe(true);
    for (let t = 0; t < 4200; t += 50) e2.step(50, [NEUTRAL, NEUTRAL]);
    const correctId = e2.activeDuel!.question.correctOptionId;
    // Defender answers correctly first; attacker answers 500ms later
    expect(e2.submitAnswer({ slot: 1, duelId: e2.activeDuel!.duelId, optionId: correctId }).accepted).toBe(true);
    for (let t = 0; t < 500; t += 50) e2.step(50, [NEUTRAL, NEUTRAL]);
    expect(e2.submitAnswer({ slot: 0, duelId: e2.activeDuel!.duelId, optionId: correctId }).accepted).toBe(true);
    expect(e2.activeDuel!.resolvedOutcome!.outcome).toBe('block');
    expect(e2.activeDuel!.resolvedOutcome!.pointsAwarded).toBe(0);
  });

  it('suspends jump-shot / stepback fadeaway pose during Duel and clears shoot animState on Feedback', () => {
    const e = createMatch(44);
    e.step(16, [{ ...NEUTRAL, trick: 'stepback' }, NEUTRAL]);
    for (let t = 0; t < 340; t += 16) e.step(16, [NEUTRAL, NEUTRAL]);
    e.step(16, [{ ...NEUTRAL, shoot: true }, NEUTRAL]);
    expect(e.players[0].finishKind).toBe('jump');

    // Step 3.8 seconds into Duel (past reading period): shooter remains suspended above court rather than snapping flat at 0.8s
    for (let t = 0; t < 3800; t += 50) e.step(50, [NEUTRAL, NEUTRAL]);
    expect(e.phase).toBe('Duel');
    expect(getAirPose(e.players[0]).y).toBeGreaterThan(0.5);

    // Resolve duel and advance into Feedback: animState transitions cleanly out of 'shoot'
    const wrongId = e.activeDuel!.question.options.find(
      (o) => o.id !== e.activeDuel!.question.correctOptionId,
    )!.id;
    expect(e.submitAnswer({ slot: 0, duelId: e.activeDuel!.duelId, optionId: wrongId }).accepted).toBe(true);
    expect(e.submitAnswer({ slot: 1, duelId: e.activeDuel!.duelId, optionId: wrongId }).accepted).toBe(true);
    for (let t = 0; t < 2200 && e.phase !== 'Feedback'; t += 50) {
      e.step(50, [NEUTRAL, NEUTRAL]);
    }
    expect(e.phase).toBe('Feedback');
    expect(e.players[0].animState).not.toBe('shoot');
  });

  it('supports buffered 2-move trick chains over the Netlify HTTP room adapter (/api/room)', () => {
    const rooms = new RoomManager(new ServerPackService(), { defaultSeed: 77 });
    const cRes = rooms.handleHttpSync({
      clientId: 'h0',
      messages: [
        {
          type: 'CREATE_ROOM',
          pseudonym: 'Host',
          appearancePreset: 0,
          packId: BUNDLED_QUESTION_PACKS[0].packId,
          roomPresetId: 'standard',
          sessionLengthId: 'quick',
        },
      ],
    });
    const host = cRes.messages.find(
      (m): m is Extract<ServerToClientMessage, { type: 'ROOM_JOINED' }> => m.type === 'ROOM_JOINED',
    )!;
    const jRes = rooms.handleHttpSync({
      clientId: 'g1',
      messages: [{ type: 'JOIN_ROOM', roomCode: host.roomCode, pseudonym: 'Guest', appearancePreset: 1 }],
    });
    const guest = jRes.messages.find(
      (m): m is Extract<ServerToClientMessage, { type: 'ROOM_JOINED' }> => m.type === 'ROOM_JOINED',
    )!;
    rooms.handleHttpSync({
      clientId: 'h0',
      roomCode: host.roomCode,
      reconnectToken: host.reconnectToken,
      messages: [{ type: 'SET_READY', ready: true }],
    });
    rooms.handleHttpSync({
      clientId: 'g1',
      roomCode: guest.roomCode,
      reconnectToken: guest.reconnectToken,
      messages: [{ type: 'SET_READY', ready: true }],
    });

    // Host sends crossover, ticks 150ms, then buffers spin
    rooms.handleHttpSync({
      clientId: 'h0',
      roomCode: host.roomCode,
      reconnectToken: host.reconnectToken,
      messages: [{ type: 'MOVE_INTENT', input: { ...NEUTRAL, moveZ: -1, trick: 'crossover' } }],
    });
    rooms.tickAllRooms(50);
    rooms.tickAllRooms(100);
    rooms.handleHttpSync({
      clientId: 'h0',
      roomCode: host.roomCode,
      reconnectToken: host.reconnectToken,
      messages: [{ type: 'MOVE_INTENT', input: { ...NEUTRAL, moveZ: -1, trick: 'spin' } }],
    });
    rooms.tickAllRooms(50);
    rooms.tickAllRooms(100);

    const poll = rooms.handleHttpSync({
      clientId: 'h0',
      roomCode: host.roomCode,
      reconnectToken: host.reconnectToken,
      messages: [],
    });
    const latestSnap = [...poll.messages]
      .reverse()
      .find(
        (m): m is Extract<ServerToClientMessage, { type: 'MATCH_SNAPSHOT' }> => m.type === 'MATCH_SNAPSHOT',
      )!.snapshot;
    expect(latestSnap.players[0].streetMove).toBe('spin');
    expect(latestSnap.players[0].trickCombo).toBe(2);
  });
});
