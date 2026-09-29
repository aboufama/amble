/**
 * Blob garbage collection (§4.3). Once a day, at idle, 30 s after boot: mark every `BlobRef` reachable
 * from the Trail's index, worlds, drawings, footsteps, drafts and the cache, then delete the blobs no one
 * references that are older than a day (a blob put ahead of its commit is never at risk).
 *
 * Refs are found where the §4.2 types keep them; drafts and the cache are scanned for any string that
 * holds a ref (their JSON is free-form), so a ref is never missed.
 */
import { KEEP } from '../model/limits';
import type { ArtExport, ArtRecord, BlobRef, DeskDraft, SoundPiece, StepSnapshot, World, WorldMeta } from '../model/types';

const REF_IN_TEXT = /sha256:[0-9a-f]{64}/g;

export const GC_DELAY_MS = 30_000;
export const GC_EVERY_MS = 24 * 60 * 60 * 1000;
export const GC_LAST_KEY = 'gc:last';
export const GC_GRACE_MS = KEEP.blobGraceMs;

type Mark = (ref: BlobRef | null | undefined) => void;

export function markExport(e: ArtExport | null | undefined, mark: Mark): void {
  if (!e) return;
  mark(e.flat);
  mark(e.inkMask);
  mark(e.sticker);
  mark(e.thumb);
  for (const p of Object.values(e.parts ?? {})) mark(p.blob);
  mark(e.frames?.atlas);
}

export function markSounds(sounds: Record<string, SoundPiece> | undefined, mark: Mark): void {
  for (const s of Object.values(sounds ?? {})) if (s.source.kind === 'recording') mark(s.source.blob);
}

export function markArt(a: Pick<ArtRecord, 'doc' | 'cels' | 'export'>, mark: Mark): void {
  mark(a.doc);
  for (const c of a.cels ?? []) mark(c);
  markExport(a.export, mark);
}

export function markWorld(w: World, mark: Mark): void {
  markSounds(w.sounds, mark);
}

export function markMeta(m: WorldMeta, mark: Mark): void {
  mark(m.snapshot);
}

export function markStep(s: StepSnapshot, mark: Mark): void {
  for (const a of Object.values(s.art ?? {})) markArt(a, mark);
  markSounds(s.sounds, mark);
}

/** Any ref inside any string of a free-form value (drafts' doc JSON, cache entries). Pixels are skipped. */
export function markDeep(value: unknown, mark: Mark, depth = 0): void {
  if (depth > 12 || value === null || value === undefined) return;
  if (typeof value === 'string') {
    if (value.length >= 71) for (const m of value.matchAll(REF_IN_TEXT)) mark(m[0] as BlobRef);
    return;
  }
  if (typeof value !== 'object') return;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return;
  if (Array.isArray(value)) {
    for (const v of value) markDeep(v, mark, depth + 1);
    return;
  }
  if (value instanceof Map) {
    for (const [k, v] of value) {
      markDeep(k, mark, depth + 1);
      markDeep(v, mark, depth + 1);
    }
    return;
  }
  for (const v of Object.values(value as Record<string, unknown>)) markDeep(v, mark, depth + 1);
}

export function markDraft(d: DeskDraft, mark: Mark): void {
  markDeep(d.doc, mark);
}

/** A mark set with a `mark` function that ignores empty values. */
export function markSet(): { refs: Set<BlobRef>; mark: Mark } {
  const refs = new Set<BlobRef>();
  return { refs, mark: (r) => void (r && refs.add(r)) };
}

/** Whether the daily run is due (never ran, or ran a day ago; a clock set back counts as due). */
export function gcDue(last: number | null, now: number): boolean {
  return last === null || now - last >= GC_EVERY_MS || now < last;
}
