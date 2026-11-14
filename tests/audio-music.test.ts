import { describe, expect, it } from 'vitest';
import { PEAK, toDataUrl } from '../src/audio/engine';
import { browseSounds, loopParams, renderLibrarySamples, soundLibrary } from '../src/audio/library';
import { MAX_LOOP_CHARS, MOODS, MUSIC_STYLES, composeMusic, keyName, parseChord, parseKey, renderMusic, renderSong, type MusicStyle } from '../src/audio/music';
import { bandProfile, contour, crossings, difference, finite, peak, rms, seam } from './audio-helpers';

const seconds = (r: { samples: Float32Array; sampleRate: number }) => r.samples.length / r.sampleRate;
/** What a style sounds like, as numbers: its tone colour, its loudness pattern over the loop, its brightness. */
const fingerprint = (r: { samples: Float32Array; sampleRate: number }): number[] => [...bandProfile(r.samples, r.sampleRate).map((v) => v / 10), ...contour(r.samples, 32).map((v) => v * 2), crossings(r.samples, r.sampleRate) / 500];
const distance = (a: number[], b: number[]): number => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));

const styles = MUSIC_STYLES.map((s) => s.id);
/** Each style's usual loop (medium tempo, bright), rendered once for all the tests. */
const loops = new Map(styles.map((id) => [id, renderMusic(loopParams(id, 1, false, 0))]));

describe('music: the composer', () => {
  it('knows at least sixteen styles, each described', () => {
    expect(styles.length).toBeGreaterThanOrEqual(16);
    for (const want of ['chiptune', 'disco', 'synthwave', 'funk', 'rock', 'lullaby', 'spooky', 'adventure', 'jazz', 'latin', 'space', 'boss', 'circus', 'underwater', 'western', 'techno']) expect(styles).toContain(want);
    for (const s of MUSIC_STYLES) {
      expect(s.name.length).toBeGreaterThan(2);
      expect(s.about.length).toBeGreaterThan(20);
      expect(s.tags.split(' ').length).toBeGreaterThan(6);
      expect(s.bpm[0]).toBeLessThan(s.bpm[1]);
      expect(s.bpm[1]).toBeLessThan(s.bpm[2]);
    }
  });

  it('writes drums, bass, chords and a melody for every style', () => {
    for (const style of styles) {
      for (const dark of [false, true]) {
        const song = composeMusic({ style, dark, seed: 4, energy: 0.7 });
        const names = song.tracks.map((t) => t.name);
        expect(names, style).toEqual(expect.arrayContaining(['bass', 'comp', 'lead']));
        for (const t of song.tracks) expect(t.notes.length, `${style} ${t.name}`).toBeGreaterThan(1);
        if (style !== 'sad') expect(song.drums.length, style).toBeGreaterThan(3);
        expect(song.seconds, style).toBeCloseTo(song.bars * song.steps * song.stepSec, 6);
        expect(song.seconds, style).toBeGreaterThanOrEqual(7);
        expect(song.seconds, style).toBeLessThanOrEqual(14.5);
        // Every note starts inside the loop, at a sane pitch.
        for (const t of song.tracks) {
          for (const n of t.notes) {
            expect(n.t).toBeGreaterThanOrEqual(0);
            expect(n.t).toBeLessThan(song.bars * song.steps);
            expect(n.m).toBeGreaterThan(20);
            expect(n.m).toBeLessThan(110);
          }
        }
      }
    }
  });

  it('writes melodies the way a tune goes: mostly by step, on chord notes where it counts, ending at home', () => {
    let steps = 0;
    let moves = 0;
    let home = 0;
    let tunes = 0;
    for (const style of styles) {
      for (const seed of [1, 2, 3]) {
        const song = composeMusic({ style, seed });
        const lead = song.tracks.find((t) => t.name === 'lead')!.notes;
        expect(lead.length, style).toBeGreaterThanOrEqual(4);
        const pitches = lead.map((n) => n.m);
        expect(Math.max(...pitches) - Math.min(...pitches), style).toBeLessThanOrEqual(24);
        expect(new Set(pitches).size, style).toBeGreaterThanOrEqual(3);
        for (let i = 1; i < pitches.length; i++) {
          moves++;
          if (Math.abs(pitches[i] - pitches[i - 1]) <= 4) steps++;
        }
        // The last note belongs to the last chord, and is often the key note itself.
        const last = parseChord(song.chords[(song.chords.length >= song.bars * 2 ? song.bars * 2 - 1 : song.bars - 1) % song.chords.length]);
        const pcs = last.ints.map((i) => (song.key + last.root + i) % 12);
        expect(pcs, `${style} seed ${seed}`).toContain(pitches[pitches.length - 1] % 12);
        tunes++;
        if (pitches[pitches.length - 1] % 12 === song.key) home++;
      }
    }
    expect(steps / moves).toBeGreaterThan(0.75);
    expect(home / tunes).toBeGreaterThan(0.25);
  });

  it('follows its parameters: tempo, key, mood, energy, seed, chords and melody', () => {
    const base = composeMusic({ style: 'rock', seed: 9 });
    expect(composeMusic({ style: 'rock', seed: 9 })).toEqual(base);
    expect(composeMusic({ style: 'rock', seed: 10 }).tracks.at(-1)!.notes).not.toEqual(base.tracks.at(-1)!.notes);
    expect(composeMusic({ style: 'rock', tempo: 100 }).bpm).toBe(100);
    expect(composeMusic({ style: 'rock', tempo: 9999 }).bpm).toBe(base.bpm);
    expect(composeMusic({ style: 'rock', key: 'F#' }).key).toBe(6);
    expect(parseKey('Bb')).toBe(10);
    expect(parseKey('H')).toBeNull();
    expect(keyName(10)).toBe('Bb');
    for (const mood of MOODS) expect(composeMusic({ style: 'adventure', mood }).dark).toBe(['tense', 'sad', 'mysterious', 'scary'].includes(mood));
    const calm = composeMusic({ style: 'disco', energy: 0.1, seed: 2 });
    const busy = composeMusic({ style: 'disco', energy: 1, seed: 2 });
    expect(busy.drums.length).toBeGreaterThan(calm.drums.length);
    expect(composeMusic({ style: 'lullaby', chords: ['I', 'vi', 'IV', 'V'] }).chords).toEqual(['I', 'vi', 'IV', 'V']);
    expect(parseChord('bVII')).toEqual({ root: 10, ints: [0, 4, 7] });
    expect(parseChord('ii7')).toEqual({ root: 2, ints: [0, 3, 7, 10] });
    expect(parseChord('gibberish')).toEqual({ root: 0, ints: [0, 4, 7] });
    // The author's own tune: scale steps on an eighth-note grid, in the key.
    const own = composeMusic({ style: 'happy', key: 'C', melody: [1, 2, 3, -1, 5, 0, 8, -1] });
    const lead = own.tracks.find((t) => t.name === 'lead')!.notes;
    expect(lead.slice(0, 5).map((n) => n.m % 12)).toEqual([0, 2, 4, 7, 0]);
    expect(lead[2].d).toBe(2 * lead[0].d);
    // An unknown style still makes music.
    expect(composeMusic({ style: 'polka-dot' as MusicStyle }).tracks.length).toBeGreaterThan(2);
  });
});

