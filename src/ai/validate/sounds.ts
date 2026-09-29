/**
 * The game's own synth sounds: `static sounds = { zap: [segment, ...] }` (or `{ caption, segments: [...] }`)
 * and literal segment lists passed to `this.sfx([...])`. A segment is
 * `{ wave, startFreq, endFreq (Hz), duration (seconds), startVolume, endVolume (0 to 1) }`.
 *
 * The synth plays whatever numbers it gets, clamped (src/audio/synth.ts), so a plausible guess in the wrong
 * units plays the wrong sound instead of failing: `duration: 150` meant as ms is an 8-second tone (the
 * longest segment the synth makes), `startVolume: 50` meant as percent is full volume, `freq: 440` is
 * ignored for the default pitch. Each problem gets a message the model can act on, and the ones whose
 * meaning is clear are fixed (ms to seconds, percent to 0..1, a field's other names, a wave's other names).
 */
import type { ArrayExpression, Class, Expression, ObjectExpression, Property, SpreadElement } from 'acorn';
import { ancestor } from 'acorn-walk';
import { keyName, memberPath, src } from './ast';
import type { FileContext } from './context';
import { closest } from './manifest';
import { staticFields } from './statics';

export const WAVES = ['sine', 'square', 'triangle', 'sawtooth', 'noise'] as const;
const FIELDS = ['wave', 'startFreq', 'endFreq', 'duration', 'startVolume', 'endVolume'] as const;
type Field = (typeof FIELDS)[number];

/** What sounds look like to the model (for the messages). */
const EXAMPLE = "{ wave: 'square', startFreq: 900, endFreq: 300, duration: 0.12, startVolume: 0.5, endVolume: 0 }";

/** Limits the synth works within; outside them a value is a unit mix-up or a typo. */
export const SOUND_LIMITS = {
  /** Hz a player can hear (and the synth makes). */
  minFreq: 20,
  maxFreq: 20_000,
  /** Seconds: the synth's longest segment, and the most a sound effect segment usually needs. */
  maxDuration: 8,
  longDuration: 2,
  /** A duration at least this big was meant in milliseconds. */
  msDuration: 20,
  maxSegments: 32,
  caption: 60,
} as const;

/** What models call a segment's fields. */
const FIELD_SYNONYMS: Record<string, Field> = {
  type: 'wave', waveform: 'wave', waveType: 'wave', shape: 'wave', osc: 'wave', oscillator: 'wave', kind: 'wave',
  freq: 'startFreq', frequency: 'startFreq', pitch: 'startFreq', hz: 'startFreq', from: 'startFreq', fromFreq: 'startFreq', start: 'startFreq',
  startFrequency: 'startFreq', startPitch: 'startFreq', freqStart: 'startFreq', f0: 'startFreq',
  to: 'endFreq', toFreq: 'endFreq', end: 'endFreq', endFrequency: 'endFreq', endPitch: 'endFreq', freqEnd: 'endFreq', f1: 'endFreq',
  time: 'duration', length: 'duration', len: 'duration', dur: 'duration', seconds: 'duration', secs: 'duration', sec: 'duration',
  volume: 'startVolume', vol: 'startVolume', gain: 'startVolume', amp: 'startVolume', amplitude: 'startVolume', loudness: 'startVolume',
  startVol: 'startVolume', startGain: 'startVolume', v0: 'startVolume', endVol: 'endVolume', endGain: 'endVolume', v1: 'endVolume',
};

/** Field names that say the number is in milliseconds. */
const MS_FIELDS = new Set(['ms', 'durationMs', 'lengthMs', 'timeMs', 'millis', 'milliseconds']);

const WAVE_SYNONYMS: Record<string, (typeof WAVES)[number]> = {
  sin: 'sine', sinus: 'sine', sinewave: 'sine', saw: 'sawtooth', sawtoothwave: 'sawtooth', ramp: 'sawtooth', tri: 'triangle',
  trianglewave: 'triangle', sq: 'square', pulse: 'square', squarewave: 'square', white: 'noise', whitenoise: 'noise', static: 'noise',
  hiss: 'noise', noisewave: 'noise',
};

