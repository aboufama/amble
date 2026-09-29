/** "This world is in a file now": told to whoever tracks unsaved work (the leave prompt, the nudges). */
import type { WorldId } from '../model/types';

const listeners = new Set<(id: WorldId) => void>();

export function onSavedToFile(fn: (id: WorldId) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitSavedToFile(id: WorldId): void {
  for (const fn of listeners) {
    try {
      fn(id);
    } catch (err) {
      console.error(err);
    }
  }
}
