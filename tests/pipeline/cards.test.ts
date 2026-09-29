/** The AI cards' word helpers and the hand-edit check behind "Amble also changed lines you wrote in …". */
import { describe, expect, it } from 'vitest';
import { handEditFile } from '../../src/pipeline/service';
import { addedMemberText, nameInSentence, steerText, withoutSpans } from '../../src/screens/ai/words';

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
