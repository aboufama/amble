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