/** The kit's word for a wave the model named some other way, or null. */
export function waveFor(value: string): (typeof WAVES)[number] | null {
  const low = value.toLowerCase().replace(/[\s_-]+/g, '');
  const exact = WAVES.find((w) => w === low);
  if (exact) return exact;
  if (Object.hasOwn(WAVE_SYNONYMS, low)) return WAVE_SYNONYMS[low];
  return closest(low, WAVES, {}) as (typeof WAVES)[number] | null;
}

function propKey(p: Property): string {
  if (p.key.type === 'Literal' && (typeof p.key.value === 'string' || typeof p.key.value === 'number')) return String(p.key.value);
  return keyName(p.key, p.computed);
}

function numberOf(e: Expression): number | undefined {
  if (e.type === 'Literal' && typeof e.value === 'number') return e.value;
  if (e.type === 'UnaryExpression' && e.operator === '-' && e.argument.type === 'Literal' && typeof e.argument.value === 'number') return -e.argument.value;
  return undefined;
}

/** A tidy number for the code: 0.15, not 0.15000000000000002. */
function tidy(n: number): string {
  return String(Math.round(n * 10_000) / 10_000);
}

function renameKey(ctx: FileContext, p: Property, to: string): void {
  if (p.shorthand) ctx.ms.overwrite(p.start, p.end, `${to}: ${src(ctx.code, p.value)}`);
  else ctx.ms.overwrite(p.key.start, p.key.end, to);
}

function checkSegment(ctx: FileContext, seg: Expression | SpreadElement, where: string): void {
  if (seg.type !== 'ObjectExpression') {
    ctx.add('error', 'sounds-manifest', seg, `\`${where}\` must be a segment object like \`${EXAMPLE}\`.`, { name: where });
    return;
  }
  const props = seg.properties.filter((p): p is Property => p.type === 'Property');
  const present = new Set(props.map(propKey));
  for (const p of props) {
    const key = propKey(p);
    const path = `${where}.${key}`;
    if ((FIELDS as readonly string[]).includes(key)) {
      checkValue(ctx, p, key as Field, path);
      continue;
    }
    if (MS_FIELDS.has(key)) {
      const n = numberOf(p.value as Expression);
      const fixable = n !== undefined && n > 0 && !present.has('duration');
      ctx.add('error', 'sounds-manifest', p, `\`${path}\` is not a segment field: a segment's length is \`duration\`, in seconds${n !== undefined && n > 0 ? ` (${tidy(n / 1000)} for ${n} ms)` : ''}.`, { name: path, fixed: fixable && ctx.fix });
      if (fixable && n !== undefined) ctx.applyFix('sounds-manifest', p, `${path} -> duration: ${tidy(n / 1000)}`, () => ctx.ms.overwrite(p.start, p.end, `duration: ${tidy(n / 1000)}`));
      continue;
    }
    const to = Object.hasOwn(FIELD_SYNONYMS, key) ? FIELD_SYNONYMS[key] : undefined;
    if (to) {
      const free = !present.has(to);
      ctx.add('error', 'sounds-manifest', p, `\`${path}\` is not a segment field, so the synth ignores it; the field is \`${to}\` (fields: ${FIELDS.join(', ')}).`, { name: path, suggestion: to, fixed: free && ctx.fix });
      if (free) {
        present.add(to);
        if (ctx.applyFix('sounds-manifest', p, `${path} -> ${to}`, () => renameKey(ctx, p, to))) checkValue(ctx, p, to, `${where}.${to}`);
      }
      continue;
    }
    ctx.add('warning', 'sounds-manifest', p, `\`${path}\` is not a segment field, so the synth ignores it (fields: ${FIELDS.join(', ')}).`, { name: path });
  }
}

