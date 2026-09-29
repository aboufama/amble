/** A game's code files: shared by the validator and the patch applier. */

/** One file of a game: `game.js` (the entry, loaded last) plus helper files, all in one shared scope. */
export interface GameFile {
  path: string;
  content: string;
}

export const ENTRY_FILE = 'game.js';

/** A file name a reply may create: letters, digits, `-` and `_`, at most one folder, ending in `.js`. */
export function isSafeGamePath(path: string): boolean {
  return path.length <= 64 && /^[A-Za-z0-9][A-Za-z0-9_-]*(\/[A-Za-z0-9][A-Za-z0-9_-]*)?\.js$/.test(path);
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
