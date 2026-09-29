/**
 * Sound for games with no sound files: synth sound effects (`this.sfx('coin')`, and a model's
 * `this.sound.play('coin')` too) and a tiny procedural music sequencer (`this.music.play('boss')`).
 * Everything goes through Phaser's master volume, so the editor's mute and volume apply.
 */
import Phaser from 'phaser';
import type { SynthSegment } from '../../audio/synth';
import { env } from './env';
import { MUSIC, MUSIC_STYLES, SOUND_CAPTIONS, SOUND_NAMES, SOUNDS, parseRecipe, type MusicStyle, type MusicStyleDef, type SoundName } from './sounds';
import { guessSound } from '../../play/kit/synonyms';
import { hash, seeded } from './util';

export interface SfxOptions {
  volume?: number;
  pitch?: number;
  vary?: number;
  gap?: number;
}

/** Sound recipes a game declared in `static sounds` (name -> segments, caption). */
const gameSounds = new Map<string, { segments: SynthSegment[]; caption: string }>();

export function setGameSounds(declared: unknown): void {
  gameSounds.clear();
  if (typeof declared !== 'object' || declared === null) return;
  for (const [name, v] of Object.entries(declared as Record<string, unknown>)) {
    const segments = parseRecipe(v);
    if (!segments) continue;
    const caption = typeof v === 'object' && v !== null && typeof (v as { caption?: unknown }).caption === 'string' ? String((v as { caption: string }).caption).slice(0, 60) : `[${name}]`;
    gameSounds.set(name, { segments, caption });
  }
}

function known(name: string): name is SoundName {
  return (SOUND_NAMES as readonly string[]).includes(name);
}

/** The recipe for a name: the game's own, a kit sound, or the closest kit sound. */
function recipeFor(name: string): { key: string; segments: SynthSegment[]; caption: string } {
  const own = gameSounds.get(name);
  if (own) return { key: `game:${name}`, ...own };
  const kit = known(name) ? name : (guessSound(name, SOUND_NAMES) as SoundName);
  return { key: kit, segments: SOUNDS[kit] ?? SOUNDS.pop, caption: SOUND_CAPTIONS[kit] ?? `[${name}]` };
}

/** Where kit audio goes: Phaser's master volume node when there is one. */
function output(game: Phaser.Game): AudioNode | null {
  const ctx = env().audio.ctx;
  if (!ctx) return null;
  const sm = game.sound;
  if (sm instanceof Phaser.Sound.WebAudioSoundManager) return sm.masterVolumeNode;
  return ctx.destination;
}

const lastPlayed = new Map<string, number>();
const lastCaption = new Map<string, number>();
let voices = 0;

/** Captions are wanted: the player turned them on (never in a robot test, which nobody watches). */
function captionsWanted(): boolean {
  const e = env();
  return e.prefs.captions && e.mode !== 'robot';
}

/** The words for one of the student's own sounds: what they wrote in the Sounds sheet, else its name. */
function ownCaption(name: string): string {
  return env().soundCaptions.get(name) ?? `[${name}]`;
}

/**
 * Posts a sound's caption, at most once every 1.2 s per sound. It goes out even when the game is muted or
 * its sound is still locked: captions are for players who can't hear it.
 */
function caption(key: string, words: string, now: number): void {
  if (!words || !captionsWanted() || now - (lastCaption.get(key) ?? -1e9) <= 1200) return;
  lastCaption.set(key, now);
  env().post({ type: 'event', event: { kind: 'caption', text: words } });
}

/** Plays a sound effect (rate-limited per name, at most 12 at once, with a little random pitch). */
export function playSfx(game: Phaser.Game, name: string | SynthSegment[], o: SfxOptions = {}): void {
  const e = env();
  const ctx = e.audio.ctx;
  const out = output(game);
  const audible = !!ctx && !!out && !e.prefs.muted;
  if (!audible && !captionsWanted()) return;
  const recorded = typeof name === 'string' ? e.sounds.get(name) : undefined;
  const recipe = recorded
    ? { key: `rec:${String(name)}`, segments: [], caption: ownCaption(String(name)) }
    : Array.isArray(name)
      ? { key: `custom:${hash(JSON.stringify(name))}`, segments: parseRecipe(name) ?? SOUNDS.pop, caption: '' }
      : recipeFor(String(name));
  const now = e.now();
  caption(recipe.key, typeof name === 'string' && e.soundCaptions.has(name) ? ownCaption(name) : recipe.caption, now);
  if (!audible || !ctx || !out) return;
  if (now - (lastPlayed.get(recipe.key) ?? -1e9) < (o.gap ?? 45) || voices >= 12) return;
  lastPlayed.set(recipe.key, now);
  if (ctx.state !== 'running') return;
  const buffer = recorded ?? e.audio.synth(recipe.key, recipe.segments);
  if (!buffer) return;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = Math.max(0.1, (o.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * (o.vary ?? 0.06)));
  const g = ctx.createGain();
  g.gain.value = Math.max(0, Math.min(2, o.volume ?? 0.8));
  src.connect(g).connect(out);
  voices++;
  src.onended = () => {
    voices--;
    g.disconnect();
  };
  src.start();
}

/**
 * Makes `this.sound.play('coin')` and `this.sound.add('laser')` work without sound files: an unknown key
 * becomes the closest synth sound, rendered into Phaser's audio cache on first use.
 */
