/**
 * The Sounds sheet's data (§2.6): which sounds a world's game plays (named in its code, or played by the
 * kit for the moves it uses), how a sound piece renders for a preview, and the preset variations.
 */
import { applyEffect } from '../audio/effects';
import { renderSynth, SAMPLE_RATE, SOUND_PRESETS, type SynthRecipe } from '../audio/synth';
import type { CodeFile, SoundPiece } from '../model/types';

/** Sounds the kit plays by itself for what a game does (its "juice"). */
const IMPLIED: Array<[RegExp, string[]]> = [
  [/\.platformer\(|\bjumps?\s*:/, ['jump']],
  [/\bdash\s*:\s*true|\.dash\(/, ['dash']],
  [/\.shooter\(|\bshoot\(/, ['shoot']],
  [/spawnEnemy\(|\bhp\s*:/, ['hit', 'hurt']],
  [/fx\.explode\(|explosion/, ['explosion']],
  [/\bthis\.win\(/, ['win']],
  [/\bthis\.lose\(/, ['lose']],
  [/\bcollect|coin/i, ['coin']],
];

const NAMED = /\b(?:sfx|sound\.play|playSound)\(\s*['"]([a-zA-Z][\w-]{0,23})['"]/g;

/** The sounds a world's game plays, in a steady order: named ones first, then the kit's. */
export function soundsUsed(code: readonly CodeFile[], overrides: Readonly<Record<string, SoundPiece>> = {}): string[] {
  const out = new Set<string>();
  const text = code.map((f) => f.source).join('\n');
  for (const m of text.matchAll(NAMED)) out.add(m[1]);
  for (const [re, names] of IMPLIED) if (re.test(text)) for (const n of names) out.add(n);
  for (const name of Object.keys(overrides)) out.add(name);
  return [...out].slice(0, 32);
}

/** Preset variations: 0 as made, 1 a little higher, 2 a little lower. */
const VARIATION_PITCH = [1, 1.26, 0.8] as const;

export function presetRecipe(preset: string, variation: 0 | 1 | 2 = 0): SynthRecipe | null {
  const base = SOUND_PRESETS[preset];
  if (!base) return null;
  const k = VARIATION_PITCH[variation] ?? 1;
  if (k === 1) return base;
  return { ...base, segments: base.segments.map((s) => ({ ...s, startFreq: s.startFreq * k, endFreq: s.endFreq * k })) };
}

/** PCM for a piece that renders here (presets and synth recipes, with effects); null for recordings. */
export function renderPiece(piece: SoundPiece): Float32Array | null {
  const src = piece.source;
  const recipe = src.kind === 'synth' ? src.recipe : src.kind === 'preset' ? presetRecipe(src.preset, src.variation) : null;
  if (!recipe) return null;
  let pcm = renderSynth(recipe);
  for (const effect of piece.effects) pcm = applyEffect(pcm, SAMPLE_RATE, effect);
  return pcm;
}

export const PRESET_NAMES = Object.keys(SOUND_PRESETS);