function checkValue(ctx: FileContext, p: Property, field: Field, path: string): void {
  const v = p.value as Expression;
  if (field === 'wave') {
    const value = v.type === 'Literal' && typeof v.value === 'string' ? v.value : undefined;
    if (value !== undefined && (WAVES as readonly string[]).includes(value)) return;
    const near = value === undefined ? null : waveFor(value);
    const shown = value === undefined ? src(ctx.code, v) : `'${value}'`;
    ctx.add('error', 'sounds-manifest', p, `\`${path}\` is ${shown}; use one of ${WAVES.map((w) => `'${w}'`).join(', ')}${near ? ` (did you mean '${near}'?)` : ''}.`, { name: path, suggestion: near ?? undefined, fixed: Boolean(near) && ctx.fix });
    if (near) ctx.applyFix('sounds-manifest', p, `${path}: ${shown} -> '${near}'`, () => ctx.ms.overwrite(v.start, v.end, `'${near}'`));
    return;
  }
  const n = numberOf(v);
  if (n === undefined) {
    const unit = field === 'duration' ? 'seconds' : field.endsWith('Freq') ? 'Hz' : 'from 0 to 1';
    ctx.add('error', 'sounds-manifest', p, `\`${path}\` must be a plain number (${unit}), not \`${src(ctx.code, v)}\`.`, { name: path });
    return;
  }
  const set = (to: number, what: string) => ctx.applyFix('sounds-manifest', p, `${path}: ${n} -> ${tidy(to)} (${what})`, () => ctx.ms.overwrite(v.start, v.end, tidy(to)));
  const L = SOUND_LIMITS;
  if (field === 'duration') {
    if (n >= L.msDuration) {
      ctx.add('error', 'sounds-manifest', p, `\`${path}\` is ${n}: durations are in seconds, so this segment would play for ${L.maxDuration} seconds (the longest the synth makes). Write ${tidy(n / 1000)} for ${n} ms.`, { name: path, fixed: ctx.fix });
      set(n / 1000, 'ms to seconds');
    } else if (n > L.maxDuration) {
      ctx.add('error', 'sounds-manifest', p, `\`${path}\` is ${n}: durations are in seconds (0.05 to ${L.longDuration} for a sound effect; ${tidy(n / 1000)} is ${n} ms), and the synth stops a segment at ${L.maxDuration} seconds.`, { name: path });
    } else if (n <= 0) {
      ctx.add('error', 'sounds-manifest', p, `\`${path}\` is ${n}: a segment needs a length in seconds (0.05 to ${L.longDuration} for a sound effect).`, { name: path });
    } else if (n > L.longDuration) {
      ctx.add('warning', 'sounds-manifest', p, `\`${path}\` is ${n} seconds, long for a sound effect: durations are in seconds (0.15 is 150 ms).`, { name: path });
    }
    return;
  }
  if (field === 'startFreq' || field === 'endFreq') {
    if (n < L.minFreq || n > L.maxFreq) {
      const hint = n > 0 && n < L.minFreq && n * 1000 <= L.maxFreq ? ` (${tidy(n * 1000)} Hz if you meant ${n} kHz)` : '';
      ctx.add('error', 'sounds-manifest', p, `\`${path}\` is ${n}: frequencies are in Hz, ${L.minFreq} to ${L.maxFreq} (A4 is 440)${hint}.`, { name: path });
    }
    return;
  }
  // Volumes.
  if (n > 1 && n <= 100) {
    ctx.add('error', 'sounds-manifest', p, `\`${path}\` is ${n}: volumes go from 0 to 1, so ${n}% is ${tidy(n / 100)}.`, { name: path, fixed: ctx.fix });
    set(n / 100, 'percent to 0..1');
  } else if (n < 0 || n > 1) {
    ctx.add('error', 'sounds-manifest', p, `\`${path}\` is ${n}: volumes go from 0 to 1.`, { name: path });
  }
}

