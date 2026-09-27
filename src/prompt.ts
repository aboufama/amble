import { useStore, type PromptRequest } from './store';

export interface PromptAnswer {
  value: string;
  /** "For all sprites" (global) or "For this sprite only" (local). */
  scope: 'global' | 'local';
}

let pending: ((answer: PromptAnswer | null) => void) | null = null;

/** Shows a Scratch-style question dialog and resolves with the answer (null if cancelled). */
export function askUser(request: PromptRequest): Promise<PromptAnswer | null> {
  pending?.(null);
  useStore.getState().setPrompt(request);
  return new Promise((resolve) => {
    pending = resolve;
  });
}

/** Closes the dialog with an answer (or null for Cancel). */
export function answerPrompt(answer: PromptAnswer | null): void {
  const resolve = pending;
  pending = null;
  useStore.getState().setPrompt(null);
  resolve?.(answer);
}

/** Asks a yes/no question in Amble's dialog (never the browser's): true if confirmed. */
export async function confirmUser(options: { title: string; message: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  const answer = await askUser({ kind: 'confirm', title: options.title, label: options.message, confirmLabel: options.confirmLabel, danger: options.danger });
  return answer !== null;
}

/** Shows a message in Amble's dialog (never the browser's). */
export async function alertUser(options: { title: string; message: string }): Promise<void> {
  await askUser({ kind: 'alert', title: options.title, label: options.message });
}

/** "Delete Sprite": asks before deleting a sprite, costume, backdrop or sound. */
export function confirmDelete(what: 'sprite' | 'costume' | 'backdrop' | 'sound', name: string): Promise<boolean> {
  const What = what[0].toUpperCase() + what.slice(1);
  return confirmUser({
    title: `Delete ${What}`,
    message: `Delete the ${what} "${name}"? You can bring it back with Edit > Restore ${What}.`,
    confirmLabel: 'Delete',
    danger: true,
  });
}
