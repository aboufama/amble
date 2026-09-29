/** The controls row's key hints and the request tag's words (§2.6). */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { actionsFromCode, actionWords, hintActions, keyHints, keyLabel, plural, requestCopy, withArticle } from '../../src/world/hints';
import { FIXTURE_GAME } from '../../src/starters/fixtureGame';

const code = [{ source: FIXTURE_GAME }];

describe('key hints', () => {
  it('reads the actions a kit game uses from its code', () => {
    expect(actionsFromCode(code).sort()).toEqual(['dash', 'fire', 'jump', 'left', 'right']);
  });

  it('shows move, jump, shoot and dash, with the keys the student picked', () => {
    const hints = keyHints(hintActions(['jump', 'fire', 'action'], code), {});
    expect(hints.map((h) => [h.keys, h.word])).toEqual([
      ['← →', 'world.actionMove'],
      ['Space', 'world.actionJump'],
      ['X', 'world.actionFire'],
      ['Shift', 'world.actionDash'],
    ]);
    expect(keyHints(['jump'], { jump: ['KeyW', 'Space'] })[0].keys).toBe('W');
    expect(keyHints(['up', 'down'], {})[0].word).toBe('world.actionUpDown');
  });

  it('shows only jump for a runner (it runs by itself), and nothing the game never reads', () => {
    const runner = [{ source: "this.player = this.spawnHero(160, 400, 'hero').runner({ speed: () => this.dials.speed, jumps: 2 });" }];
    expect(actionsFromCode(runner)).toEqual(['jump']);
    expect(keyHints(hintActions(['jump'], runner), {}).map((h) => h.word)).toEqual(['world.actionJump']);
  });

  it("uses a game's own word for an action it renames (Wobble Tower's Space drops a crate)", () => {
    const read = (id: string) => [{ source: readFileSync(join(__dirname, '../../src/starters', id, 'game.js'), 'utf8') }];
    const tower = read('wobble-tower');
    expect(actionWords(tower)).toEqual({ jump: 'drop' });
    expect(keyHints(hintActions(['jump'], tower), {}, actionWords(tower)).map((h) => [h.keys, h.label ?? h.word])).toEqual([['Space', 'drop']]);
    // Words that are just the action's name change nothing: Moon King still says "shoot" for X.
    const moon = read('moon-king');
    expect(actionWords(moon)).toEqual({});
    expect(keyHints(hintActions(['jump', 'fire'], moon), {}, actionWords(moon)).every((h) => h.label === undefined)).toBe(true);
    expect(actionWords([{ source: 'static config = { controls: { dash: "Zoom!", left: "GO" } }' }])).toEqual({ dash: 'zoom!' });
  });

  it('names picked keys briefly', () => {
    expect(keyLabel('KeyQ')).toBe('Q');
    expect(keyLabel('Digit7')).toBe('7');
    expect(keyLabel('ArrowUp')).toBe('↑');
    expect(keyLabel('ShiftRight')).toBe('Shift');
  });
});

describe('the request tag words', () => {
  it('uses "the" when the game does, and plurals for groups', () => {
    expect(withArticle({ name: 'Moon King', ask: 'Draw the Moon King, a giant grumpy boss' })).toBe('the Moon King');
    expect(withArticle({ name: 'Pip', ask: 'Draw your hero' })).toBe('Pip');
    expect(plural('Grumble')).toBe('Grumbles');
    expect(plural('Box')).toBe('Boxes');
    expect(plural('Fairy')).toBe('Fairies');
  });

  it('says what the spec says', () => {
    const boss = { name: 'Moon King', ask: 'Draw the Moon King, a giant grumpy boss', count: 1, pronoun: 'him' as const };
    expect(requestCopy(boss, false)).toEqual({ title: 'The Moon King is only bones.', body: 'Draw him and he comes alive.', button: 'Draw the Moon King' });
    const grumbles = { name: 'Grumble', ask: 'Draw a little moon minion', count: 2, pronoun: 'them' as const };
    expect(requestCopy(grumbles, false)).toEqual({ title: 'The Grumbles are only bones.', body: 'Draw one and they all come alive.', button: 'Draw a Grumble' });
    expect(requestCopy({ ...boss, name: 'Rae', ask: 'Draw Rae, a space kid' }, true).title).toBe('While Amble builds, draw Rae?');
  });
});
