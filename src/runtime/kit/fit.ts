/**
 * How a drawing takes the place of its stand-in: it keeps its own shape (aspect ratio) and fills the art's
 * box the way that kind of art should. Hitboxes never change when art arrives. Pure.
 */
import type { ArtKind } from '../../play/protocol';

export type FitMode = 'height' | 'cover' | 'contain';

/** Characters and terrain match the art's height; backgrounds cover the screen; everything else fits inside. */
export function fitModeFor(kind: ArtKind): FitMode {
  if (kind === 'character' || kind === 'terrain') return 'height';
  if (kind === 'background') return 'cover';
  return 'contain';
}

/** The size (game px) a w x h drawing is shown at, for a box of boxW x boxH. */
export function fitSize(mode: FitMode, boxW: number, boxH: number, w: number, h: number): { w: number; h: number; scale: number } {
  if (!(w > 0) || !(h > 0)) return { w: boxW, h: boxH, scale: 1 };
  const s = mode === 'height' ? boxH / h : mode === 'cover' ? Math.max(boxW / w, boxH / h) : Math.min(boxW / w, boxH / h);
  return { w: w * s, h: h * s, scale: s };
}
