export interface PlayOptions {
  /** 0..1 (default 1) */
  volume?: number;
  /** Playback rate multiplier (default 1). 2 = one octave up. */
  pitch?: number;
  loop?: boolean;
}

export interface SoundHandle {
  stop(): void;
  readonly playing: boolean;
}

let sharedContext: AudioContext | null = null;

/** One AudioContext per page; browsers limit how many can exist. */
function audioContext(): AudioContext {
  if (!sharedContext) {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const resume = () => {
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    };
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
    sharedContext = ctx;
  }
  return sharedContext;
}

/** Small Web Audio sound player. Sounds are decoded once per game and shared by every sprite instance. */
export class AudioManager {
  readonly ctx: AudioContext;
  private master: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private active = new Set<AudioBufferSourceNode>();
  private musicHandle: SoundHandle | null = null;

  constructor() {
    this.ctx = audioContext();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
  }

  dispose(): void {
    this.stopAll();
    this.master.disconnect();
  }

  resume(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }

  async load(key: string, url: string): Promise<void> {
    if (this.buffers.has(key)) return;
    try {
      const data = await (await fetch(url)).arrayBuffer();
      const buffer = await this.ctx.decodeAudioData(data);
      this.buffers.set(key, buffer);
    } catch (err) {
      console.warn(`Could not load sound "${key.split('/').pop()}": ${(err as Error).message}`);
    }
  }

  has(key: string): boolean {
    return this.buffers.has(key);
  }

  duration(key: string): number {
    return this.buffers.get(key)?.duration ?? 0;
  }

  play(key: string, opts: PlayOptions = {}): SoundHandle {
    const buffer = this.buffers.get(key);
    if (!buffer) return { stop() {}, playing: false };
    this.resume();
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = Boolean(opts.loop);
    source.playbackRate.value = Math.max(0.05, opts.pitch ?? 1);
    const gain = this.ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(1, opts.volume ?? 1));
    source.connect(gain);
    gain.connect(this.master);
    let playing = true;
    source.onended = () => {
      playing = false;
      this.active.delete(source);
      gain.disconnect();
    };
    this.active.add(source);
    source.start();
    return {
      stop: () => {
        if (!playing) return;
        playing = false;
        try {
          source.stop();
        } catch {
          /* already stopped */
        }
      },
      get playing() {
        return playing;
      },
    };
  }

  music(key: string | null, opts: PlayOptions = {}): void {
    this.musicHandle?.stop();
    this.musicHandle = key ? this.play(key, { volume: 0.6, ...opts, loop: true }) : null;
  }

  stopAll(): void {
    for (const source of this.active) {
      try {
        source.stop();
      } catch {
        /* ignore */
      }
    }
    this.active.clear();
    this.musicHandle = null;
  }

  set volume(v: number) {
    this.master.gain.value = Math.max(0, Math.min(1, v));
  }

  get volume(): number {
    return this.master.gain.value;
  }
}
