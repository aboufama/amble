/** The init message's pieces M2 adds: the student's keys as a generated file, and sound variations. */
import { describe, expect, it } from 'vitest';
import { setServices, type Services } from '../../src/app/services';
import { DEFAULT_PLAYER_PREFS } from '../../src/cores/play';
import { MemoryStore } from '../../src/store/memory';
import { CONTROLS_FILE, controlsFile, orderFiles, phaserKeyName, toInitMessage } from '../../src/world/init';
import { presetRecipe, soundsUsed } from '../../src/world/sounds';
import { FIXTURE_GAME } from '../../src/starters/fixtureGame';
import { sampleArt, sampleWorld } from '../foundation/samples';

describe('drawn art', () => {
  it('gives each drawn member its picture, bones and flipbook pages on every load', async () => {
    const store = new MemoryStore();
    setServices({ store } as unknown as Services);
    const png = (n: number) => new Blob([new Uint8Array([137, 80, 78, 71, n])], { type: 'image/png' });
    const [flat, atlas, arm] = await Promise.all([png(1), png(2), png(3)].map((b) => store.blobs.put(b)));
    const json = JSON.stringify({ v: 1, w: 300, h: 420, anchor: [150, 410], frames: [{ x: 0, y: 0, w: 300, h: 420, ox: 0, oy: 0, hold: 1 }, { x: 300, y: 0, w: 300, h: 420, ox: 0, oy: 0, hold: 2 }] });
    const art = sampleArt();
    await store.commit({
      art: [{ ...art, export: { ...art.export!, flat, parts: { armL: { blob: arm, x: 0, y: 0, w: 40, h: 90 } }, frames: { atlas, json, move: 'attack', fps: 8 } } }],
    });
    const init = await toInitMessage(sampleWorld(), { mode: 'play', prefs: DEFAULT_PLAYER_PREFS });
    expect(init.art).toHaveLength(1);
    const hero = init.art[0];
    expect(hero.key).toBe('hero');
    expect(await (hero.image as Blob).bytes()).toEqual(new Uint8Array([137, 80, 78, 71, 1]));
    expect(Object.keys(hero.layers ?? {})).toEqual(['part:armL']);
    expect(hero.frames).toMatchObject({ json, move: 'attack', fps: 8 });
    expect(await (hero.frames?.atlas as Blob).bytes()).toEqual(new Uint8Array([137, 80, 78, 71, 2]));
  });

  it('leaves out a flipbook whose pages are missing, and keeps the picture', async () => {
    const store = new MemoryStore();
    setServices({ store } as unknown as Services);
    const flat = await store.blobs.put(new Blob([new Uint8Array([1])], { type: 'image/png' }));
    const art = sampleArt();
    await store.commit({ art: [{ ...art, export: { ...art.export!, flat, frames: { atlas: `sha256:${'9'.repeat(64)}`, json: '{}', move: 'walk', fps: 6 } } }] });
    const init = await toInitMessage(sampleWorld(), { mode: 'play', prefs: DEFAULT_PLAYER_PREFS });
    expect(init.art.map((a) => a.key)).toEqual(['hero']);
    expect(init.art[0].frames).toBeUndefined();
  });
});

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