function checkSegments(ctx: FileContext, list: ArrayExpression, where: string): void {
  if (!list.elements.length) {
    ctx.add('error', 'sounds-manifest', list, `\`${where}\` has no segments; give it at least one like \`${EXAMPLE}\`.`, { name: where });
    return;
  }
  if (list.elements.length > SOUND_LIMITS.maxSegments) {
    ctx.add('warning', 'sounds-manifest', list, `\`${where}\` has ${list.elements.length} segments; the synth plays the first ${SOUND_LIMITS.maxSegments}.`, { name: where });
  }
  list.elements.forEach((seg, i) => {
    if (seg) checkSegment(ctx, seg, `${where}[${i}]`);
  });
}

function checkSound(ctx: FileContext, p: Property): void {
  const name = propKey(p);
  const where = `static sounds.${name}`;
  const v = p.value as Expression;
  if (v.type === 'ArrayExpression') {
    checkSegments(ctx, v, where);
    return;
  }
  if (v.type === 'ObjectExpression') {
    const fields = new Map(v.properties.filter((f): f is Property => f.type === 'Property').map((f) => [propKey(f), f]));
    const segments = fields.get('segments');
    if (segments?.value.type === 'ArrayExpression') {
      checkSegments(ctx, segments.value, `${where}.segments`);
      const caption = fields.get('caption');
      const text = caption?.value.type === 'Literal' && typeof caption.value.value === 'string' ? caption.value.value : undefined;
      if (caption && text !== undefined && text.length > SOUND_LIMITS.caption) {
        ctx.add('warning', 'sounds-manifest', caption, `\`${where}.caption\` is longer than ${SOUND_LIMITS.caption} characters; captions show the first ${SOUND_LIMITS.caption}.`, { name: `${where}.caption` });
      }
      return;
    }
    // One segment written without its list: the synth would find no segments and play a default blip.
    if ([...fields.keys()].some((k) => (FIELDS as readonly string[]).includes(k) || Object.hasOwn(FIELD_SYNONYMS, k))) {
      ctx.add('error', 'sounds-manifest', p, `\`${where}\` is one segment; sounds are lists of segments: \`${name}: [${src(ctx.code, v)}]\`.`, { name: where, fixed: ctx.fix });
      if (ctx.applyFix('sounds-manifest', p, `${where}: wrapped the segment in a list`, () => {
        ctx.ms.appendLeft(v.start, '[');
        ctx.ms.appendRight(v.end, ']');
      })) {
        checkSegment(ctx, v, `${where}[0]`);
      }
      return;
    }
    ctx.add('error', 'sounds-manifest', p, `\`${where}\` needs \`segments\`: \`{ caption: '[zap]', segments: [${EXAMPLE}] }\`.`, { name: where });
    return;
  }
  const kit = v.type === 'Literal' && typeof v.value === 'string' ? ` To play a kit sound, call this.sfx('${v.value}') instead.` : '';
  ctx.add('error', 'sounds-manifest', p, `\`${where}\` must be a list of segments like \`[${EXAMPLE}]\`.${kit}`, { name: where });
}

/** `static sounds` of the Game class. */
export function checkSoundsStatic(ctx: FileContext, game: Class): void {
  const field = staticFields(game).get('sounds');
  const obj = field?.value;
  if (!field || !obj || obj.type !== 'ObjectExpression') return;
  for (const p of (obj as ObjectExpression).properties) if (p.type === 'Property') checkSound(ctx, p);
}

/** Segment lists written straight into `this.sfx([...])`. */
export function checkSfxSegments(ctx: FileContext): void {
  ancestor(ctx.ast, {
    CallExpression(n) {
      const first = n.arguments[0];
      if (first?.type !== 'ArrayExpression' || !/(^|\.)sfx$/.test(memberPath(n.callee))) return;
      checkSegments(ctx, first, 'sfx([...])');
    },
  });
}
