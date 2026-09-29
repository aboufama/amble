/**
 * One AudioContext for the game realm, handed to Phaser (`audio.context`), so it survives game restarts
 * and stays unlocked. Three unlock paths, all tested in the probe: `allow="autoplay"` on the iframe, the
 * editor's `unlockAudio` message right after a click there, and any gesture inside the game.
 * Synth sounds (the kit's presets, `static sounds` recipes) are rendered to AudioBuffers on first use.
 */
import { renderSynth, SAMPLE_RATE, type SynthSegment } from '../../audio/synth';
import type { AudioState } from '../../play/protocol';

export class AudioHub {
  readonly ctx: AudioContext | null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private lastState: AudioState = 'none';
  /** Paused games hold the context suspended; gestures do not wake it. */
  private held = false;

  constructor(private readonly onState: (state: AudioState) => void) {
    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioContext();
    } catch {
      ctx = null;
    }
    this.ctx = ctx;
    if (ctx) ctx.onstatechange = () => this.emitState();
    for (const type of ['pointerdown', 'keydown', 'touchend'] as const) {
      window.addEventListener(type, () => this.unlock(), { capture: true });
    }
  }

  get state(): AudioState {
    return this.ctx ? (this.ctx.state as AudioState) : 'none';
  }

  private emitState(): void {
    const s = this.state;
    if (s === this.lastState) return;
    this.lastState = s;
    this.onState(s);
  }

  /** Resumes a suspended context (call from a gesture, or right after one in the editor). */
  unlock(): void {
    if (this.ctx?.state === 'suspended' && !this.held) void this.ctx.resume().catch(() => undefined).then(() => this.emitState());
  }

  hold(on: boolean): void {
    this.held = on;
    if (!this.ctx) return;
    if (on) void this.ctx.suspend().catch(() => undefined);
    else void this.ctx.resume().catch(() => undefined);
  }

  /** Renders a synth recipe once and caches it under `key`. */
  synth(key: string, segments: SynthSegment[]): AudioBuffer | null {
    const known = this.buffers.get(key);
    if (known) return known;
    if (!this.ctx) return null;
    const data = renderSynth({ segments });
    const buf = this.ctx.createBuffer(1, data.length, SAMPLE_RATE);
    buf.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
    this.buffers.set(key, buf);
    return buf;
  }

  /** A student's sound: raw PCM (no decode) or encoded bytes (decodeAudioData, not a fetch). */
  async decode(sound: { pcm: Float32Array[]; sampleRate: number } | { bytes: ArrayBuffer }): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    if ('pcm' in sound) {
      const buf = new AudioBuffer({ length: sound.pcm[0].length, numberOfChannels: sound.pcm.length, sampleRate: sound.sampleRate });
      sound.pcm.forEach((ch, i) => buf.copyToChannel(ch as Float32Array<ArrayBuffer>, i));
      return buf;
    }
    return this.ctx.decodeAudioData(sound.bytes.slice(0));
  }
}
