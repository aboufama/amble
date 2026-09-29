/**
 * The door for the World screen's Change mode (step 5 of the protocol): 'mode', 'select', 'celebrate',
 * 'step' and 'snapshot' messages go to the handler that the runtime's editor module registers
 * (src/runtime/editor/, imported once by the runtime entry). Until one is registered they are ignored.
 * The handler gets the few things only the shell can do safely: stepping a paused game, drawing a frame
 * on demand, posting to the editor, and the world's objects.
 */
import type Phaser from 'phaser';
import type { FromPlayer, ToPlayerAdditions, WorldObject } from '../../play/protocol';

export type EditorMessage = ToPlayerAdditions;

export interface EditorShell {
  /** The running game, or null between games. */
  game(): Phaser.Game | null;
  /** The game's main scene (the kit scene, or a plain game's first active scene). */
  scene(): Phaser.Scene | null;
  /** Sends a message to the editor ('objects', 'snapshot'...). */
  post(msg: FromPlayer): void;
  /** The editor paused the game (Change mode keeps it paused). */
  paused(): boolean;
  pause(): void;
  resume(): void;
  /** While paused: simulate `frames` frames of 1/60 s and draw the last; 0 only draws the current state. */
  advance(frames: number): void;
  /** Draws the current state now, without simulating (also what completes a pending renderer.snapshot). */
  render(): void;
  /** The things in the world, in CSS px of the game frame (at most `max`). */
  objects(max?: number): WorldObject[];
}

export type EditorHandler = (msg: EditorMessage, shell: EditorShell) => void;

let handler: EditorHandler | null = null;

/** Called by the runtime's editor module. A second call replaces the first; null removes it. */
export function registerEditorHandler(h: EditorHandler | null): void {
  handler = h;
}

export function editorHandler(): EditorHandler | null {
  return handler;
}
