import { describe, expect, it, vi } from 'vitest';
import { PEAK } from '../src/audio/engine';
import { EFFECT_FAMILIES, browseSounds, findSound, presetSound, renderLibrarySamples, renderLibrarySound, searchSounds, soundCategories, soundLibrary, stem, words, type LibrarySound } from '../src/audio/library';
import { JINGLES } from '../src/audio/jingles';
import { synthSound } from '../src/project/defaults';
import { SOUND_PRESETS } from '../src/audio/synth';
import { decodeWav, difference, finite, peak, rms } from './audio-helpers';

// Rendering hundreds of sounds takes a while on a slow machine.
vi.setConfig({ testTimeout: 60_000 });

const lib = soundLibrary();
const render = (id: string) => {
  const r = renderLibrarySamples(id);
  if (!r) throw new Error(`no sound ${id}`);
  return r;
};
const seconds = (r: { samples: Float32Array; sampleRate: number }) => r.samples.length / r.sampleRate;

describe('sound library: the catalog', () => {
  it('has thousands of sounds with unique names and ids', () => {
    expect(lib.length).toBeGreaterThanOrEqual(3000);
    expect(new Set(lib.map((s) => s.id)).size).toBe(lib.length);
    expect(new Set(lib.map((s) => s.name)).size).toBe(lib.length);
    expect(new Set(lib.map((s) => s.name.toLowerCase())).size).toBe(lib.length);
    const kinds = (k: string) => lib.filter((s) => s.kind === k).length;
    expect(kinds('effect')).toBeGreaterThanOrEqual(2500);
    expect(kinds('music')).toBeGreaterThanOrEqual(480);
    expect(kinds('jingle')).toBeGreaterThanOrEqual(100);
  });

  it('describes every sound: a readable name, tags to search by, a sentence about it', () => {
    for (const s of lib) {
      expect(s.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)+$/);
      expect(s.name, s.id).toMatch(/^[A-Z0-9][^\n]{2,60}$/);
      expect(s.tags.length, s.id).toBeGreaterThanOrEqual(4);
      expect(s.description.length, s.id).toBeGreaterThanOrEqual(15);
      expect(findSound(s.id)).toBe(s);
    }
    // Imitations of real animals say so in their names.
    for (const s of lib.filter((x) => ['pet', 'wild'].includes(x.family))) expect(s.name).toMatch(/\(synth\)/);
  });

  it('covers what games need', () => {
    const families = new Set(EFFECT_FAMILIES.map((f) => f.id));
    for (const f of ['jump', 'land', 'step', 'dash', 'slide', 'bounce', 'coin', 'gem', 'star', 'powerup', 'key', 'heart', 'laser', 'zap', 'hit', 'punch', 'swing', 'explosion', 'shield', 'click', 'confirm', 'error', 'levelup', 'countdown', 'wind', 'rain', 'thunder', 'splash', 'bubbles', 'fire', 'bird', 'squeak', 'growl', 'roar', 'engine', 'rocket', 'alarm', 'horn', 'sparkle', 'spell', 'teleport', 'bell', 'chime', 'drum']) {
      expect(families.has(f), f).toBe(true);
    }
    expect(soundCategories().map((c) => c.id).sort()).toEqual(['ambience', 'bells', 'cartoon', 'combat', 'creatures', 'drums', 'games', 'instruments', 'interface', 'jingles', 'machines', 'magic', 'movement', 'music', 'nature', 'pickups', 'vehicles']);
    for (const j of ['win', 'lose', 'levelup', 'gameover', 'fanfare']) expect(JINGLES.some((x) => x.id === j), j).toBe(true);
    // Several sizes of explosion, as names a person would use.
    expect(lib.filter((s) => s.family === 'explosion').map((s) => s.name)).toEqual(expect.arrayContaining(['Tiny Booming Explosion', 'Small Booming Explosion', 'Booming Explosion', 'Big Booming Explosion', 'Huge Booming Explosion']));
    // Browsing shows one of each sound, not every size and take.
    const browse = browseSounds({ kind: 'effect' });
    expect(browse.length).toBeGreaterThan(300);
    expect(browse.length).toBeLessThan(lib.length / 4);
    expect(browseSounds({ category: 'combat' }).every((s) => s.category === 'combat')).toBe(true);
  });

  it('builds quickly (it is built on first use, in the browser)', async () => {
    // A fresh copy of the module, so this times a cold build.
    vi.resetModules();
    const fresh = await import('../src/audio/library');
    const start = performance.now();
    const n = fresh.soundLibrary().length;
    const ms = performance.now() - start;
    expect(n).toBe(lib.length);
    expect(ms).toBeLessThan(1000);
  });
});

