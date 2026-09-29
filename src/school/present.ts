/**
 * Present mode (§2.14): the gallery on a projector, in the Original colours at 150 % UI scale. The
 * student's own reading preferences (High contrast included) come back the moment the teacher leaves it.
 */
import { applyHtmlPrefs } from '../app/htmlPrefs';
import { getState } from '../state/store';

export function enterPresent(root: HTMLElement = document.documentElement): () => void {
  root.dataset.theme = 'original';
  root.dataset.present = 'on';
  return () => {
    delete root.dataset.present;
    applyHtmlPrefs(getState().prefs, root);
  };
}