describe('music: the loops', () => {
  it('renders every style: 7 to 14.5 seconds, under the size limit, loud but never clipping', { timeout: 60_000 }, () => {
    for (const [style, r] of loops) {
      expect(finite(r.samples), style).toBe(true);
      expect(seconds(r), style).toBeGreaterThanOrEqual(7);
      expect(seconds(r), style).toBeLessThanOrEqual(14.5);
      expect(peak(r.samples), style).toBeLessThanOrEqual(PEAK + 1e-6);
      expect(peak(r.samples), style).toBeGreaterThan(0.6);
      expect(rms(r.samples), style).toBeGreaterThan(0.1);
      expect(rms(r.samples), style).toBeLessThan(0.35);
      // No long silences: every tenth of the loop has music in it.
      for (const level of contour(r.samples, 10)) expect(level, style).toBeGreaterThan(0.15);
      const url = toDataUrl(r).dataUrl;
      expect(url.length, style).toBeLessThanOrEqual(650_000);
      expect(url.length, style).toBeLessThanOrEqual(MAX_LOOP_CHARS);
      expect(r.sampleRate, style).toBeGreaterThanOrEqual(16000);
    }
  });

  it('stays in range at every tempo and flavour', { timeout: 60_000 }, () => {
    for (const [i, style] of styles.entries()) {
      // Slow and fast, bright and dark, taking turns (every combination is in the library).
      for (const tempo of [0, 2]) {
        const r = renderMusic(loopParams(style, tempo, (i + tempo) % 4 < 2, 1));
        expect(seconds(r), `${style} ${tempo}`).toBeGreaterThanOrEqual(7);
        expect(seconds(r), `${style} ${tempo}`).toBeLessThanOrEqual(14.5);
        expect(toDataUrl(r).dataUrl.length, `${style} ${tempo}`).toBeLessThanOrEqual(650_000);
        expect(peak(r.samples)).toBeLessThanOrEqual(PEAK + 1e-6);
        expect(finite(r.samples)).toBe(true);
      }
    }
  });

  it('loops seamlessly: what rings on at the end is wrapped round to the start', { timeout: 60_000 }, () => {
    for (const style of styles) {
      // With nothing starting on the very first beat, the only sound at the seam is the end of
      // the loop ringing on. If it were cut off instead of wrapped, this would be a click.
      const song = composeMusic(loopParams(style, 1, false, 0));
      song.drums = song.drums.filter((d) => d.t >= 1);
      for (const t of song.tracks) t.notes = t.notes.filter((n) => n.t >= 1);
      const quiet = renderSong(song);
      // (Lo-fi has vinyl crackle all through it: clicks on purpose, so its bar is the looser one.)
      expect(seam(quiet.samples), style).toBeLessThan(style === 'lofi' ? 3 : 1);
      // The whole loop: its seam is a downbeat like any other, not the sharpest thing in it by far.
      expect(seam(loops.get(style)!.samples), style).toBeLessThan(3);
    }
    // The tail really is there: a loop's first instant already has the last bar's echo in it.
    const song = composeMusic({ style: 'space', seed: 1 });
    song.drums = [];
    for (const t of song.tracks) t.notes = t.notes.filter((n) => n.t >= 8);
    const wrapped = renderSong(song).samples;
    expect(rms(wrapped.subarray(0, 2000))).toBeGreaterThan(0.01);
  });

  it('is deterministic, and different seeds are different tunes', () => {
    for (const style of ['chiptune', 'jazz', 'space'] as MusicStyle[]) {
      const again = renderMusic(loopParams(style, 1, false, 0));
      expect(Array.from(again.samples), style).toEqual(Array.from(loops.get(style)!.samples));
      expect(difference(renderMusic(loopParams(style, 1, false, 1)), again), style).toBeGreaterThan(0.02);
    }
  });

  it('has styles that sound different from one another', () => {
    const prints = styles.map((id) => ({ id, f: fingerprint(loops.get(id)!) }));
    let nearest = Infinity;
    for (let i = 0; i < prints.length; i++) {
      for (let j = i + 1; j < prints.length; j++) {
        const d = distance(prints[i].f, prints[j].f);
        nearest = Math.min(nearest, d);
        expect(d, `${prints[i].id} ~ ${prints[j].id}`).toBeGreaterThan(0.5);
      }
    }
    // For scale: the same style with another seed is closer to itself than any two styles are.
    const self = distance(fingerprint(renderMusic({ ...loopParams('rock', 1, false, 0), seed: 77 })), prints.find((p) => p.id === 'rock')!.f);
    expect(nearest).toBeGreaterThan(0.5);
    expect(self).toBeLessThan(2.5);
    // And they are different music on paper too: tempo, instruments or drum pattern.
    const paper = styles.map((id) => {
      const s = composeMusic(loopParams(id, 1, false, 0));
      return `${s.bpm}|${s.kit}|${s.tracks.map((t) => t.patch).join(',')}`;
    });
    expect(new Set(paper).size).toBe(styles.length);
  });

  it('are all in the library: every style at three tempos, bright and dark', () => {
    const music = soundLibrary().filter((s) => s.kind === 'music');
    for (const style of styles) {
      const own = music.filter((s) => s.family === style);
      expect(own.length, style).toBeGreaterThanOrEqual(18);
      for (const word of ['slow', 'medium', 'fast', 'bright', 'dark']) expect(own.some((s) => s.tags.includes(word)), `${style} ${word}`).toBe(true);
    }
    const one = browseSounds({ kind: 'music' })[0];
    const r = renderLibrarySamples(one.id)!;
    expect(seconds(r)).toBeGreaterThan(7);
    expect(Array.from(r.samples.subarray(0, 500))).toEqual(Array.from(renderLibrarySamples(one.id)!.samples.subarray(0, 500)));
  });
});
