import { useEffect } from 'react';
import { useStore } from '../store';
import { EXAMPLES, loadExample } from '../project/examples';
import type { Project } from '../project/types';
import { openGame } from '../games';
import { linkTarget, openHubProject } from './hub';

/** Opens a game from the hub (or a demo) in the editor and plays it. The game there stays in My games. */
export async function openShared(load: () => Promise<Project>): Promise<boolean> {
  try {
    await openGame(await load(), { play: true });
    return true;
  } catch (err) {
    useStore.getState().notify((err as Error).message, 'error');
    return false;
  }
}

/**
 * A link to a game (#play/<id>, or #play/demo-<id>) opens it and plays it, once the page has
 * loaded, and again whenever the address changes to one. The address then goes back to plain, so a
 * reload doesn't open the game again over changes made to it.
 */
export function usePlayLinks(loaded: boolean): void {
  useEffect(() => {
    if (!loaded) return;
    const follow = () => {
      const target = linkTarget(window.location.hash);
      if (!target) return;
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      if (target.kind === 'demo') {
        const ex = EXAMPLES.find((e) => e.id === target.id);
        if (!ex) return useStore.getState().notify("That demo isn't here anymore.", 'error');
        void openShared(() => loadExample(ex));
      } else void openShared(() => openHubProject(target.id));
    };
    follow();
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, [loaded]);
}