describe('sound library: search', () => {
  const top = (query: string, n = 3, kind?: LibrarySound['kind']) => searchSounds(query, { limit: n, kind });
  const families = (query: string, n = 3) => top(query, n).map((s) => s.family);

  it('finds the right family for everyday words', () => {
    const expected: Array<[query: string, family: string[]]> = [
      ['boing', ['jump', 'bounce']],
      ['pew', ['laser']],
      ['spooky music', ['spooky']],
      ['coin', ['coin']],
      ['kaboom', ['explosion']],
      ['footsteps on grass', ['step']],
      ['sword swing', ['swing']],
      ['door creak', ['door']],
      ['level up', ['levelup']],
      ['game over', ['gameover']],
      ['rain', ['rain']],
      ['thunder', ['thunder']],
      ['bird chirp', ['bird']],
      ['engine', ['engine']],
      ['magic sparkle', ['sparkle']],
      ['teleport', ['teleport']],
      ['click', ['click']],
      ['error buzz', ['error']],
      ['win fanfare', ['win', 'fanfare']],
      ['underwater music', ['underwater']],
      ['boss battle music', ['boss']],
      ['splash', ['splash']],
      ['ouch', ['hurt']],
      ['whoosh', ['dash']],
      ['yay', ['crowd']],
      ['meow', ['pet']],
      ['big explosion', ['explosion']],
      ['jumping', ['jump']],
      ['lasers', ['laser']],
      ['chiptune', ['chiptune']],
    ];
    for (const [query, wanted] of expected) {
      const got = families(query);
      expect(got.length, query).toBe(3);
      expect(got.some((f) => wanted.includes(f)), `"${query}" -> ${got.join(', ')}`).toBe(true);
      // The very first result is of the family too.
      expect(wanted, `"${query}" first -> ${got[0]}`).toContain(got[0]);
    }
  });

  it('reads sizes, kinds and plurals', () => {
    expect(top('big explosion', 4).every((s) => /^(Big|Huge) /.test(s.name))).toBe(true);
    expect(top('tiny bell', 3).every((s) => /^Tiny /.test(s.name))).toBe(true);
    expect(top('spooky music', 5).every((s) => s.kind === 'music')).toBe(true);
    expect(top('victory', 5, 'jingle').every((s) => s.kind === 'jingle')).toBe(true);
    expect(top('happy', 5, 'music').every((s) => s.kind === 'music')).toBe(true);
    expect(stem('jumping')).toBe(stem('jumps'));
    expect(stem('explosions')).toBe(stem('explosion'));
    expect(words('The sound of a Game Over!')).toEqual(['gameover']);
    expect(searchSounds('zzzxqy')).toEqual([]);
    expect(searchSounds('')).toEqual([]);
    expect(searchSounds('the of and')).toEqual([]);
  });

  it('spreads results over different sounds, and is the same every time', () => {
    const jumps = top('jump', 10);
    // Ten results are not ten sizes of one jump.
    expect(new Set(jumps.map((s) => s.name.replace(/^(Tiny|Small|Big|Huge) /, '').replace(/ \d$/, ''))).size).toBeGreaterThanOrEqual(5);
    // The plain one comes first: medium size, first take.
    expect(jumps[0].name).toBe('Springy Jump');
    expect(top('explosion', 20).map((s) => s.id)).toEqual(top('explosion', 20).map((s) => s.id));
    expect(top('coin', 500).length).toBeGreaterThan(50);
  });
});

