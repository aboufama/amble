import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, parseFromPlayer, parsePrefs, parseToPlayer, transferablesOf, type ToPlayer } from '../../src/play/protocol';

const stats = {
  fps: 58.4, frameMs: 17, frames: 900, objects: 120, particles: 40, arcadeBodies: 30, matterBodies: 0, shots: 12, tweens: 4,
  drawCalls: 6, textureMB: 3.2, heapMB: 14, quality: 1, timeScale: 1, state: 'running', audio: 'running', errors: 0,
};

describe('parseFromPlayer', () => {
  it('rejects non-objects and unknown types', () => {
    expect(parseFromPlayer(null)).toBeNull();
    expect(parseFromPlayer('hello')).toBeNull();
    expect(parseFromPlayer([1, 2])).toBeNull();
    expect(parseFromPlayer({ type: 'rm -rf' })).toBeNull();
    expect(parseFromPlayer({})).toBeNull();
  });

  it('rebuilds clean objects without extra fields', () => {
    const msg = parseFromPlayer({ type: 'hello', protocol: 2, phaser: '3.90', evil: '<script>' });
    expect(msg).toEqual({ type: 'hello', protocol: 2, phaser: '3.90' });
  });

  it('caps strings and drops non-finite numbers', () => {
    const msg = parseFromPlayer({ type: 'log', level: 'warn', message: 'x'.repeat(5000) });
    expect(msg?.type === 'log' && msg.message.length).toBe(500);
    expect(parseFromPlayer({ type: 'hello', protocol: Number.NaN })).toBeNull();
    expect(parseFromPlayer({ type: 'log', level: 'shout', message: 'hi' })).toBeNull();
  });

  it('validates errors with the student file and line', () => {
    const msg = parseFromPlayer({ type: 'error', error: { phase: 'update', message: 'boom', file: 'game.js', line: 12.2, column: 5, count: 3 } });
    expect(msg).toEqual({ type: 'error', error: { phase: 'update', message: 'boom', file: 'game.js', line: 12, column: 5, count: 3, fatal: true } });
    const twist = parseFromPlayer({ type: 'error', error: { phase: 'callback', message: 'x', fatal: false, twist: 'moonGravity' } });
    expect(twist).toEqual({ type: 'error', error: { phase: 'callback', message: 'x', count: 1, fatal: false, twist: 'moonGravity' } });
    expect(parseFromPlayer({ type: 'error', error: { phase: 'nope', message: 'boom' } })).toBeNull();
    expect(parseFromPlayer({ type: 'error', error: { phase: 'create', message: 'x', line: -4 } })).toEqual({
      type: 'error',
      error: { phase: 'create', message: 'x', count: 1, fatal: true },
    });
  });

  it('validates game events', () => {
    expect(parseFromPlayer({ type: 'event', event: { kind: 'score', value: 250 } })).toEqual({ type: 'event', event: { kind: 'score', value: 250 } });
    expect(parseFromPlayer({ type: 'event', event: { kind: 'win', text: 'YOU WIN', score: 9 } })).toEqual({
      type: 'event',
      event: { kind: 'win', text: 'YOU WIN', score: 9 },
    });
    expect(parseFromPlayer({ type: 'event', event: { kind: 'score', value: 'lots' } })).toBeNull();
    expect(parseFromPlayer({ type: 'event', event: { kind: 'dance' } })).toBeNull();
  });

  it('validates the manifest (art needs, dials, twists)', () => {
    const msg = parseFromPlayer({
      type: 'manifest',
      manifest: {
        title: 'MOON KING',
        physics: 'arcade',
        kit: true,
        art: [
          { key: 'hero', name: 'Hero', kind: 'character', rig: 'biped', role: 'hero', shape: 'box', w: 38, h: 64, color: '#7cc4ff', ask: 'Draw your hero', priority: 1 },
          { key: 'bad', kind: 'spaceship', rig: 'biped', role: 'hero', shape: 'box', w: 1, h: 1 },
        ],
        dials: [
          { key: 'jump', label: 'Jump power', value: 720, min: 400, max: 1100, step: 10, current: 800 },
          { key: 'broken', value: 1, min: 5, max: 2, current: 1 },
        ],
        twists: [{ id: 'moonGravity', name: 'Moon gravity', available: true, on: false }],
        controls: ['jump', 'fire', 'teleport'],
      },
    });
    expect(msg?.type).toBe('manifest');
    if (msg?.type !== 'manifest') return;
    expect(msg.manifest.art.map((a) => a.key)).toEqual(['hero']);
    expect(msg.manifest.art[0].pronoun).toBe('it');
    expect(msg.manifest.dials.map((d) => d.key)).toEqual(['jump']);
    expect(msg.manifest.dials[0].live).toBe(true);
    expect(msg.manifest.controls).toEqual(['jump', 'fire']);
  });

  it('validates stats and the robot result', () => {
    expect(parseFromPlayer({ type: 'stats', stats })).toEqual({ type: 'stats', stats: { ...stats, quality: 1 } });
    const raw = {
      gameMs: 5000, frames: 300, wallMs: 1800, speed: 2.7, errors: [], warnings: ['w'], events: [{ kind: 'start' }], artMissing: ['boss'], state: 'running',
      hero: { found: true, controlled: true, moved: 420, alive: true }, movers: 12, frameDiff: 0.4, lumaVariance: 900, start: stats, end: stats,
      peakObjects: 130, peakMatterBodies: 0,
    };
    const msg = parseFromPlayer({ type: 'robotResult', raw });
    expect(msg?.type === 'robotResult' && msg.raw.hero.moved).toBe(420);
    expect(msg?.type === 'robotResult' && msg.raw.speed).toBe(2.7);
    expect(parseFromPlayer({ type: 'robotResult', raw: { ...raw, start: null } })).toBeNull();
  });

  it('keeps only string values in storage', () => {
    expect(parseFromPlayer({ type: 'storage', data: { best: '42', bad: 7, nested: { a: 1 } } })).toEqual({ type: 'storage', data: { best: '42' } });
  });
});

