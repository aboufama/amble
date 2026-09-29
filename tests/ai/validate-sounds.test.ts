/**
 * `static sounds` and literal `this.sfx([...])` segments: the synth plays whatever numbers it gets, so a
 * guess in the wrong units must be caught (and fixed where the meaning is clear) before the game ships.
 */
import { describe, expect, it } from 'vitest';
import type { KitManifest, ValidationResult } from '../../src/ai/validate/types';
import { validateCode } from '../../src/ai/validate/validate';
import { parseRecipe } from '../../src/runtime/kit/sounds';
import { PROBE_MANIFEST } from './fixtures/probeManifest';

const KIT: KitManifest = { ...PROBE_MANIFEST, sceneMethods: [...PROBE_MANIFEST.sceneMethods, 'sfx'] };
const game = (sounds: string, body = "    this.sfx('zap');") => `class Game extends Amble.Scene {\n  static sounds = ${sounds};\n  create() {\n${body}\n  }\n}\n`;
const run = (code: string, fix = true) => validateCode(code, { manifest: KIT, fix });
const soundIssues = (r: ValidationResult) => [...r.errors, ...r.warnings].filter((i) => i.rule === 'sounds-manifest');
/** The `static sounds` literal of the (fixed) code, read the way the kit reads it. */
const soundsOf = (r: ValidationResult) => r.statics.sounds as Record<string, unknown>;

describe('static sounds', () => {
  it('accepts well-formed sounds, in both shapes, without a word', () => {
    const r = run(
      game(
        "{ zap: [{ wave: 'square', startFreq: 900, endFreq: 300, duration: 0.12, startVolume: 0.5, endVolume: 0 }], boom: { caption: '[boom]', segments: [{ wave: 'noise', startFreq: 900, endFreq: 40, duration: 1.1, startVolume: 1, endVolume: 0 }] } }",
      ),
    );
    expect(soundIssues(r)).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('turns durations written in milliseconds (an 8-second tone) into seconds, and says why', () => {
    const code = game("{ zap: [{ wave: 'square', startFreq: 900, endFreq: 300, duration: 150, startVolume: 0.5, endVolume: 0 }] }");
    const unfixed = run(code, false);
    const issue = unfixed.errors.find((i) => i.rule === 'sounds-manifest');
    expect(issue?.message).toMatch(/static sounds\.zap\[0\]\.duration.*150.*seconds.*8 seconds.*0\.15/);
    expect(issue?.line).toBe(2);
    expect(issue?.kid).toMatch(/sound/);
    const r = run(code);
    expect(r.ok).toBe(true);
    expect(r.fixes.map((f) => f.description)).toContainEqual(expect.stringMatching(/duration: 150 -> 0\.15/));
    expect(parseRecipe(soundsOf(r).zap)?.[0].duration).toBe(0.15);
  });

  it('turns volumes written as percent into 0..1', () => {
    const r = run(game("{ zap: [{ wave: 'sine', startFreq: 440, endFreq: 440, duration: 0.1, startVolume: 80, endVolume: 0 }] }"));
    expect(r.ok).toBe(true);
    expect(parseRecipe(soundsOf(r).zap)?.[0].startVolume).toBe(0.8);
  });

  it("renames the fields models reach for (freq, volume, type, ms) to the synth's names", () => {
    const r = run(game("{ zap: [{ type: 'saw', freq: 700, to: 200, ms: 90, volume: 0.6 }] }"));
    expect(r.ok).toBe(true);
    const [seg] = parseRecipe(soundsOf(r).zap) ?? [];
    expect(seg).toEqual({ wave: 'sawtooth', startFreq: 700, endFreq: 200, duration: 0.09, startVolume: 0.6, endVolume: 0 });
  });

  it("names the wave it doesn't know, and fixes one it can place", () => {
    expect(parseRecipe(soundsOf(run(game("{ zap: [{ wave: 'White Noise', startFreq: 900, duration: 0.2 }] }"))).zap)?.[0].wave).toBe('noise');
    const r = run(game("{ zap: [{ wave: 'bagpipe', startFreq: 900, duration: 0.2 }] }"));
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toMatch(/'bagpipe'.*'sine', 'square', 'triangle', 'sawtooth', 'noise'/);
  });

  it('flags frequencies outside hearing and numbers written as text, without guessing', () => {
    const r = run(game("{ zap: [{ wave: 'sine', startFreq: 0.8, endFreq: 44000, duration: '0.1' }] }"));
    expect(r.ok).toBe(false);
    const messages = r.errors.map((i) => i.message).join('\n');
    expect(messages).toMatch(/startFreq` is 0\.8: frequencies are in Hz, 20 to 20000.*800 Hz if you meant 0\.8 kHz/);
    expect(messages).toMatch(/endFreq` is 44000/);
    expect(messages).toMatch(/duration` must be a plain number \(seconds\)/);
    expect(r.fixes).toEqual([]);
  });

  it('asks for seconds when a duration is neither clearly seconds nor clearly ms', () => {
    const r = run(game("{ zap: [{ wave: 'sine', startFreq: 440, duration: 12 }] }"));
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toMatch(/duration` is 12: durations are in seconds.*0\.012 is 12 ms/);
    // Long but possible: a warning, not a failure.
    const long = run(game("{ drone: [{ wave: 'sine', startFreq: 110, duration: 4 }] }"));
    expect(long.ok).toBe(true);
    expect(long.warnings.map((w) => w.message)).toContainEqual(expect.stringMatching(/4 seconds, long for a sound effect/));
  });

  it('wraps a lone segment in its list, and explains a sound that is not a list at all', () => {
    const r = run(game("{ zap: { wave: 'square', startFreq: 900, duration: 0.1 } }"));
    expect(r.ok).toBe(true);
    expect(parseRecipe(soundsOf(r).zap)).toHaveLength(1);
    const alias = run(game("{ zap: 'laser' }"));
    expect(alias.ok).toBe(false);
    expect(alias.errors[0].message).toMatch(/must be a list of segments.*this\.sfx\('laser'\)/);
    expect(run(game('{ zap: [] }')).errors[0].message).toMatch(/has no segments/);
    expect(run(game("{ zap: { caption: '[zap]' } }")).errors[0].message).toMatch(/needs `segments`/);
  });

  it('warns about fields the synth ignores, and never trips on names every object has', () => {
    const r = run(game("{ zap: [{ wave: 'square', startFreq: 900, duration: 0.1, attack: 0.01, constructor: 1 }] }"));
    expect(r.ok).toBe(true);
    expect(r.warnings.filter((w) => w.rule === 'sounds-manifest').map((w) => w.message)).toEqual([
      expect.stringMatching(/zap\[0\]\.attack` is not a segment field/),
      expect.stringMatching(/zap\[0\]\.constructor` is not a segment field/),
    ]);
  });
});

describe('segments written into this.sfx([...])', () => {
  it('checks them like static sounds', () => {
    const r = run(game("{ zap: [{ wave: 'square', startFreq: 900, duration: 0.1 }] }", "    this.sfx([{ wave: 'sine', startFreq: 300, endFreq: 900, duration: 250, startVolume: 0.5 }]);"));
    expect(r.ok).toBe(true);
    expect(r.fixes.map((f) => f.description)).toContainEqual(expect.stringMatching(/sfx\(\[\.\.\.\]\)\[0\]\.duration: 250 -> 0\.25/));
    expect(r.files[0].content).toContain('duration: 0.25');
  });
});
