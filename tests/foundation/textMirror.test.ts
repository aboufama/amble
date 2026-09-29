/**
 * The game's text mirror (§3.9 rule 4): what a screen reader hears from a running game. The score is said at
 * most once every 2 s and the hearts once a second, always the latest value; levels, a win or a loss and the
 * title card at once; the game's own messages once each and never more than 3 in 2 s; capitals read as
 * sentences.
 */
import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../src/cores/play';
import { HEARTS_EVERY_MS, SCORE_EVERY_MS, speakable, TextMirror, type MirrorClock } from '../../src/app/player/mirror';

/** A clock that only moves when the test says so. */
function fakeClock(): MirrorClock & { advance(ms: number): void; pending(): number } {
  let now = 0;
  let timers: Array<{ at: number; fn: () => void }> = [];
  return {
    now: () => now,
    later(fn, ms) {
      const timer = { at: now + ms, fn };
      timers.push(timer);
      return () => {
        timers = timers.filter((t) => t !== timer);
      };
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        timers = timers.filter((t) => t !== next);
        now = next.at;
        next.fn();
      }
      now = end;
    },
    pending: () => timers.length,
  };
}

function mirror() {
  const clock = fakeClock();
  const said: string[] = [];
  const m = new TextMirror((s) => said.push(s), clock);
  const send = (...events: GameEvent[]) => events.forEach((e) => m.event(e));
  return { clock, said, m, send };
}

describe('the text mirror', () => {
  it('says the score at once, then at most once every 2 s, with the latest value', () => {
    const { clock, said, send } = mirror();
    expect(SCORE_EVERY_MS).toBe(2000);
    send({ kind: 'score', value: 10 });
    expect(said).toEqual(['Score: 10.']);
    // A burst of points: nothing until the 2 s are up, then the latest one only.
    for (const value of [20, 30, 40, 50]) {
      clock.advance(300);
      send({ kind: 'score', value });
    }
    expect(said).toEqual(['Score: 10.']);
    clock.advance(799);
    expect(said).toEqual(['Score: 10.']);
    clock.advance(1);
    expect(said).toEqual(['Score: 10.', 'Score: 50.']);
    // Quiet for a while: the next change is said at once again.
    clock.advance(5000);
    send({ kind: 'score', value: 60 });
    expect(said).toEqual(['Score: 10.', 'Score: 50.', 'Score: 60.']);
  });

  it('never says more than one score in any 2 s, however fast it changes', () => {
    const clock = fakeClock();
    const said: Array<{ text: string; at: number }> = [];
    const m = new TextMirror((text) => said.push({ text, at: clock.now() }), clock);
    for (let i = 1; i <= 100; i++) {
      m.event({ kind: 'score', value: i * 5 });
      clock.advance(97);
    }
    clock.advance(3000);
    for (let i = 1; i < said.length; i++) expect(said[i].at - said[i - 1].at).toBeGreaterThanOrEqual(SCORE_EVERY_MS);
    // About 9.7 s of points: 5 or 6 sentences, the last one the final score.
    expect(said.length).toBeLessThanOrEqual(6);
    expect(said[said.length - 1].text).toBe('Score: 500.');
  });

  it('says nothing when the score comes back unchanged', () => {
    const { clock, said, send } = mirror();
    send({ kind: 'score', value: 10 });
    clock.advance(100);
    send({ kind: 'score', value: 10 });
    clock.advance(5000);
    send({ kind: 'score', value: 10 });
    expect(said).toEqual(['Score: 10.']);
  });

  it('says the hearts at most once a second, and a win or loss with the final score instead of a waiting one', () => {
    const { clock, said, send } = mirror();
    expect(HEARTS_EVERY_MS).toBe(1000);
    send({ kind: 'lives', value: 3, max: 3 });
    clock.advance(200);
    send({ kind: 'lives', value: 2, max: 3 });
    send({ kind: 'lives', value: 1, max: 3 });
    clock.advance(800);
    expect(said).toEqual(['Hearts: 3 of 3.', 'Hearts: 1 of 3.']);
    send({ kind: 'lives', value: 5, max: 0 });
    clock.advance(1000);
    expect(said[said.length - 1]).toBe('Hearts: 5.');

    send({ kind: 'score', value: 100 });
    clock.advance(100);
    send({ kind: 'score', value: 120 });
    send({ kind: 'win', text: 'YOU WIN!', score: 120 });
    clock.advance(5000);
    expect(said.slice(-2)).toEqual(['Score: 100.', 'You win! Score: 120. Press R to play again.']);
    send({ kind: 'lose', text: '', score: 7 });
    expect(said[said.length - 1]).toBe('Game over. Score: 7. Press R to try again.');
  });

  it('says a level, the title card and messages once each, in sentences', () => {
    const { clock, said, send } = mirror();
    send({ kind: 'title', text: 'Moon King', sub: 'Beat the grumpy moon in three phases!' });
    expect(said).toEqual(['Moon King. Beat the grumpy moon in three phases! Press Space to start.']);
    // The kit sends a wave's title as a message and as a level: it is said once.
    send({ kind: 'text', text: 'WAVE 2' }, { kind: 'level', value: 2, text: 'WAVE 2' });
    expect(said.slice(1)).toEqual(['Wave 2.']);
    send({ kind: 'level', value: 3, text: '' });
    expect(said[said.length - 1]).toBe('Level 3.');
    clock.advance(3000);
    send({ kind: 'text', text: 'WAVE 2' });
    expect(said[said.length - 1]).toBe('Wave 2.');
    // Captions and the start are not for the mirror.
    const before = said.length;
    send({ kind: 'caption', text: '[boing]' }, { kind: 'start' });
    expect(said.length).toBe(before);
  });

  it('keeps a flood of messages to 3 in 2 s', () => {
    const { clock, said, send } = mirror();
    for (let i = 0; i < 10; i++) send({ kind: 'text', text: `Ouch ${i}` });
    expect(said).toEqual(['Ouch 0.', 'Ouch 1.', 'Ouch 2.']);
    clock.advance(2000);
    send({ kind: 'text', text: 'Watch out!' });
    expect(said[said.length - 1]).toBe('Watch out!');
  });

  it('forgets the last game: nothing waiting is said after a reset, and the score starts over', () => {
    const { clock, said, m, send } = mirror();
    send({ kind: 'score', value: 10 });
    clock.advance(100);
    send({ kind: 'score', value: 20 });
    m.reset();
    clock.advance(5000);
    expect(said).toEqual(['Score: 10.']);
    send({ kind: 'score', value: 10 });
    expect(said).toEqual(['Score: 10.', 'Score: 10.']);
    send({ kind: 'score', value: 30 });
    m.dispose();
    expect(clock.pending()).toBe(0);
  });
});

describe('game text for a listener', () => {
  it('reads capitals as a sentence and leaves mixed case alone', () => {
    expect(speakable('YOU WIN!')).toBe('You win!');
    expect(speakable('PHASE 2: RAGE')).toBe('Phase 2: Rage');
    expect(speakable('GO!')).toBe('Go!');
    expect(speakable('Press SPACE to jump')).toBe('Press SPACE to jump');
    expect(speakable('  a   b ')).toBe('a b');
    expect(speakable('X')).toBe('X');
    expect(speakable('y'.repeat(500))).toHaveLength(200);
  });
});
