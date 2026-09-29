/** A game's code files: shared by the validator and the patch applier. */

/** One file of a game: `game.js` (the entry, loaded last) plus helper files, all in one shared scope. */
export interface GameFile {
  path: string;
  content: string;
}

export const ENTRY_FILE = 'game.js';

/**
 * A file name a world can keep (§4.2 `CodeFile.path`): a lowercase letter, then lowercase letters, digits
 * and `-`, at most 24 characters before `.js`. A world's `.amble` file carries only such names, so a game
 * file named any other way would make the saved world impossible to open again.
 */
export function isSafeGamePath(path: string): boolean {
  return /^[a-z][a-z0-9-]{0,23}\.js$/.test(path);
}

/**
 * The name a world keeps for a file a reply names its own way ("bossFight.js", "enemy_waves.js",
 * "levels/one.js" become "boss-fight.js", "enemy-waves.js", "levels-one.js"), or null when nothing is left
 * of it. Game files share one scope and never import each other by name, so renaming one is safe.
 */
export function normalizeGamePath(path: string): string | null {
  // Only style is mended: a name that looks like a way out (.., a backslash, a leading /, two folders) stays refused.
  if (path.length > 64 || /\.\.|\\|^\/|\/.*\//.test(path)) return null;
  const base = path
    .replace(/\.js$/i, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .slice(0, 24)
    .replace(/-+$/, '');
  const name = `${base}.js`;
  return base && isSafeGamePath(name) ? name : null;
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
