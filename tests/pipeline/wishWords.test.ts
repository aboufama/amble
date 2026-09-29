/**
 * Wishes feel like magic (MAGIC-BRIEF.md): the words a student reads around a wish never name the
 * machinery, and what the AI wrote reaches them only when it speaks about the world, not as "I". The
 * crisis card's words never change. "How wishes work" and What Amble sends are the honest exceptions.
 */
import { describe, expect, it } from 'vitest';
import { ai } from '../../src/i18n/en/ai';
import type { AiOutcome, AiStatus, GameManifest } from '../../src/model/types';
import { doneText, forStudents, forStudentsOutcome, gentlerText, kidSafeWords, kindSentences, restingLine, waitText } from '../../src/screens/ai/words';

/** Keys a student reads only when they open "How wishes work", and the grown-ups' What Amble sends page. */
const HONEST = /^(how|sent|kind|incl|reply)/;
/** The brief's list: the machinery's names, and the decorations. */
const MACHINE_WORDS = /\bAI\b|\bmodels?\b|\bprompts?\b|\bgenerating\b|\btokens?\b|robot tester|✨|★|✦/;

describe('the wish words', () => {
  it('never name the machinery outside "How wishes work" and What Amble sends', () => {
    const bad = Object.entries(ai as Record<string, string>)
      .filter(([key, text]) => !HONEST.test(key) && MACHINE_WORDS.test(text))
      .map(([key, text]) => `ai.${key}: ${text}`);
    expect(bad).toEqual([]);
  });

  it('say it plainly in "How wishes work"', () => {
    expect(ai.howTitle).toBe('How wishes work');
    expect(ai.howService).toBe("Your school's online AI service turns your words into game code. It never draws.");
    expect(ai.howPrivate).toBe("Don't type names or private things.");
    expect(ai.howMistakes).toBe('It can make mistakes: you can always go back a step, and your teacher can see how your world was built.');
  });

  it('keep the crisis card exactly as it is', () => {
    expect(ai.crisisTitle).toBe('It sounds like things might be really hard right now.');
    expect(ai.crisisBody).toBe('You deserve support. Please talk to a teacher, a counselor, or another adult you trust.');
    expect(ai.crisisHelp).toBe('In New Hampshire you can call or text 988, or call 1-833-710-6477 (NH Rapid Response, free, any time).');
    expect(ai.crisisBack).toBe('Back to my world');
  });

  it('say what the brief says', () => {
    expect(ai.askTitle).toBe('Change your world');
    expect(ai.askButton).toBe('Make it happen');
    expect(ai.working).toBe('Working on it…');
    expect(ai.failed).toBe("That wish didn't work this time. Your world is just like before.");
    expect(ai.piiWarning).toBe('That looks like private info (a name, a phone number or an address). Leave it out and try again.');
    expect(ai.steerWish).toBe('Make a wish instead');
    expect(ai.seeWhatChanged).toBe('See what changed');
    expect(ai.undo).toBe('Undo');
  });
});

