/** The student's reading and motion preferences as attributes on `<html>`, which the CSS keys off (§3.2, §3.6). */
import { themeOf } from '../model/guards';
import type { Prefs } from '../model/types';

/**
 * Theme ('original' or 'contrast'), motion, text size, spacing and easy-read letters on `<html>` (the
 * layout class is set by watchLayout). The system's forced colours always mean High contrast.
 */
export function applyHtmlPrefs(prefs: Prefs, root: HTMLElement = document.documentElement): void {
  const forced = matchMedia('(forced-colors: active)').matches;
  const systemReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  root.dataset.theme = forced ? 'contrast' : themeOf(prefs.theme);
  root.dataset.motion = prefs.reduceMotion === 'on' || (prefs.reduceMotion === 'system' && systemReduced) ? 'reduced' : 'full';
  root.dataset.text = String(prefs.textScale);
  root.dataset.spacing = prefs.extraSpacing ? 'extra' : 'normal';
  root.dataset.easyread = prefs.easyRead ? 'on' : 'off';
  root.dataset.hand = prefs.leftHanded ? 'left' : 'right';
}
