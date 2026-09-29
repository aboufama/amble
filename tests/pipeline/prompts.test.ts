/**
 * The prompts (§5.3): static per app version (byte-stable, so providers cache the prefix and #/ai publishes
 * exactly what is sent), with the kit cheat sheet whole, and an example game that is itself a clean kit game.
 */
import { describe, expect, it } from 'vitest';
import { KIT_API } from '../../src/cores/play';
import { EXAMPLE_GAME } from '../../src/pipeline/prompts/example';
import { kitSheet } from '../../src/pipeline/prompts/kitSheet';
import { PLAN_PROMPT } from '../../src/pipeline/prompts/plan';
import { SYSTEM_PROMPT } from '../../src/pipeline/prompts/system';
import { check } from '../../src/pipeline/validate';
import { parseRecipe } from '../../src/runtime/kit/sounds';

const NO_WORLD = { drawn: [], previousArt: {}, locked: {}, previous: [] };

describe('the prompts', () => {
  it('are static text, with nothing left to fill in', () => {
    for (const p of [SYSTEM_PROMPT, PLAN_PROMPT]) {
      expect(p).not.toMatch(/\{\{|\}\}|\bundefined\b|\[object Object\]|\bNaN\b/);
      expect(p).toBe(p.trim());
    }
  });

  it('carry the whole kit sheet: every member of the scene, the actors and the namespaces', () => {
    const sheet = kitSheet();
    expect(SYSTEM_PROMPT).toContain(sheet);
    for (const m of KIT_API.docs.scene) expect(sheet, m.name).toContain(`this.${m.name}`);
    for (const m of KIT_API.docs.actor) expect(sheet, m.name).toMatch(new RegExp(`actor\\.(\\w+, )*${m.name}\\b`));
    for (const [ns, names] of Object.entries(KIT_API.namespaces)) {
      for (const n of names) expect(sheet, `${ns}.${n}`).toMatch(new RegExp(`this\\.${ns}\\.(\\w+, )*${n}\\b`));
    }
  });

  it('spell out what models get wrong without it: units, shared names, events, sides, levels', () => {
    expect(SYSTEM_PROMPT).toContain('(optional; dt is the ms since the last frame)');
    expect(kitSheet()).toMatch(/this\.brain\(.*dt in seconds/);
    expect(kitSheet()).toMatch(/this\.waves\(.*spawn returns the enemy it makes/);
    expect(SYSTEM_PROMPT).toContain('Each file runs as its own\nscript: declare a top-level name (FLOOR, spawnWave) in one file only');
    expect(SYSTEM_PROMPT).toContain("actor.on('die' | 'hurt' | 'stomp' | 'pickup' | 'land' | 'jump' | 'shoot' | 'drawn', fn)");
    expect(SYSTEM_PROMPT).toContain("role: 'hero' | 'enemy'");
    expect(SYSTEM_PROMPT).toContain('this.setLevel(n) then this.restart() builds level n');
  });

  it("describe a sound segment in the fields the kit reads, in seconds, and config's gravity per physics", () => {
    // Every other duration in the prompt is in ms; a segment's is seconds (a 180 "ms" boing plays for 8 s).
    const doc = /sound segments \(static sounds, sfx\): \[\{ ([^]*?) \}\]/.exec(SYSTEM_PROMPT)?.[1] ?? '';
    expect([...doc.matchAll(/\b(wave|duration|\w+(?:Freq|Volume))\b/g)].map((m) => m[1])).toEqual(['wave', 'startFreq', 'endFreq', 'duration', 'startVolume', 'endVolume']);
    expect(doc).toContain('duration (seconds');
    const seg = { wave: 'sine', startFreq: 180, endFreq: 620, duration: 0.15, startVolume: 0.7, endVolume: 0 };
    expect(parseRecipe({ caption: 'Boing!', segments: [seg] })).toEqual([seg]);
    expect(SYSTEM_PROMPT).toContain('gravity (arcade: pixels/s², about 1500, 0 for top-down; matter: about 1)');
  });

  it('name the scene members a game may not take, and the validator flags each one', () => {
    const rule = /Never store your own things in a name the kit or Phaser already uses on this: ([^]*?)\. this\.hero/.exec(SYSTEM_PROMPT);
    expect(rule).not.toBeNull();
    const named = [...(rule?.[1] ?? '').matchAll(/\b(?:this\.)?([a-z]\w*)(?:\(\))?(?=[,)]| builds|$| \(|, or)/g)].map((m) => m[1]);
    for (const name of ['fx', 'ui', 'controls', 'music', 'combo', 'pattern', 'twists', 'dials', 'dial', 'clock', 'level', 'add', 'physics', 'time', 'events', 'input', 'cameras', 'tweens']) {
      expect(named, name).toContain(name);
      const game = `class Game extends Amble.Scene {\n  create() {\n    this.${name} = 1;\n  }\n}\n`;
      const r = check([{ path: 'game.js', content: game }], NO_WORLD);
      expect([...r.errors, ...r.warnings].map((e) => e.rule), name).toContain('kit-overwrite');
    }
  });

  it('show an example game that validates clean against the real kit', () => {
    const r = check([{ path: 'game.js', content: EXAMPLE_GAME }], NO_WORLD);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.fixes).toEqual([]);
    expect(SYSTEM_PROMPT.endsWith(EXAMPLE_GAME.trimEnd())).toBe(true);
  });
});
