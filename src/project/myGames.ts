/**
 * My games: every game made in this browser, each saved on its own as it changes, like files in a
 * cloud app. Opening a game, a demo or a shared game never replaces another: the one in the editor
 * is already saved, and the list keeps them all.
 *
 * In IndexedDB (big data URLs fit there): the list ("amble:games"), each game ("amble:game:<id>"),
 * and each game's picture ("amble:thumb:<id>"). The open game's id is in localStorage.
 */
import { createStore, del, delMany, get, getMany, set, update, type UseStore } from 'idb-keyval';
import { isProject } from './persistence';
import { migrateProject } from './migrate';
import type { Project } from './types';

/** What the list knows about a game, without loading it. */
export interface GameInfo {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

const LIST = 'amble:games';
const gameKey = (id: string) => `amble:game:${id}`;
const thumbKey = (id: string) => `amble:thumb:${id}`;
/** Where Amble used to keep its one game, before there was a list. */
const OLD_SAVE = 'amble:project';
const OPEN = 'amble:open';

let store: UseStore | undefined;
/** Tests use their own store; the page uses idb-keyval's own (where the old save is). */
export function useGameStore(s: UseStore | undefined): void {
  store = s;
}
export { createStore };

export async function listGames(): Promise<GameInfo[]> {
  try {
    const all = (await get<GameInfo[]>(LIST, store)) ?? [];
    return [...all].sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function hasGame(id: string): Promise<boolean> {
  return (await listGames()).some((g) => g.id === id);
}

export async function loadGame(id: string): Promise<Project | null> {
  try {
    const p = await get<Project>(gameKey(id), store);
    return p && isProject(p) ? migrateProject(p) : null;
  } catch {
    return null;
  }
}

/** Saves the game, and puts it in the list if it isn't there yet. */
export async function saveGame(project: Project, now = Date.now()): Promise<void> {
  await set(gameKey(project.id), project, store);
  await update<GameInfo[]>(
    LIST,
    (all = []) => {
      const title = project.title.trim() || 'Untitled game';
      const at = all.findIndex((g) => g.id === project.id);
      if (at < 0) return [...all, { id: project.id, title, createdAt: now, updatedAt: now }];
      const next = [...all];
      next[at] = { ...next[at], title, updatedAt: now };
      return next;
    },
    store,
  );
}

export async function deleteGame(id: string): Promise<void> {
  await update<GameInfo[]>(LIST, (all = []) => all.filter((g) => g.id !== id), store);
  await delMany([gameKey(id), thumbKey(id)], store);
}

export async function saveThumb(id: string, dataUrl: string): Promise<void> {
  try {
    await set(thumbKey(id), dataUrl, store);
  } catch {
    /* the card shows its name instead */
  }
}

/** The pictures of these games (null where there is none yet). */
export async function thumbsOf(ids: string[]): Promise<Record<string, string | null>> {
  try {
    const got = await getMany<string | undefined>(ids.map(thumbKey), store);
    return Object.fromEntries(ids.map((id, i) => [id, got[i] ?? null]));
  } catch {
    return {};
  }
}

export function openGameId(): string | null {
  try {
    return localStorage.getItem(OPEN);
  } catch {
    return null;
  }
}

export function setOpenGameId(id: string): void {
  try {
    localStorage.setItem(OPEN, id);
  } catch {
    /* ignore */
  }
}

/**
 * The game to open when the page loads: the one open last time, else the newest. The one game
 * saved by earlier versions of Amble becomes the first game in the list.
 */
export async function loadStartingGame(): Promise<Project | null> {
  try {
    const old = await get<Project>(OLD_SAVE, store);
    if (old && isProject(old)) {
      const game = migrateProject(old);
      if (!(await hasGame(game.id))) await saveGame(game, Date.now());
      setOpenGameId(game.id);
      await del(OLD_SAVE, store);
    }
  } catch {
    /* nothing to move */
  }
  const open = openGameId();
  const game = open ? await loadGame(open) : null;
  if (game) return game;
  for (const g of await listGames()) {
    const newest = await loadGame(g.id);
    if (newest) {
      setOpenGameId(newest.id);
      return newest;
    }
  }
  return null;
}

/**
 * The game, leaving out how the editor writes blocks back: the places of scripts on the canvas, and
 * numbers in fields as numbers or words. A demo's scripts get places (and its "0" becomes 0) the
 * first time the editor writes them, which isn't a change anyone made.
 */
export function gameLike(project: Project): string {
  return JSON.stringify(project, function (this: Record<string, unknown>, key: string, value: unknown) {
    if ((key === 'x' || key === 'y') && typeof this?.type === 'string' && typeof this?.id === 'string') return undefined;
    if (typeof value === 'number' && /^[A-Z][A-Z0-9_]*$/.test(key)) return String(value);
    return value;
  });
}

/** "just now", "5 minutes ago", "yesterday", "Mar 3". */
export function whenChanged(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(at).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
}

/** Asks the browser to keep the games even when the disk is getting full. */
export function keepGamesSafe(): void {
  void navigator.storage?.persist?.().catch(() => undefined);
}