export function patchSoundManager(game: Phaser.Game): void {
  const sm = game.sound;
  sm.pauseOnBlur = false;
  // `this.sound.play('coin')` shows its caption too (a sound kept in Phaser's cache has none of its own).
  const realPlay = sm.play.bind(sm);
  sm.play = ((key: string, extra?: Phaser.Types.Sound.SoundConfig | Phaser.Types.Sound.SoundMarker) => {
    if (typeof key === 'string' && captionsWanted()) {
      const own = env().soundCaptions.has(key) || env().sounds.has(key);
      const words = own ? ownCaption(key) : recipeFor(key).caption;
      caption(`play:${key}`, words, env().now());
    }
    return realPlay(key, extra);
  }) as typeof sm.play;
  const cache = game.cache.audio;
  const realAdd = sm.add.bind(sm);
  sm.add = ((key: string, config?: Phaser.Types.Sound.SoundConfig) => {
    if (typeof key === 'string' && !cache.exists(key)) {
      const recorded = env().sounds.get(key);
      const r = recipeFor(key);
      const buf = recorded ?? env().audio.synth(r.key, r.segments);
      if (buf) cache.add(key, buf);
    }
    return realAdd(key, config);
  }) as typeof sm.add;
}

/** Music styles and how loud each layer is at each intensity. */
export class Music {
  private on = false;
  private level: 0 | 1 | 2 = 1;
  private style: MusicStyleDef = MUSIC.adventure;
  private step = 0;
  private next = 0;
  private melody: number[] = [];
  private hooked = false;

  constructor(private readonly scene: Phaser.Scene) {}

  /** Starts a looping tune: 'boss' | 'adventure' | 'chase' | 'chill' | 'spooky' | 'chaos'. */
  play(style: string = 'adventure', o: { bpm?: number; root?: number } = {}): this {
    const name: MusicStyle = (MUSIC_STYLES as readonly string[]).includes(style) ? (style as MusicStyle) : 'adventure';
    // Game code picks these, so keep them musical: the scheduler below runs inside the game's frame, where a
    // zero or endless tempo never moves on (a frozen game) and a negative one throws.
    const bpm = typeof o.bpm === 'number' && Number.isFinite(o.bpm) && o.bpm > 0 ? Math.min(320, Math.max(30, o.bpm)) : 0;
    const root = typeof o.root === 'number' && Number.isFinite(o.root) && o.root > 0 ? Math.min(96, Math.max(12, o.root)) : 0;
    this.style = { ...MUSIC[name], ...(bpm ? { bpm } : {}), ...(root ? { root } : {}) };
    this.on = true;
    this.step = 0;
    this.next = 0;
    const r = seeded(hash(name));
    this.melody = Array.from({ length: 64 }, () => (r() < 0.55 ? Math.floor(r() * 7) : -1));
    if (!this.hooked) {
      this.hooked = true;
      const tick = () => this.tick();
      this.scene.game.events.on(Phaser.Core.Events.STEP, tick);
      this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        this.scene.game.events.off(Phaser.Core.Events.STEP, tick);
        this.stop();
      });
    }
    return this;
  }

  /** 0: bass and hats; 1: + drums and arpeggio; 2: + lead melody. */
  intensity(level: number): this {
    this.level = level >= 2 ? 2 : level <= 0 ? 0 : 1;
    return this;
  }

  stop(): void {
    this.on = false;
  }

  private note(ctx: AudioContext, out: AudioNode, midi: number, t: number, dur: number, wave: OscillatorType, vol: number): void {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = wave;
    o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private drum(ctx: AudioContext, out: AudioNode, kind: 'kick' | 'snare' | 'hat', t: number, vol: number): void {
    if (kind === 'kick') {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.2);
      return;
    }
    const buf = env().audio.synth(kind === 'snare' ? 'hit' : 'dash', kind === 'snare' ? SOUNDS.hit : SOUNDS.dash);
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.playbackRate.value = kind === 'snare' ? 1 : 2.5;
    src.connect(g).connect(out);
    src.start(t);
    src.stop(t + (kind === 'snare' ? 0.12 : 0.03));
  }

  private tick(): void {
    const e = env();
    const ctx = e.audio.ctx;
    const out = output(this.scene.game);
    if (!this.on || !ctx || !out || ctx.state !== 'running' || e.prefs.muted || e.mode === 'robot') return;
    const st = this.style;
    const spb = 60 / st.bpm / 4;
    if (this.next < ctx.currentTime) this.next = ctx.currentTime + 0.05;
    while (this.next < ctx.currentTime + 0.2) {
      const s = this.step;
      const t = this.next;
      const deg = st.prog[Math.floor(s / 16) % st.prog.length];
      const sc = st.scale;
      const tone = (d: number) => st.root + sc[((d % sc.length) + sc.length) % sc.length] + 12 * Math.floor(d / sc.length);
      if (s % 2 === 0) this.note(ctx, out, tone(deg) - 12, t, spb * 1.8, 'triangle', 0.16);
      if (this.level >= 1 && s % 4 === 0) this.drum(ctx, out, 'kick', t, 0.5);
      if (this.level >= 1 && s % 8 === 4) this.drum(ctx, out, 'snare', t, 0.25);
      if (s % 2 === 1 || this.level >= 2) this.drum(ctx, out, 'hat', t, 0.06);
      if (this.level >= 1) this.note(ctx, out, tone(deg + [0, 2, 4, 7][s % 4]) + 12, t, spb * 0.9, st.wave, 0.035);
      if (this.level >= 2) {
        const m = this.melody[s % 64];
        if (m >= 0) this.note(ctx, out, tone(deg + m) + 24, t, spb * 1.6, 'square', 0.04);
      }
      this.step++;
      this.next += spb;
    }
  }
}
