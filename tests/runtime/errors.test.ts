import { describe, expect, it } from 'vitest';
import { ErrorDeduper, ScriptRegistry, describeError, locateInStack, sourceUrlFor, tidyStack } from '../../src/runtime/shell/stack';

const scripts = new ScriptRegistry();
scripts.add('game.js', 'blob:null/5d0f2a1e-9c7b-4f3e-8a55-3a2b1c0d9e8f');
scripts.add('boss helper.js', null);

const CHROME = `TypeError: Cannot read properties of undefined (reading 'x')
    at Object.update (blob:null/aaaaaaaa-runtime:1:99999)
    at Game.update (amble:///game.js:11:12)
    at amble:///game.js:40:3`;

const FIREFOX = `update@amble:///game.js:27:9
step@blob:null/aaaaaaaa-runtime:1:5555`;

const INSIDE_PHASER = `TypeError: Cannot read properties of null (reading 'body')
    at t.existing (blob:null/bbbbbbbb-phaser:1:434343)
    at e.onPointer (amble:///game.js:99:52)`;

describe('locateInStack', () => {
  it('maps Chrome frames to the first student frame', () => {
    expect(locateInStack(CHROME, scripts.fileFor)).toEqual({ file: 'game.js', line: 11, column: 12 });
  });

  it('maps Firefox/Safari frames', () => {
    expect(locateInStack(FIREFOX, scripts.fileFor)).toEqual({ file: 'game.js', line: 27, column: 9 });
  });

  it('skips Phaser and runtime frames to find the student line that called them', () => {
    expect(locateInStack(INSIDE_PHASER, scripts.fileFor)).toEqual({ file: 'game.js', line: 99, column: 52 });
  });

  it('maps blob URLs of student files (syntax errors have no sourceURL)', () => {
    const stack = 'SyntaxError\n    at blob:null/5d0f2a1e-9c7b-4f3e-8a55-3a2b1c0d9e8f:3:7';
    expect(locateInStack(stack, scripts.fileFor)).toEqual({ file: 'game.js', line: 3, column: 7 });
  });

  it('handles file names that need encoding', () => {
    const stack = `Error: x\n    at ${sourceUrlFor('boss helper.js')}:5:1`;
    expect(locateInStack(stack, scripts.fileFor)).toEqual({ file: 'boss helper.js', line: 5, column: 1 });
  });

  it('returns null when no student code is involved', () => {
    expect(locateInStack('Error\n    at blob:null/cccc:1:2\n    at foo (native)', scripts.fileFor)).toBeNull();
  });
});

describe('ScriptRegistry.locate', () => {
  it('prefers the stack, then the error event (syntax errors)', () => {
    const err = new Error('boom');
    err.stack = CHROME;
    expect(scripts.locate(err)).toEqual({ file: 'game.js', line: 11, column: 12 });
    expect(scripts.locate(new SyntaxError('Unexpected token'), { filename: 'blob:null/5d0f2a1e-9c7b-4f3e-8a55-3a2b1c0d9e8f', lineno: 8, colno: 2 })).toEqual({
      file: 'game.js',
      line: 8,
      column: 2,
    });
    expect(scripts.locate('a string was thrown')).toBeNull();
  });
});

describe('describeError and tidyStack', () => {
  it('writes a kid-readable line', () => {
    expect(describeError('Uncaught ReferenceError: foo is not defined', { file: 'game.js', line: 4 })).toBe(
      'Something broke on line 4 of game.js: ReferenceError: foo is not defined',
    );
    expect(describeError('', null)).toBe('Something broke: Something went wrong');
  });

  it('replaces blob URLs by file names', () => {
    const tidy = tidyStack(CHROME, scripts.fileFor);
    expect(tidy).toContain('(game.js:11:12)');
    expect(tidy).toContain('(amble:1:99999)');
    expect(tidy).not.toContain('blob:');
  });
});

describe('ErrorDeduper', () => {
  it('counts repeats and caps distinct errors', () => {
    const d = new ErrorDeduper(2);
    const at = { file: 'game.js', line: 3, column: 1 };
    expect(d.note('a', at)?.first).toBe(true);
    const again = d.note('a', at);
    expect(again?.first).toBe(false);
    expect(again?.record.count).toBe(2);
    expect(d.note('b', null)?.first).toBe(true);
    expect(d.note('c', null)).toBeNull();
    expect(d.distinct).toBe(2);
  });
});
