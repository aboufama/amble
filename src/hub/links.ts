import { useEffect } from 'react';
import { useStore } from '../store';
import { startGame } from '../actions';
import { EXAMPLES, loadExample } from '../project/examples';
import type { Project } from '../project/types';
import { confirmUser } from '../prompt';
import { homeSeen } from '../components/HomePage';
import { linkTarget, openHubProject } from './hub';

/** Opens a game from the hub (or a demo) in the editor and plays it. Asks first when there may be a game to lose. */
export async function openShared(load: () => Promise<Project>, ask: boolean): Promise<boolean> {
  const s = useStore.getState();
  let project: Project;
  try {
    project = await load();
  } catch (err) {
    s.notify((err as Error).message, 'error');
    return false;
  }
  if (
    ask &&
    !(await confirmUser({
      title: 'Open a shared game',
      message: `Open “${project.title || 'Untitled game'}”? It takes the place of the game in the editor. Save yours first (File > Save to your computer) if you want to keep it.`,
      confirmLabel: 'Open it',
    }))
  )
    return false;
  s.setProject(project);
  s.closeHome();
  window.setTimeout(startGame, 50);
  return true;
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
      // Someone who has used Amble here before may have a game of their own open.
      const ask = homeSeen();
      if (target.kind === 'demo') {
        const ex = EXAMPLES.find((e) => e.id === target.id);
        if (!ex) return useStore.getState().notify("That demo isn't here anymore.", 'error');
        void openShared(() => loadExample(ex), ask);
      } else void openShared(() => openHubProject(target.id), ask);
    };
    follow();
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, [loaded]);
}
