/**
 * Opening and switching games, and saving the open one as it changes. Nothing is ever replaced:
 * before another game opens, the one in the editor is saved (and its stage pictured for its card
 * in My games). A game joins My games when it is made (an idea, a file) or first changed: a demo
 * or a shared game opened only to play doesn't.
 */
import { useStore } from './store';
import { flushBlocks, getPlayer, startGame } from './actions';
import { uid } from './project/ids';
import { blankProject } from './project/examples';
import { deleteGame, gameLike, hasGame, keepGamesSafe, listGames, loadGame, saveGame, saveThumb, setOpenGameId } from './project/myGames';
import type { Project } from './project/types';

/** Has something written to the open game since it was last saved? */
let dirty = false;
/** The open game as it was opened or last saved: only a game that differs from it is saved. */
let savedAs: string | null = null;
let savedLike: string | null = null;
let timer: number | null = null;
/** The save under way, so a switch waits for it. */
let saving: Promise<void> = Promise.resolve();

const clearTimer = () => {
  if (timer !== null) window.clearTimeout(timer);
  timer = null;
};

const remember = (project: Project) => {
  savedAs = JSON.stringify(project);
  savedLike = gameLike(project);
};

/**
 * Saves the open game if it changed (blocks on screen included). A game that isn't in My games yet
 * (a demo or a shared game being looked at) joins only for a change of its own: the editor writing
 * its blocks back the way it writes them doesn't count.
 */
export function saveNow(): Promise<void> {
  flushBlocks();
  clearTimer();
  if (dirty) {
    dirty = false;
    const project = useStore.getState().project;
    saving = saving.then(async () => {
      try {
        if (JSON.stringify(project) === savedAs) return;
        if (gameLike(project) === savedLike && !(await hasGame(project.id))) return;
        remember(project);
        await saveGame(project);
      } catch (err) {
        console.warn('Saving the game failed', err);
        dirty = true;
        savedAs = savedLike = null;
      }
    });
  }
  return saving;
}

/** Saves the open game a moment after each change, and when the page goes away. */
export function startAutosave(): () => void {
  keepGamesSafe();
  remember(useStore.getState().project);
  const unsubscribe = useStore.subscribe((state, prev) => {
    // A game was opened: nothing changed in it yet.
    if (state.projectLoads !== prev.projectLoads) {
      dirty = false;
      clearTimer();
      remember(state.project);
      return;
    }
    if (state.project === prev.project) return;
    dirty = true;
    clearTimer();
    timer = window.setTimeout(() => void saveNow(), 800);
  });
  const away = () => void saveNow();
  const hidden = () => document.visibilityState === 'hidden' && away();
  window.addEventListener('beforeunload', away);
  document.addEventListener('visibilitychange', hidden);
  return () => {
    unsubscribe();
    window.removeEventListener('beforeunload', away);
    document.removeEventListener('visibilitychange', hidden);
  };
}

/** Pictures the stage for the open game's card in My games, if it is one of them. Resolves when stored. */
export async function pictureOpenGame(): Promise<void> {
  const id = useStore.getState().project.id;
  const url = await getPlayer()?.snapshot();
  if (url && (await hasGame(id))) await saveThumb(id, url);
}

export interface OpenOptions {
  /** Put it in My games now (a game made from an idea, a file). Otherwise it joins when first changed. */
  keep?: boolean;
  /** Press the flag once it is open. */
  play?: boolean;
  /** Give it an id of its own (default): a demo, a shared game or a file opened twice is two games, never one over the other. */
  fresh?: boolean;
}

/** Opens a game in the editor. The game there now is saved first: nothing is replaced. */
export async function openGame(project: Project, opts: OpenOptions = {}): Promise<Project> {
  const s = useStore.getState();
  if (s.project.id !== project.id || opts.fresh !== false) {
    await saveNow();
    // The stage still shows the game being left: its picture is asked for before the next one loads.
    void pictureOpenGame().catch(() => undefined);
    const game = opts.fresh === false ? project : { ...project, id: uid('p') };
    s.setProject(game);
    setOpenGameId(game.id);
    if (opts.keep) await saveGame(useStore.getState().project);
  }
  useStore.getState().closeHome();
  if (opts.play) window.setTimeout(startGame, 50);
  return useStore.getState().project;
}

/** Opens one of My games. */
export async function switchToGame(id: string): Promise<void> {
  if (useStore.getState().project.id === id) {
    useStore.getState().closeHome();
    return;
  }
  const game = await loadGame(id);
  if (!game) throw new Error("That game couldn't be opened.");
  await openGame(game, { fresh: false });
}

/** A copy of one of My games, in My games. Opens it when `open` is set. */
export async function copyGame(id: string, open = false): Promise<Project> {
  const s = useStore.getState();
  let game: Project | null;
  if (s.project.id === id) {
    await saveNow();
    game = useStore.getState().project;
  } else game = await loadGame(id);
  if (!game) throw new Error("That game couldn't be copied.");
  const copy: Project = { ...structuredClone(game), id: uid('p'), title: `${game.title.trim() || 'Untitled game'} copy` };
  if (open) return openGame(copy, { keep: true, fresh: false });
  await saveGame(copy);
  return copy;
}

/** Deletes one of My games. If it is the one in the editor, the newest other game opens there (or an empty one). */
export async function removeGame(id: string): Promise<void> {
  const open = useStore.getState().project.id === id;
  if (open) {
    // Nothing of it is saved again on the way out.
    dirty = false;
    clearTimer();
  }
  await saving;
  await deleteGame(id);
  if (!open) return;
  const next = (await listGames())[0];
  const game = next ? await loadGame(next.id) : null;
  useStore.getState().setProject(game ?? blankProject());
  setOpenGameId(useStore.getState().project.id);
}
