/**
 * Home's two sounds that are not in the shared set (§2.3, §2.4): the soft **boing** of a hop on the
 * First page (triangle 300→500 Hz, 90 ms) and the Trail's three-note **chime** on first load (D5, F#5,
 * A5 at 90 ms). Same rules as `src/ui/sounds.ts`: synthesized, the student's level (off, soft, on), made
 * only after a user gesture, never on hover.
 */
import { SAMPLE_RATE, type SynthSegment } from '../audio/synth';
import { getState } from '../state/store';
import { renderUiSound } from '../ui/sounds';

export type HomeSound = 'boing' | 'chime';

const seg = (wave: SynthSegment['wave'], from: number, to: number, duration: number, vol: number, end = 0): SynthSegment => ({
  wave,
  startFreq: from,
  endFreq: to,
  duration,
  startVolume: vol,
  endVolume: end,
});

export const HOME_SOUNDS: Record<HomeSound, Array<{ at: number; segments: SynthSegment[] }>> = {
  boing: [{ at: 0, segments: [seg('triangle', 300, 500, 0.09, 0.6)] }],
  chime: [
    { at: 0, segments: [seg('sine', 587.33, 587.33, 0.16, 0.45)] },
    { at: 0.09, segments: [seg('sine', 739.99, 739.99, 0.16, 0.45)] },
    { at: 0.18, segments: [seg('sine', 880, 880, 0.2, 0.45)] },
  ],
};

const PEAK = { on: 10 ** (-18 / 20), soft: 10 ** (-26 / 20) } as const;

let ctx: AudioContext | null = null;
let gestured = false;

/** Sticky user activation: the page has had a click, tap or key press (browsers allow sound after it). */
function activated(): boolean {
  const ua = (globalThis.navigator as Navigator & { userActivation?: { hasBeenActive: boolean } } | undefined)?.userActivation;
  return gestured || Boolean(ua?.hasBeenActive);
}
const buffers = new Map<string, AudioBuffer>();
const last = new Map<HomeSound, number>();

/** Call from a pointer or key handler: sounds may start only after the student has done something. */
export function homeSoundsGesture(): void {
  gestured = true;
}

export function playHomeSound(name: HomeSound): void {
  const level = getState().prefs.uiSounds;
  if (level === 'off' || !activated() || typeof AudioContext === 'undefined') return;
  const now = performance.now();
  if (now - (last.get(name) ?? -Infinity) < 60) return;
  last.set(name, now);
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const key = `${name}:${level}`;
    let buffer = buffers.get(key);
    if (!buffer) {
      const samples = renderUiSound(HOME_SOUNDS[name], PEAK[level]);
      buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
      buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
      buffers.set(key, buffer);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start();
  } catch {
    // No sound is never an error.
  }
}
