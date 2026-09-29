/**
 * Present mode (§2.14): the gallery on a projector, in the Day theme at 150 % UI scale. The student's own
 * reading preferences come back the moment the teacher leaves it.
 */
import { applyHtmlPrefs } from '../app/htmlPrefs';
import { getState } from '../state/store';

export function enterPresent(root: HTMLElement = document.documentElement): () => void {
  root.dataset.theme = 'day';
  root.dataset.present = 'on';
  return () => {
    delete root.dataset.present;
    applyHtmlPrefs(getState().prefs, root);
  };
}