describe('what the AI wrote, as students read it', () => {
  it('keeps sentences about the world, game words included', () => {
    for (const s of [
      'Now the Moon King throws fireballs.',
      'The Moon King stomps when he is angry.',
      'Collect tokens to open the gate.',
      'Defend the castle from a robot army.',
      'The level generates new platforms every 30 seconds.',
      "Let's add a jetpack!",
    ])
      expect(kidSafeWords(s), s).toBe(true);
  });

  it('drops a helper speaking as "I" or "we", and the machinery', () => {
    for (const s of [
      'I built a boss fight on the moon.',
      "I've added a jetpack.",
      'I’m adding a shield.',
      'We gave Pip a shield.',
      'Here is my version of the stomp.',
      'The AI added a jetpack.',
      'As a language model, it cannot do that.',
      'The A.I. made it harder.',
    ])
      expect(kidSafeWords(s), s).toBe(false);
    expect(forStudents('I fixed the stomp.')).toBe('');
    expect(forStudents('  Now the orbs bounce.  ')).toBe('Now the orbs bounce.');
  });

  it("keeps a note's kind sentences", () => {
    expect(kindSentences("I can't make a game about hurting real people. Want the Moon King to be the villain instead?")).toBe('Want the Moon King to be the villain instead?');
    expect(kindSentences('How about a water-balloon fight instead?')).toBe('How about a water-balloon fight instead?');
    expect(kindSentences('I cannot do that.')).toBe('');
  });

  it('cleans an outcome before anything shows it', () => {
    const accepted: AiOutcome = {
      kind: 'accepted',
      files: [],
      manifest: { art: [], dials: [], twists: [] } as unknown as GameManifest,
      summary: 'I made the Moon King throw fireballs.',
      play: 'Jump on the Moon King.',
      next: ['Make the stomp bigger', 'Let me add lava', 'Add falling rocks'],
      safety: { kind: 'toned-down', note: 'I made the minions bounce off.' },
      repairs: 0,
      tested: true,
      handEditsTouched: false,
      newArt: [],
    };
    expect(forStudentsOutcome(accepted)).toMatchObject({ summary: '', play: 'Jump on the Moon King.', next: ['Make the stomp bigger', 'Add falling rocks'], safety: { kind: 'ok', note: '' } });
    const refused: AiOutcome = { kind: 'refused', note: "I can't make that. How about a snowball fight?", alternatives: ['Make up a character with a funny name'], category: 'flagged' };
    expect(forStudentsOutcome(refused)).toMatchObject({ note: 'How about a snowball fight?', alternatives: ['Make up a character with a funny name'], category: 'flagged' });
    const failed: AiOutcome = { kind: 'failed', reason: 'transport', message: ai.failed, details: ['HTTP 500'] };
    expect(forStudentsOutcome(failed)).toBe(failed);
  });
});

describe('the toast, the notes and the lines', () => {
  it('says "Done!" with what changed, or plainly', () => {
    expect(doneText('the Moon King throws fireballs now')).toBe('Done! The Moon King throws fireballs now.');
    expect(doneText('Now your hero can stomp on minions to squash them.')).toBe('Done! Now your hero can stomp on minions to squash them.');
    expect(doneText('')).toBe('Done! Your world changed.');
    expect(doneText('I added a jetpack.')).toBe('Done! Your world changed.');
  });

  it('says a gentler version kindly', () => {
    expect(gentlerText('the minions bounce off instead of getting hurt.')).toBe('A little gentler: the minions bounce off instead of getting hurt.');
    expect(gentlerText('Amble made the coconuts bounce off instead of hurting')).toBe('Amble made the coconuts bounce off instead of hurting.');
  });

  it('has one quiet line for every time wishes rest, and none when they can happen', () => {
    expect(restingLine('ready')).toBeNull();
    const statuses: AiStatus[] = ['off', 'explain-only', 'offline', 'blocked', 'quota', 'expired', 'rejected', 'busy'];
    for (const s of statuses) {
      const line = restingLine(s) ?? '';
      expect(line, s).not.toBe('');
      expect(line, s).not.toMatch(MACHINE_WORDS);
      expect(line, s).not.toMatch(/set up/i);
    }
    expect(restingLine('off')).toBe('Wishes are resting right now. Dials and Twists still work.');
    expect(restingLine('offline')).toBe("Wishes come back when you're online.");
  });

  it('says how long a wish waits without a ticking counter', () => {
    expect(waitText(20, 'rate-limited')).toBe('Lots of wishes right now. Yours is next in about 20 seconds.');
    expect(waitText(17, 'server')).toBe('Lots of wishes right now. Yours is next in about 20 seconds.');
    expect(waitText(3, 'rate-limited')).toBe('Lots of wishes right now. Yours is next in a few seconds.');
    expect(waitText(12, 'network')).toBe('The connection hiccuped. Trying again in 15 seconds.');
  });
});