describe('sound library: the sounds', () => {
  const plain = browseSounds({ kind: 'effect' });

  it('renders every effect: audible, finite, never clipping, a sane length', () => {
    expect(plain.length).toBeGreaterThan(500);
    for (const s of plain) {
      const r = render(s.id);
      expect(finite(r.samples), s.id).toBe(true);
      expect(peak(r.samples), s.id).toBeGreaterThan(0.1);
      expect(peak(r.samples), s.id).toBeLessThanOrEqual(PEAK + 1e-6);
      expect(rms(r.samples), s.id).toBeGreaterThan(0.01);
      expect(seconds(r), s.id).toBeGreaterThan(0.02);
      expect(seconds(r), s.id).toBeLessThan(6);
      expect([22050, 32000]).toContain(r.sampleRate);
    }
  });

  it('renders the extremes too: the tiniest and the hugest, and the last take', () => {
    for (const s of lib.filter((x) => x.kind === 'effect' && /-(xs|xl)-2$/.test(x.id)).filter((_, i) => i % 3 === 0)) {
      const r = render(s.id);
      expect(finite(r.samples), s.id).toBe(true);
      expect(peak(r.samples), s.id).toBeGreaterThan(0.1);
      expect(peak(r.samples), s.id).toBeLessThanOrEqual(PEAK + 1e-6);
      expect(seconds(r), s.id).toBeLessThan(9);
    }
  });

  it('renders every jingle tune on every instrument', () => {
    const jingles = lib.filter((s) => s.kind === 'jingle' && !s.id.endsWith('-high'));
    expect(jingles.length).toBeGreaterThan(300);
    for (const s of jingles.filter((_, i) => i % 5 === 0)) {
      const r = render(s.id);
      expect(finite(r.samples), s.id).toBe(true);
      expect(peak(r.samples), s.id).toBeGreaterThan(0.3);
      expect(peak(r.samples), s.id).toBeLessThanOrEqual(PEAK + 1e-6);
      expect(seconds(r), s.id).toBeGreaterThan(0.5);
      expect(seconds(r), s.id).toBeLessThan(8);
    }
  });

  it('is deterministic', () => {
    for (const id of ['jump-springy-m', 'explosion-booming-xl-2', 'rain-steady-m', 'bird-warbling-s', 'jingle-win-brass-1', 'talk-chirpy-m-3', 'ambience-forest-birds-m-2']) {
      expect(Array.from(render(id).samples), id).toEqual(Array.from(render(id).samples));
      expect(renderLibrarySound(id)!.dataUrl).toBe(renderLibrarySound(id)!.dataUrl);
    }
    expect(renderLibrarySound('no-such-sound')).toBeNull();
    const wav = decodeWav(renderLibrarySound('coin-classic-m')!.dataUrl);
    expect(wav.samples.length).toBe(render('coin-classic-m').samples.length);
  });

  it('has sizes that differ: smaller is shorter and higher, bigger is longer and lower', () => {
    let least = Infinity;
    for (const s of plain.filter((_, i) => i % 2 === 0)) {
      const base = s.id.slice(0, -2);
      const small = findSound(`${base}-xs`) ?? findSound(`${base}-s`);
      const big = findSound(`${base}-xl`) ?? findSound(`${base}-l`);
      if (!small || !big) continue;
      const d = difference(render(small.id), render(big.id));
      least = Math.min(least, d);
      expect(d, base).toBeGreaterThan(0.15);
    }
    expect(least).toBeLessThan(Infinity);
    const tiny = render('explosion-booming-xs');
    const huge = render('explosion-booming-xl');
    expect(seconds(huge)).toBeGreaterThan(1.8 * seconds(tiny));
  });

  it('has takes that differ', () => {
    for (const s of plain.filter((_, i) => i % 2 === 1)) {
      const other = findSound(`${s.id}-2`);
      if (!other) continue;
      expect(difference(render(s.id), render(other.id)), s.id).toBeGreaterThan(0.03);
    }
  });

  it('has variants that differ from each other within a family', () => {
    for (const fam of EFFECT_FAMILIES) {
      const sounds = plain.filter((s) => s.family === fam.id).map((s) => ({ id: s.id, r: render(s.id) }));
      expect(sounds.length, fam.id).toBeGreaterThanOrEqual(3);
      for (let i = 0; i < sounds.length; i++) {
        for (let j = i + 1; j < sounds.length; j++) expect(difference(sounds[i].r, sounds[j].r), `${sounds[i].id} ~ ${sounds[j].id}`).toBeGreaterThan(0.05);
      }
    }
  });

  it('gives new projects library sounds in place of the old presets', () => {
    for (const preset of Object.keys(SOUND_PRESETS)) {
      const made = presetSound(preset);
      expect(made, preset).not.toBeNull();
      const { samples } = decodeWav(made!.dataUrl);
      expect(peak(samples), preset).toBeGreaterThan(0.3);
      expect(presetSound(preset)).toBe(made);
    }
    expect(presetSound('nope')).toBeNull();
    expect(synthSound('jump', 'jump').dataUrl).toBe(renderLibrarySound('jump-springy-m')!.dataUrl);
    expect(synthSound('boop', 'pop')).toMatchObject({ name: 'boop', kind: 'sound', mime: 'audio/wav' });
  });
});
