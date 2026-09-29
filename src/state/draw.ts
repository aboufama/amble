/**
 * The `draw` slice (M3 owns): which drawing the Desk has open, whether it has unsaved
 * strokes, the tool, and on-the-bones vs freehand.
 */
import type { ArtId } from '../model/types';
import { setState } from './store';

export interface DrawSlice {
  artId: ArtId | null;
  dirty: boolean;
  tool: string;
  mode: 'bones' | 'free' | null;
  /**
   * Set before opening a drawing's Desk to draw one move as a flipbook ("Draw this move yourself?" in
   * Bones): the kit's move name ('attack', 'walk'...). The Desk opens its Flipbook on that move, then clears it.
   */
  flipbookMove: string | null;
}

export function initialDraw(): DrawSlice {
  return { artId: null, dirty: false, tool: 'ink', mode: null, flipbookMove: null };
}

export function setDraw(patch: Partial<DrawSlice>): void {
  setState((s) => {
    Object.assign(s.draw, patch);
  });
}
