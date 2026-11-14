import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateAsset, placeholderAsset, type AssetContext, type AssetJob } from '../src/compiler/assets';
import { compileProject } from '../src/compiler/compile';
import { DEFAULT_SETTINGS, type Transport } from '../src/compiler/openai';
import { soundPrompt } from '../src/compiler/prompt';
import { SOUND_SCHEMA } from '../src/compiler/schema';
import { candidateLine, customEffectRecipe, customMusicParams, fallbackSound, renderSoundReply, soundCandidates, soundKindFor, styleLines, type CustomLayer, type SoundReply } from '../src/audio/custom';
import { PEAK, renderRecipe } from '../src/audio/engine';
import { findSound, renderLibrarySound } from '../src/audio/library';
import { MUSIC_STYLES } from '../src/audio/music';
import { block, newProject, workspace } from '../src/project/defaults';
import { decodeWav, finite, peak, rms } from './audio-helpers';
import { artBrief } from '../src/project/styles';

afterEach(() => vi.unstubAllGlobals());

const sse = (content: string) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`;
const transport: Transport = { baseUrl: 'https://api.openai.com/v1', headers: { Authorization: 'Bearer sk-test' }, via: 'browser' };
const ctx: AssetContext = { transport, settings: { ...DEFAULT_SETTINGS, apiKey: 'sk-test' }, gameTitle: 'Moon Hopper', style: artBrief('') };
const job = (name: string, description: string): AssetJob => ({ targetId: 't1', targetName: 'Amble', kind: 'sound', name, description, width: 0, height: 0 });

interface Seen {
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
}

/** Answers every chat request with `reply` (an object, or a function of the request), and records what was asked. */
function model(reply: unknown | ((seen: Seen) => unknown)): { calls: Seen[] } {
  const calls: Seen[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const seen: Seen = { system: body.messages[0].content, user: body.messages[1].content, schemaName: body.response_format?.json_schema?.name, schema: body.response_format?.json_schema?.schema };
      calls.push(seen);
      const answer = typeof reply === 'function' ? (reply as (s: Seen) => unknown)(seen) : reply;
      return new Response(sse(typeof answer === 'string' ? answer : JSON.stringify(answer)), { status: 200 });
    }),
  );
  return { calls };
}

const layer = (over: Partial<CustomLayer>): CustomLayer => ({
  source: 'sine',
  start: 0,
  duration: 0.2,
  freq: 440,
  freqEnd: 440,
  attack: 0.001,
  decay: 0.2,
  sustain: 0,
  release: 0.05,
  volume: 0.8,
  vibratoRate: 0,
  vibratoDepth: 0,
  tremoloRate: 0,
  tremoloDepth: 0,
  detune: 0,
  pulseWidth: 0.5,
  fmRatio: 0,
  fmAmount: 0,
  filter: 'none',
  cutoff: 0,
  cutoffEnd: 0,
  resonance: 0,
  notes: [],
  noteStep: 0,
  ...over,
});
const customEffect: SoundReply = {
  use: 'effect',
  libraryId: '',
  effect: {
    layers: [layer({ source: 'square', freq: 300, freqEnd: 900, duration: 0.25, decay: 0.25 }), layer({ source: 'noise', duration: 0.1, decay: 0.1, filter: 'bandpass', cutoff: 800, cutoffEnd: 4000, resonance: 0.4, volume: 0.4 }), layer({ source: 'bell', freq: 1568, start: 0.25, duration: 0.4, notes: [0, 7], noteStep: 0.08 })],
    reverb: 0.3,
    echo: 0.2,
    echoTime: 0.12,
    chorus: 0,
    drive: 0,
    crush: 0,
  },
  music: null,
};

describe('a sound for a game being built', () => {
  it('shows the model the closest library sounds, in one request with a strict schema', async () => {
    const { calls } = model({ use: 'library', libraryId: 'jump-cartoon-m', effect: null, music: null });
    const asset = await generateAsset(job('jump', 'a springy cartoon boing when Amble jumps'), ctx);
    expect(calls).toHaveLength(1);
    expect(calls[0].schemaName).toBe('sound_recipe');
    expect(calls[0].schema).toEqual(JSON.parse(JSON.stringify(SOUND_SCHEMA)));
    // Ten candidates, best first: "n. id | name | tags".
    const lines = calls[0].user.split('\n').filter((l) => /^\d+\. /.test(l));
    expect(lines).toHaveLength(10);
    for (const line of lines) {
      const [id, name] = line.replace(/^\d+\. /, '').split(' | ');
      expect(findSound(id)?.name, line).toBe(name);
    }
    expect(lines.filter((l) => /jump-|bounce-/.test(l)).length).toBeGreaterThanOrEqual(6);
    expect(calls[0].user).toContain('"jump"');
    expect(calls[0].user).toContain('a springy cartoon boing when Amble jumps');
    expect(calls[0].user).toContain('Moon Hopper');
    expect(calls[0].system).toContain('"use": "library"');
    expect(calls[0].system).toContain('# Designing your own effect');
    expect(calls[0].system).not.toContain('# Asking for your own music');
    // The asset is the library sound, in the shape the game expects.
    expect(asset).toMatchObject({ kind: 'sound', name: 'jump', mime: 'audio/wav', targetId: 't1', targetName: 'Amble', description: 'a springy cartoon boing when Amble jumps', request: 'a springy cartoon boing when Amble jumps' });
    expect(asset.dataUrl).toBe(renderLibrarySound('jump-cartoon-m')!.dataUrl);
    expect(asset.kind === 'sound' && asset.duration).toBeCloseTo(renderLibrarySound('jump-cartoon-m')!.duration, 6);
  });

  it('asks about music differently: the loops on offer and the styles the composer knows', async () => {
    const { calls } = model((seen: Seen) => ({ use: 'library', libraryId: /^1\. (\S+) \|/m.exec(seen.user)![1], effect: null, music: null }));
    const asset = await generateAsset(job('theme', 'spooky background music for the haunted level'), ctx);
    expect(calls).toHaveLength(1);
    const lines = calls[0].user.split('\n').filter((l) => /^\d+\. /.test(l));
    expect(lines).toHaveLength(10);
    expect(lines.every((l) => /^\d+\. music-/.test(l))).toBe(true);
    expect(lines.filter((l) => /music-spooky-/.test(l)).length).toBeGreaterThanOrEqual(5);
    expect(lines[0]).toMatch(/bpm/);
    expect(calls[0].system).toContain('# Asking for your own music');
    expect(calls[0].system).not.toContain('# Designing your own effect');
    for (const s of MUSIC_STYLES) expect(calls[0].system).toContain(`- ${s.id}: `);
    expect(asset.kind === 'sound' && asset.duration).toBeGreaterThan(7);
    expect(asset.dataUrl.length).toBeLessThanOrEqual(650_000);
  });

  it('uses the library sound the model picks', async () => {
    model({ use: 'library', libraryId: 'explosion-rumbling-xl', effect: null, music: null });
    const asset = await generateAsset(job('boom', 'the asteroid explodes'), ctx);
    expect(asset.dataUrl).toBe(renderLibrarySound('explosion-rumbling-xl')!.dataUrl);
  });

  it("renders the model's own effect", async () => {
    model(customEffect);
    const asset = await generateAsset(job('zwip', 'a rising zwip with a bell at the end'), ctx);
    expect(asset.mime).toBe('audio/wav');
    const { samples, sampleRate } = decodeWav(asset.dataUrl);
    expect(finite(samples)).toBe(true);
    expect(peak(samples)).toBeGreaterThan(0.5);
    expect(peak(samples)).toBeLessThanOrEqual(PEAK + 1e-3);
    expect(rms(samples)).toBeGreaterThan(0.03);
    expect(samples.length / sampleRate).toBeGreaterThan(0.5);
    expect(samples.length / sampleRate).toBeLessThan(4);
    expect(asset.kind === 'sound' && asset.duration).toBeCloseTo(samples.length / sampleRate, 6);
    // It is the model's sound, not a library one, and the same answer gives the same sound.
    expect(asset.dataUrl).not.toBe(fallbackSound('zwip', 'a rising zwip with a bell at the end').dataUrl);
    model(customEffect);
    expect((await generateAsset(job('zwip', 'a rising zwip with a bell at the end'), ctx)).dataUrl).toBe(asset.dataUrl);
  });

  it("renders the model's own music", async () => {
    model({ use: 'music', libraryId: '', effect: null, music: { style: 'synthwave', tempo: 96, key: 'A', mood: 'mysterious', energy: 0.5, seed: 42, chords: ['i', 'bVI', 'bIII', 'bVII'], melody: [] } });
    const asset = await generateAsset(job('night_drive', 'moody synth music for driving at night'), ctx);
    const { samples, sampleRate } = decodeWav(asset.dataUrl);
    // Four bars at 96 beats a minute.
    expect(samples.length / sampleRate).toBeCloseTo(10, 1);
    expect(peak(samples)).toBeGreaterThan(0.6);
    expect(asset.dataUrl.length).toBeLessThanOrEqual(650_000);
  });

  it('falls back to the best library match when the request fails', async () => {
    const want = fallbackSound('coin', 'a bright coin pickup');
    expect(want.libraryId).toBe(soundCandidates('coin', 'a bright coin pickup')[0].id);
    expect(want.libraryId).toMatch(/^coin-/);
    // The server says no.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'boom' } }), { status: 500 })));
    expect((await generateAsset(job('coin', 'a bright coin pickup'), ctx)).dataUrl).toBe(want.dataUrl);
    // No network at all.
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    expect((await generateAsset(job('coin', 'a bright coin pickup'), ctx)).dataUrl).toBe(want.dataUrl);
    // A key that was turned down.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 })));
    const asset = await generateAsset(job('coin', 'a bright coin pickup'), ctx);
    expect(asset.dataUrl).toBe(want.dataUrl);
    expect(peak(decodeWav(asset.dataUrl).samples)).toBeGreaterThan(0.5);
  });

  it('falls back when the answer is empty, junk, or cannot be played', async () => {
    const want = fallbackSound('laser', 'pew pew').dataUrl;
    const silent: SoundReply = { use: 'effect', libraryId: '', effect: { ...customEffect.effect!, layers: [layer({ volume: 0 })] }, music: null };
    const junk: unknown[] = [
      { parts: [] },
      {},
      '',
      'Sorry, I cannot help with that.',
      '[]',
      'null',
      { use: 'library', libraryId: 'no-such-sound', effect: null, music: null },
      { use: 'library', libraryId: '', effect: null, music: null },
      { use: 'effect', libraryId: '', effect: null, music: null },
      { use: 'effect', libraryId: '', effect: { layers: [] }, music: null },
      { use: 'music', libraryId: '', effect: null, music: { style: 'polka' } },
      { use: 'dance', libraryId: 'laser-pew-m' },
      { segments: [{ wave: 'square', startFreq: 900, endFreq: 200, duration: 0.2, startVolume: 0.6, endVolume: 0 }] },
      silent,
    ];
    for (const reply of junk) {
      model(reply);
      const asset = await generateAsset(job('laser', 'pew pew'), ctx);
      expect(asset.dataUrl, JSON.stringify(reply)).toBe(want);
    }
    expect(want).toBe(renderLibrarySound(soundCandidates('laser', 'pew pew')[0].id)!.dataUrl);
    expect(soundCandidates('laser', 'pew pew')[0].family).toBe('laser');
  });

  it('stops when the build is cancelled, rather than falling back', async () => {
    const abort = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        abort.abort();
        throw new DOMException('Aborted', 'AbortError');
      }),
    );
    await expect(generateAsset(job('coin', 'a coin'), { ...ctx, signal: abort.signal })).rejects.toThrow();
  });

  it('uses the library for placeholders too (no ping)', () => {
    const a = placeholderAsset(job('splash', 'water splash'));
    expect(a).toMatchObject({ kind: 'sound', name: 'splash', mime: 'audio/wav', targetId: 't1' });
    expect(a.dataUrl).toBe(renderLibrarySound('splash-splash-m')!.dataUrl);
    const music = placeholderAsset(job('bgm', 'calm underwater music'));
    expect(music.kind === 'sound' && music.duration).toBeGreaterThan(7);
    // Even words the library has never heard of get a sound.
    const odd = placeholderAsset(job('xyzzy', 'qwfp zxcv'));
    expect(peak(decodeWav(odd.dataUrl).samples)).toBeGreaterThan(0.3);
  });

  it('builds a whole game: every sound it asks for comes back playable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (String(url).endsWith('/api/config')) return new Response('{}', { status: 404 });
        const body = JSON.parse(String(init.body));
        const name = body.response_format?.json_schema?.name;
        const prompt = String(body.messages[1].content);
        const sound = (n: string, description: string) => ({ target: 'Amble', kind: 'sound', name: n, description, width: 0, height: 0, reuse: false });
        const reply =
          name === 'amble_pieces'
            ? {
                pieces: [...prompt.matchAll(/^- (p\d+):/gm)].map((m) => ({ id: m[1], code: '' })),
                sprites: [],
                assets: [sound('hop', 'a bouncy jump'), sound('ding', 'collecting a star'), sound('ouch', 'the player gets hurt'), sound('win', 'a short victory jingle'), sound('song', 'happy chiptune music')],
                warnings: [],
                questions: [],
              }
            : // The browser tests' mock: junk for a schema it doesn't know.
              { parts: [] };
        return new Response(sse(JSON.stringify(reply)), { status: 200 });
      }),
    );
    const p = newProject();
    p.sprites[0].blocks = workspace([block('ev_start'), block('ga_do', { ACTION: 'hop about collecting stars' })]);
    const game = await compileProject(p, { settings: { ...DEFAULT_SETTINGS, apiKey: 'sk-test' } });
    const sounds = game.assets.filter((a) => a.kind === 'sound');
    expect(sounds.map((a) => a.name).sort()).toEqual(['ding', 'hop', 'ouch', 'song', 'win']);
    for (const a of sounds) {
      const { samples } = decodeWav(a.dataUrl);
      expect(peak(samples), a.name).toBeGreaterThan(0.3);
      expect(a.dataUrl, a.name).toBe(fallbackSound(a.name, a.description ?? '').dataUrl);
    }
    expect(game.warnings.filter((w) => /sound/.test(w))).toEqual([]);
    const song = sounds.find((a) => a.name === 'song')!;
    expect(song.kind === 'sound' && song.duration).toBeGreaterThan(7);
  });
});

describe('sound requests: the pieces', () => {
  it('tells music from effects by the words used', () => {
    const cases: Array<[name: string, description: string, kind: 'music' | 'effect']> = [
      ['jump', 'a short bouncy jump sound', 'effect'],
      ['bgm', 'cheerful looping background music for a platformer', 'music'],
      ['theme', 'the spooky theme', 'music'],
      ['soundtrack', 'calm', 'music'],
      ['song', 'a happy song', 'music'],
      ['tune', 'a lullaby tune', 'music'],
      ['loop', 'a chiptune loop', 'music'],
      ['rain', 'a loop of gentle rain', 'effect'],
      ['win', 'a short happy victory tune', 'effect'],
      ['gameover', 'sad game over music', 'effect'],
      ['fanfare', 'triumphant music when you win', 'effect'],
      ['coin', 'bright coin pickup ding', 'effect'],
      ['engine', 'car engine', 'effect'],
    ];
    for (const [name, description, kind] of cases) expect(soundKindFor(name, description), `${name}: ${description}`).toBe(kind);
    expect(soundCandidates('gameover', 'sad game over music')[0].family).toBe('gameover');
    expect(soundCandidates('win', 'a short happy victory tune')[0].kind).toBe('jingle');
    const water = soundCandidates('bgm', 'calm underwater music');
    expect(water.every((s) => s.kind === 'music')).toBe(true);
    expect(water.slice(0, 3).every((s) => s.family === 'underwater')).toBe(true);
    // Words the library has never heard of still get one candidate.
    expect(soundCandidates('xqzv', 'wkfj')).toHaveLength(1);
  });

  it('has a strict schema: every property required, nothing extra, or-nothing spelled as anyOf null', () => {
    const check = (schema: Record<string, unknown>): void => {
      if (Array.isArray(schema.anyOf)) return void (schema.anyOf as Record<string, unknown>[]).forEach(check);
      if (schema.type === 'object') {
        const props = Object.keys(schema.properties as object);
        expect(schema.additionalProperties).toBe(false);
        expect([...(schema.required as string[])].sort()).toEqual(props.sort());
        for (const p of Object.values(schema.properties as object)) check(p as Record<string, unknown>);
      }
      if (schema.type === 'array') check(schema.items as Record<string, unknown>);
      if (schema.enum) expect((schema.enum as unknown[]).length).toBeGreaterThan(1);
    };
    const schema = SOUND_SCHEMA as unknown as Record<string, unknown>;
    expect(schema.type).toBe('object');
    check(schema);
    const props = schema.properties as Record<string, { enum?: string[]; anyOf?: Array<{ type: string; properties?: Record<string, { enum?: string[] }> }> }>;
    expect(props.use.enum).toEqual(['library', 'effect', 'music']);
    expect(props.effect.anyOf!.map((s) => s.type)).toEqual(['null', 'object']);
    expect(props.music.anyOf![1].properties!.style.enum).toEqual(MUSIC_STYLES.map((s) => s.id));
    // The custom effect in these tests is what the schema describes.
    const layerProps = Object.keys(((props.effect.anyOf![1].properties as unknown as { layers: { items: { properties: object } } }).layers.items.properties));
    expect(Object.keys(layer({})).sort()).toEqual(layerProps.sort());
  });

  it('writes a prompt that fits the request', () => {
    const lines = soundCandidates('coin', 'a coin').map(candidateLine);
    const p = soundPrompt({ name: 'coin', description: 'a coin', gameTitle: '', music: false, candidates: lines, styles: styleLines() });
    expect(p.user).toContain('The game asks for the sound "coin": a coin');
    expect(p.user).toContain(`1. ${lines[0]}`);
    expect(soundPrompt({ name: 'x', description: 'y', music: true, candidates: [], styles: styleLines() }).user).toContain('(nothing close)');
    expect(styleLines()).toHaveLength(MUSIC_STYLES.length);
    expect(p.system.length).toBeLessThan(6000);
  });

  it('clamps whatever a model writes into something safe to play', () => {
    const wild = { ...layer({}), source: 'laser-cannon', start: -5, duration: 9999, freq: -40, freqEnd: 1e9, attack: -1, decay: NaN, sustain: 7, release: 1e6, volume: 55, vibratoRate: 1e6, vibratoDepth: 1e6, tremoloRate: -3, tremoloDepth: 9, detune: 1e6, pulseWidth: 7, fmRatio: -2, fmAmount: 1e6, filter: 'wah', cutoff: -1, cutoffEnd: 1e9, resonance: 50, notes: [1e9, -1e9, NaN, 'x'], noteStep: -4 } as unknown as CustomLayer;
    const recipe = customEffectRecipe({ layers: [wild, null as unknown as CustomLayer, layer({ source: 'kick' }), layer({ source: 'pluck', filter: 'lowpass', cutoff: 2000, cutoffEnd: 300, resonance: 0.5 })], reverb: 99, echo: 99, echoTime: 99, chorus: 99, drive: 99, crush: 99 });
    expect(recipe).not.toBeNull();
    const out = renderRecipe(recipe!);
    expect(finite(out.samples)).toBe(true);
    expect(peak(out.samples)).toBeLessThanOrEqual(PEAK + 1e-6);
    expect(out.samples.length / out.sampleRate).toBeLessThanOrEqual(20.01);
    // At most sixteen layers are read.
    expect(customEffectRecipe({ layers: Array.from({ length: 200 }, () => layer({})) })!.layers).toHaveLength(16);
    expect(customEffectRecipe(null)).toBeNull();
    expect(customEffectRecipe({ layers: 'none' as unknown as CustomLayer[] })).toBeNull();
    // Every ready-made source plays.
    for (const source of ['sine', 'triangle', 'saw', 'square', 'noise', 'rumble', 'pluck', 'bell', 'kick', 'snare', 'hat', 'clap', 'tom', 'cymbal'] as const) {
      const made = renderSoundReply({ use: 'effect', libraryId: '', effect: { ...customEffect.effect!, layers: [layer({ source, freq: source === 'kick' ? 55 : 440 })] }, music: null });
      expect(made, source).not.toBeNull();
      expect(peak(decodeWav(made!.dataUrl).samples), source).toBeGreaterThan(0.3);
    }
    expect(customMusicParams({ style: 'rock', tempo: 9999, key: 'H', mood: 'grumpy', energy: 9, seed: -3.7, chords: ['I', '', 7 as unknown as string], melody: [1, 99, NaN] })).toEqual({ style: 'rock', seed: 4, tempo: 200, energy: 1, chords: ['I'], melody: [1, 22] });
    expect(customMusicParams({ style: 'nope' })).toBeNull();
    expect(renderSoundReply(null)).toBeNull();
    expect(renderSoundReply({ libraryId: 'coin-classic-m' })?.from).toBe('library');
  });
});