describe('parseToPlayer', () => {
  it('validates init and fills defaults', () => {
    const msg = parseToPlayer({ type: 'init', files: [{ name: 'game.js', source: 'class Game {}' }, { name: 3 }], dials: { jump: 800, bad: 'x' } });
    expect(msg?.type).toBe('init');
    if (msg?.type !== 'init') return;
    expect(msg.files).toEqual([{ name: 'game.js', source: 'class Game {}' }]);
    expect(msg.mode).toBe('play');
    expect(msg.dials).toEqual({ jump: 800 });
    expect(msg.prefs).toEqual(DEFAULT_PREFS);
    expect(msg.robot).toBeUndefined();
  });

  it('only runs robot mode with robot options, clamped', () => {
    const msg = parseToPlayer({ type: 'init', mode: 'robot', files: [], robot: { gameMs: 999999, seed: 7.4 } });
    expect(msg?.type === 'init' && msg.mode).toBe('robot');
    expect(msg?.type === 'init' && msg.robot).toEqual({ gameMs: 60000, seed: 7, bot: 'auto' });
    const noRobot = parseToPlayer({ type: 'init', mode: 'robot', files: [] });
    expect(noRobot?.type === 'init' && noRobot.mode).toBe('play');
  });

  it('accepts drawings as blobs or data URLs, never other URLs', () => {
    const blob = new Blob(['png'], { type: 'image/png' });
    expect(parseToPlayer({ type: 'art', art: { key: 'hero', image: blob, rig: { v: 1 } } })).toEqual({ type: 'art', art: { key: 'hero', image: blob, rig: { v: 1 } } });
    expect(parseToPlayer({ type: 'art', art: { key: 'hero', image: 'data:image/png;base64,AAAA' } })?.type).toBe('art');
    expect(parseToPlayer({ type: 'art', art: { key: 'hero', image: 'https://evil.example/x.png' } })).toBeNull();
  });

  it("carries a drawing's bake with its bones, and nothing else as one", () => {
    const blob = new Blob(['png'], { type: 'image/png' });
    const bake = new ArrayBuffer(64);
    expect(parseToPlayer({ type: 'art', art: { key: 'hero', image: blob, rig: { v: 1 }, bake } })).toEqual({ type: 'art', art: { key: 'hero', image: blob, rig: { v: 1 }, bake } });
    const init = parseToPlayer({ type: 'init', files: [], art: [{ key: 'hero', image: blob, rig: { v: 1 }, bake }] });
    expect(init?.type === 'init' && init.art[0].bake).toBe(bake);
    // no bones, no bake; a bake must be a buffer, and not a huge one
    expect(parseToPlayer({ type: 'art', art: { key: 'hero', image: blob, bake } })).toEqual({ type: 'art', art: { key: 'hero', image: blob } });
    expect(parseToPlayer({ type: 'art', art: { key: 'hero', image: blob, rig: { v: 1 }, bake: 'x' } })).toEqual({ type: 'art', art: { key: 'hero', image: blob, rig: { v: 1 } } });
    expect(parseToPlayer({ type: 'art', art: { key: 'hero', image: blob, rig: { v: 1 }, bake: new Uint8Array(8) } })).toEqual({ type: 'art', art: { key: 'hero', image: blob, rig: { v: 1 } } });
    expect(parseToPlayer({ type: 'art', art: { key: 'hero', image: blob, rig: { v: 1 }, bake: new ArrayBuffer(33 * 1024 * 1024) } })).toEqual({ type: 'art', art: { key: 'hero', image: blob, rig: { v: 1 } } });
  });

  it('validates small messages', () => {
    expect(parseToPlayer({ type: 'dial', key: 'jump', value: 900 })).toEqual({ type: 'dial', key: 'jump', value: 900 });
    expect(parseToPlayer({ type: 'dial', key: 'jump', value: Infinity })).toBeNull();
    expect(parseToPlayer({ type: 'twist', id: 'moonGravity', on: true })).toEqual({ type: 'twist', id: 'moonGravity', on: true });
    expect(parseToPlayer({ type: 'key', phase: 'down', key: ' ', code: 'Space', keyCode: 32 })).toEqual({ type: 'key', phase: 'down', key: ' ', code: 'Space', keyCode: 32 });
    expect(parseToPlayer({ type: 'pause', extra: 1 })).toEqual({ type: 'pause' });
    expect(parseToPlayer({ type: 'prefs', prefs: { muted: true, volume: 7, quality: 'ultra' } })).toEqual({ type: 'prefs', prefs: { muted: true, volume: 1 } });
  });

  it("validates Change mode's messages (step 5)", () => {
    expect(parseToPlayer({ type: 'mode', mode: 'change' })).toEqual({ type: 'mode', mode: 'change' });
    expect(parseToPlayer({ type: 'mode', mode: 'edit' })).toBeNull();
    expect(parseToPlayer({ type: 'select', id: null })).toEqual({ type: 'select', id: null });
    expect(parseToPlayer({ type: 'select', id: 4.2 })).toEqual({ type: 'select', id: 4 });
    expect(parseToPlayer({ type: 'select', id: 'x' })).toBeNull();
    expect(parseToPlayer({ type: 'celebrate', key: 'hero' })).toEqual({ type: 'celebrate', key: 'hero' });
    expect(parseToPlayer({ type: 'step', frames: 9999 })).toEqual({ type: 'step', frames: 600 });
    expect(parseToPlayer({ type: 'snapshot', maxW: 1e9 })).toEqual({ type: 'snapshot', maxW: 4096 });
  });
});

