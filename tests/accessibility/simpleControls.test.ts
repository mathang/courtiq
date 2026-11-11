import { describe, expect, it } from 'vitest';
import { InputGuardController, normaliseKeyBindings } from '../../client/game/input/controls';

function controls(isAttacker = true) {
  const c = new InputGuardController();
  c.syncDuelContext({ phase: 'Possession', isAttacker, duelId: null, readingProtected: false, displayedOptions: [] });
  return c;
}
function tap(c: InputGuardController, code = 'KeyC') { c.handleKeyDown({ code }); c.handleKeyUp({ code }); }

describe('Two context-sensitive action buttons', () => {
  it.each(['crossover', 'spin', 'eurostep', 'stepback'] as const)('selects %s with fresh taps inside a fixed half-second window', move => {
    const count = ['crossover', 'spin', 'eurostep', 'stepback'].indexOf(move) + 1;
    const c = controls();
    for (let i = 0; i < count; i++) { tap(c); expect(c.consumeMoveInput('Possession', 50).trick).toBeUndefined(); }
    expect(c.getTrickSelection()?.move).toBe(move);
    expect(c.consumeMoveInput('Possession', 500 - count * 50 - 1).trick).toBeUndefined();
    expect(c.consumeMoveInput('Possession', 1).trick).toBe(move);
    expect(c.consumeMoveInput('Possession', 500).trick).toBeUndefined();
  });
  it('caps four or more taps and does not extend the window or count key repeat', () => {
    const c = controls();
    for (let i = 0; i < 7; i++) { tap(c); c.consumeMoveInput('Possession', 50); }
    expect(c.getTrickSelection()?.count).toBe(4);
    expect(c.consumeMoveInput('Possession', 150).trick).toBe('stepback');
    c.handleKeyDown({ code: 'KeyC' });
    for (let i = 0; i < 8; i++) c.handleKeyDown({ code: 'KeyC', repeat: true });
    expect(c.consumeMoveInput('Possession', 500).trick).toBe('crossover');
    expect(c.consumeMoveInput('Possession', 500).trick).toBeUndefined();
  });
  it('commits a selected trick with the primary button and clears stale intentions on phase, role and blur', () => {
    const c = controls(); tap(c); tap(c); tap(c, 'Space');
    expect(c.consumeMoveInput('Possession', 16)).toMatchObject({ trick: 'spin', shoot: true });
    tap(c);
    c.syncDuelContext({ phase: 'QuestionReady', duelId: 'd1', readingProtected: true, displayedOptions: [] });
    expect(c.consumeMoveInput('QuestionReady', 600).trick).toBeUndefined();
    c.syncDuelContext({ phase: 'Possession', duelId: null, readingProtected: false, displayedOptions: [] });
    tap(c); c.reset(); expect(c.consumeMoveInput('Possession', 600).trick).toBeUndefined();
    tap(c);
    c.syncDuelContext({ phase: 'Possession', isAttacker: false, duelId: null, readingProtected: false, displayedOptions: [] });
    expect(c.consumeMoveInput('Possession', 600).trick).toBeUndefined();
    tap(c); expect(c.consumeMoveInput('Possession', 1).defense).toBe('swipe');
  });
  it('uses C immediately for a defensive swipe and Space for jumping, including a held takeoff block', () => {
    const c = controls(false); tap(c);
    expect(c.consumeMoveInput('Possession', 1)).toMatchObject({ defense: 'swipe', shoot: false });
    c.handleKeyDown({ code: 'Space' });
    expect(c.consumeMoveInput('Possession', 16).defense).toBe('jump');
    c.syncDuelContext({ phase: 'QuestionReady', isAttacker: false, duelId: 'd', readingProtected: true, displayedOptions: [] });
    expect(c.consumeMoveInput('QuestionReady', 16).defense).toBe('jump');
    c.syncDuelContext({ phase: 'Duel', isAttacker: false, duelId: 'd', readingProtected: false, displayedOptions: [] });
    tap(c); expect(c.consumeMoveInput('Duel', 16).defense).toBeUndefined();
  });
  it('uses identical touch gestures, keeps movement and answers independent, and migrates old bindings', () => {
    const c = controls(); c.triggerTouchTrick(); c.triggerTouchTrick(); c.setTouchPrimary(true);
    expect(c.consumeMoveInput('Possession', 16)).toMatchObject({ trick: 'spin', shoot: true });
    expect(c.consumeMoveInput('Possession', 16).shoot).toBe(false);
    expect(normaliseKeyBindings({ crossover: 'KeyK', shoot: 'KeyJ', moveUp: 'KeyI', dunk: 'KeyR' })).toMatchObject({ trick: 'KeyK', shoot: 'KeyJ', moveUp: 'KeyI' });
    expect(normaliseKeyBindings({ trick: 'KeyL', crossover: 'KeyK' }).trick).toBe('KeyL');
    expect('dunk' in normaliseKeyBindings({ dunk: 'KeyR' })).toBe(false);
  });
});
