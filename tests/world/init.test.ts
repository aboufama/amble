/** The init message's pieces M2 adds: the student's keys as a generated file, and sound variations. */
import { describe, expect, it } from 'vitest';
import { CONTROLS_FILE, controlsFile, orderFiles, phaserKeyName } from '../../src/world/init';
import { presetRecipe, soundsUsed } from '../../src/world/sounds';
import { FIXTURE_GAME } from '../../src/starters/fixtureGame';
import { sampleWorld } from '../foundation/samples';

describe('controls', () => {
  it('maps key codes to the names games bind', () => {
    expect(phaserKeyName('KeyW')).toBe('W');
    expect(phaserKeyName('Digit2')).toBe('TWO');
    expect(phaserKeyName('ArrowUp')).toBe('UP');
    expect(phaserKeyName('Space')).toBe('SPACE');
    expect(phaserKeyName('ShiftLeft')).toBe('SHIFT');
    expect(phaserKeyName('Tab')).toBeNull();
  });

  it('writes the student keys into a file that runs after game.js', () => {
    expect(controlsFile({})).toBeNull();
    const file = controlsFile({ jump: ['Space', 'ArrowUp', 'Tab'], fire: [] });
    expect(file?.name).toBe(CONTROLS_FILE);
    expect(file?.source).toContain('{"jump":["SPACE","UP"]}');
    expect(() => new Function(file!.source)).not.toThrow();
    const world = sampleWorld({
      code: [
        { path: 'game.js', source: 'class Game {}', authors: [['starter', 1]], locked: [] },
        { path: 'boss.js', source: '', authors: [], locked: [] },
      ],
      controls: { jump: ['KeyW'] },
    });
    expect(orderFiles(world).map((f) => f.name)).toEqual(['boss.js', 'game.js', CONTROLS_FILE]);
  });

  it('sets the keys on the game before its create() runs', () => {
    const file = controlsFile({ fire: ['KeyF'] })!;
    const seen: string[][] = [];
    class Game {
      controls = { bind: { fire: ['X'] } as Record<string, string[]> };
      create() {
        seen.push(this.controls.bind.fire);
      }
    }
    new Function('Game', file.source)(Game);
    new Game().create();
    expect(seen).toEqual([['F']]);
  });
});

describe('sounds', () => {
  it("lists the sounds a game names and the ones the kit plays for what it does", () => {
    expect(soundsUsed([{ path: 'game.js', source: FIXTURE_GAME, authors: [], locked: [] }])).toEqual(['jump', 'dash', 'shoot', 'hit', 'hurt', 'explosion', 'win']);
    const named = soundsUsed([{ path: 'game.js', source: "this.sfx('coin'); this.sound.play('roar')", authors: [], locked: [] }], {});
    expect(named).toEqual(['coin', 'roar']);
  });

  it('makes three variations of each preset', () => {
    const base = presetRecipe('jump', 0)!;
    const high = presetRecipe('jump', 1)!;
    const low = presetRecipe('jump', 2)!;
    expect(high.segments[0].startFreq).toBeGreaterThan(base.segments[0].startFreq);
    expect(low.segments[0].startFreq).toBeLessThan(base.segments[0].startFreq);
    expect(presetRecipe('nope', 0)).toBeNull();
  });
});
