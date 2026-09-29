/**
 * The World screen inside the game (step 5 of the protocol): Play and Change mode, the selection
 * outline, the celebration after Bring to life, stepping a paused game and snapshots. Imported once by
 * the runtime entry, which hands these messages to the handler registered here.
 *
 * - `mode: 'change'` pauses the game and streams `objects` 4 times a second; `mode: 'play'` stops the
 *   stream and clears the selection (the editor resumes the game itself).
 * - `select` outlines one object with a lantern glow; `celebrate` cheers the new drawing.
 * - `step` advances a paused game and reports `objects`; `snapshot` answers with a PNG.
 * - In Play mode, 5 s without input sends one `objects` report, and a tap on an undrawn character while
 *   the game runs becomes `artClicked` (play.ts).
 */
import type Phaser from 'phaser';
import { registerEditorHandler, type EditorMessage, type EditorShell } from '../shell/editor';
import { celebrate } from './celebrate';
import { collectObjects } from './objects';
import { PlayWatch } from './play';
import { clearSelection, selectObject, selectedId } from './select';
import { snapshotPng } from './snapshot';
import { step } from './step';

export const OBJECTS_EVERY_MS = 250;
export const MAX_OBJECTS = 64;

let mode: 'play' | 'change' = 'play';
let stream = 0;
let watch: PlayWatch | null = null;

function report(shell: EditorShell): void {
  const game = shell.game();
  if (!game) return;
  shell.post({ type: 'objects', items: collectObjects(game, MAX_OBJECTS).map((f) => f.item) });
}

/**
 * Redraws a paused game so an outline change shows (a running game draws it on its next frame). A new
 * post-FX pipeline draws its first frame empty, so a paused game draws once more on the next frame.
 */
function redraw(shell: EditorShell): void {
  if (!shell.paused()) return;
  shell.render();
  requestAnimationFrame(() => {
    if (shell.paused()) shell.render();
  });
}

function setMode(shell: EditorShell, next: 'play' | 'change'): void {
  mode = next;
  window.clearInterval(stream);
  stream = 0;
  if (next === 'change') {
    shell.pause();
    report(shell);
    stream = window.setInterval(() => {
      // A selected thing that went away loses its outline.
      const game = shell.game();
      const id = selectedId();
      if (game && id !== null && !selectObject(game, id)) redraw(shell);
      report(shell);
    }, OBJECTS_EVERY_MS);
    return;
  }
  clearSelection();
  redraw(shell);
  watch?.reset();
}

function handle(msg: EditorMessage, shell: EditorShell): void {
  watch ??= new PlayWatch(shell, () => mode === 'play');
  const game: Phaser.Game | null = shell.game();
  switch (msg.type) {
    case 'mode':
      setMode(shell, msg.mode);
      break;
    case 'select':
      if (game) selectObject(game, msg.id);
      redraw(shell);
      break;
    case 'celebrate':
      if (game) celebrate(game, msg.key);
      redraw(shell);
      break;
    case 'step':
      step(shell, msg.frames);
      break;
    case 'snapshot':
      if (!game) break;
      void snapshotPng(game, () => shell.render(), msg.maxW).then((png) => {
        if (png) shell.post({ type: 'snapshot', png });
      });
      break;
  }
}

registerEditorHandler(handle);
