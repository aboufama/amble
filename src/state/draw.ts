/**
 * The `draw` slice (M3 owns; FOUNDATION-STUB): which drawing the Desk has open, whether it has unsaved
 * strokes, the tool, and on-the-bones vs freehand.
 */
import type { ArtId } from '../model/types';
import { setState } from './store';

export interface DrawSlice {
  artId: ArtId | null;
  dirty: boolean;
  tool: string;
  mode: 'bones' | 'free' | null;
}

export function initialDraw(): DrawSlice {
  return { artId: null, dirty: false, tool: 'ink', mode: null };
}

export function setDraw(patch: Partial<DrawSlice>): void {
  setState((s) => {
    Object.assign(s.draw, patch);
  });
}
