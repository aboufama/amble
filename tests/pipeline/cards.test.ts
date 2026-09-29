/** The AI cards' word helpers and the hand-edit check behind "Amble also changed lines you wrote in …". */
import { describe, expect, it } from 'vitest';
import { handEditFile } from '../../src/pipeline/service';
import { mergeLayers } from '../../src/cores/ai';
import { layerFromClassLink, layerFromEnv, layerFromManaged } from '../../src/ai';
import { addedMemberText, explainerLines, gentlerText, nameInSentence, steerText, withoutSpans, wordsGoTo } from '../../src/screens/ai/words';

describe('the steer toast', () => {
  it('says which way a dial went, and what a twist did', () => {
    expect(steerText({ kind: 'dial', key: 'jump', label: 'Jump power', from: 720, to: 860 })).toBe('Turned Jump power up to 860. No AI needed.');
    expect(steerText({ kind: 'dial', key: 'orbSpeed', label: 'Orb speed', from: 280, to: 160 })).toBe('Turned Orb speed down to 160. No AI needed.');
    expect(steerText({ kind: 'dial', key: 'gravity', label: 'Gravity', from: 0.5, to: 0.5 })).toBe('Set Gravity to 0.5. No AI needed.');
    expect(steerText({ kind: 'dial', key: 'size', label: 'Size', from: 1, to: 1.3333 })).toBe('Turned Size up to 1.33. No AI needed.');
    expect(steerText({ kind: 'twist', id: 'giantMode', name: 'Giant mode', on: true })).toBe('Switched on Giant mode. No AI needed.');
    expect(steerText({ kind: 'twist', id: 'giantMode', name: 'Giant mode', on: false })).toBe('Switched off Giant mode. No AI needed.');
  });
});

describe('Remove it', () => {
  it('takes the flagged spans out and tidies the spaces they leave', () => {
    const text = 'put my phone number 603-555-0199 on the boss';
    expect(withoutSpans(text, [[20, 32]])).toBe('put my phone number on the boss');
    expect(withoutSpans('call me at 603-555-0199.', [[11, 23]])).toBe('call me at.');
    expect(withoutSpans('Sam Jones, sam@example.org, and a boss', [[0, 9], [11, 26]])).toBe('and a boss');
    expect(withoutSpans('nothing to see', [])).toBe('nothing to see');
    // Overlapping spans are taken out once.
    expect(withoutSpans('abc 123 456 def', [[4, 11], [8, 11]])).toBe('abc def');
  });
});

describe('the toned-down note', () => {
  it('leads with what Amble did, once', () => {
    expect(gentlerText('the minions bounce off instead of getting hurt.')).toBe('Amble made it a little gentler: the minions bounce off instead of getting hurt.');
    // Models write the note the way the plan prompt's example does ("Amble made the coconuts bounce off…").
    expect(gentlerText(' Amble gave Pip a cartoon star blaster instead of a real gun. ')).toBe('Amble gave Pip a cartoon star blaster instead of a real gun.');
    expect(gentlerText('Ambler the robot bounces off now.')).toBe('Amble made it a little gentler: Ambler the robot bounces off now.');
  });
});

describe('names in sentences', () => {
  it('puts "the" before names of more than one word', () => {
    expect(['Moon King', 'The Moon King', 'Pip', ''].map(nameInSentence)).toEqual(['the Moon King', 'the Moon King', 'Pip', '']);
    expect(addedMemberText('Pizza slice')).toBe('Your change added a Pizza slice. Draw it now?');
    expect(addedMemberText('Orb')).toBe('Your change added an Orb. Draw it now?');
    expect(addedMemberText('The Salt King')).toBe('Your change added The Salt King. Draw them now?');
  });
});

describe('lines the student wrote', () => {
  const code = (source: string, authors: Array<['starter' | 'student' | 'ai', number]>) => ({ path: 'boss.js', source, authors, locked: [] });
  const before = code('a\nb\nmine1\nmine2\nc\n', [
    ['starter', 2],
    ['student', 2],
    ['starter', 2],
  ]);

  it('finds the file whose student lines a change rewrote', () => {
    expect(handEditFile([before], [{ ...before, source: 'a\nb\nmine1\nMINE2\nc\n' }])).toBe('boss.js');
    expect(handEditFile([before], [])).toBe('boss.js');
  });

  it('is null when those lines survive, even when they moved', () => {
    expect(handEditFile([before], [{ ...before, source: 'x\ny\na\nb\nmine1\nmine2\nc\n' }])).toBeNull();
    expect(handEditFile([code('a\n', [['starter', 2]])], [code('b\n', [['ai', 2]])])).toBeNull();
  });
});

describe('the card before a first request', () => {
  const BASE = 'https://amble-ai.sau99.org/v1';
  const managed = mergeLayers([layerFromManaged({ ai: { baseUrl: BASE }, district: { name: 'SAU 99' } })]);
  const built = mergeLayers([layerFromEnv({ VITE_AMBLE_AI_BASE_URL: BASE, VITE_AMBLE_AI_AUTH: 'none' })]);
  const linked = mergeLayers([layerFromClassLink({ v: 1, baseUrl: BASE, code: 'OAK-1', name: 'Room 9', district: 'SAU 99' })]);
  const home = mergeLayers([{ source: 'manual', baseUrl: 'https://api.openai.com/v1', auth: { type: 'bearer', key: 'sk-test' } }]);

  it('says where the words go from the same facts as the privacy page', () => {
    expect([managed, built, linked, home].map(wordsGoTo)).toEqual(['school', 'school', 'class', 'home']);
    expect(wordsGoTo(null)).toBe('school');
    expect(explainerLines(managed, null)[1]).toBe("To do that, your words go over the internet to a service SAU 99 set up. Don't type your name or other private things.");
    expect(explainerLines(built, null)[1]).toContain('a service your school set up');
    expect(explainerLines(linked, 'SAU 99')[1]).toContain("the service your teacher's class link turned on");
    // At home a grown-up set it up, and no teacher sees the world unless it is handed in.
    const atHome = explainerLines(home, null);
    expect(atHome[1]).toContain('the service a grown-up set up here');
    expect(atHome.join(' ')).not.toMatch(/school|teacher/i);
    expect(explainerLines(linked, null)[2]).toContain('Your teacher can see how your world was built.');
  });

  it("says what happens in plain words, without naming the AI", () => {
    for (const ai of [managed, built, linked, home, null]) for (const line of explainerLines(ai, 'SAU 99')) expect(line).not.toMatch(/\bAI\b/);
  });
});