describe("Change mode's reports (step 5)", () => {
  it('validates world objects and snapshots', () => {
    const item = { id: 3, key: 'hero', label: 'Sir Pip', role: 'hero', group: null, x: 10, y: 20, w: 30, h: 40, drawn: false, count: 1, evil: 1 };
    expect(parseFromPlayer({ type: 'objects', items: [item, { id: 'no' }, { ...item, id: 4, role: 'wizard', key: null }] })).toEqual({
      type: 'objects',
      items: [
        { id: 3, key: 'hero', label: 'Sir Pip', role: 'hero', group: null, x: 10, y: 20, w: 30, h: 40, drawn: false, count: 1 },
        { id: 4, key: null, label: 'Sir Pip', role: 'scenery', group: null, x: 10, y: 20, w: 30, h: 40, drawn: false, count: 1 },
      ],
    });
    const many = Array.from({ length: 100 }, (_, i) => ({ ...item, id: i }));
    const capped = parseFromPlayer({ type: 'objects', items: many });
    expect(capped?.type === 'objects' && capped.items.length).toBe(64);
    const png = new Blob([new Uint8Array(8)], { type: 'image/png' });
    expect(parseFromPlayer({ type: 'snapshot', png })).toEqual({ type: 'snapshot', png });
    expect(parseFromPlayer({ type: 'snapshot', png: new Blob(['<html>'], { type: 'text/html' }) })).toBeNull();
    expect(parseFromPlayer({ type: 'snapshot', png: 'data:image/png;base64,AAAA' })).toBeNull();
  });
});

describe('prefs and transferables', () => {
  it('parses prefs over a base', () => {
    expect(parsePrefs({ speed: 0.1, touch: 'on' })).toEqual({ ...DEFAULT_PREFS, speed: 0.25, touch: 'on' });
    expect(parsePrefs('nonsense')).toEqual(DEFAULT_PREFS);
  });

  it('transfers only the runtime bytes (the editor keeps drawings and sounds for restarts)', () => {
    const a = new ArrayBuffer(8);
    expect(transferablesOf({ type: 'runtime', scripts: [a] })).toEqual([a]);
    const init: ToPlayer = {
      type: 'init', mode: 'play', files: [], art: [], sounds: [{ key: 's', pcm: [new Float32Array(4)], sampleRate: 22050 }], fonts: [{ family: 'F', bytes: new ArrayBuffer(2) }],
      dials: {}, twists: [], storage: {}, prefs: DEFAULT_PREFS, autostart: true,
    };
    expect(transferablesOf(init)).toEqual([]);
  });
});
