/**
 * `step`: while the editor has the game paused, simulate N frames on the game's own clock and draw the
 * last (0 only draws). Every step answers with an `objects` report, so the editor always has fresh boxes
 * after it moves time along (the come-alive flight uses them for its landing spot).
 */
import type { EditorShell } from '../shell/editor';
import { collectObjects } from './objects';

export const MAX_STEP_FRAMES = 600;

export function step(shell: EditorShell, frames: number): void {
  const n = Math.max(0, Math.min(MAX_STEP_FRAMES, Math.round(frames)));
  if (shell.paused()) shell.advance(n);
  const game = shell.game();
  shell.post({ type: 'objects', items: game ? collectObjects(game).map((f) => f.item) : [] });
}
