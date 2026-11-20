/**
 * A trial run (the harness's `trialRun`): the freshly built game plays for a few seconds in a
 * hidden player, with a few keys pressed the way a player would, and every error or warning it
 * reports is returned, so the code can be fixed before anyone presses the green flag.
 */
import { PlayerHost } from '../player/host';
import { buildRunPackage } from '../player/package';
import type { Project } from '../project/types';

const KEYS: Array<[string, string]> = [
  ['ArrowRight', 'ArrowRight'],
  [' ', 'Space'],
  ['ArrowLeft', 'ArrowLeft'],
  ['ArrowUp', 'ArrowUp'],
  ['ArrowDown', 'ArrowDown'],
  ['Enter', 'Enter'],
];

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Plays `project` (with its compiled game) for `seconds`, and returns what went wrong, as "Target (script): message". */
export async function trialRun(project: Project, seconds: number, signal?: AbortSignal): Promise<string[]> {
  // (Not where there is no real browser to run the player in, like the unit tests' jsdom.)
  if (typeof document === 'undefined' || /jsdom/i.test(navigator.userAgent)) return [];
  const box = document.createElement('div');
  box.setAttribute('aria-hidden', 'true');
  box.style.cssText = 'position:fixed;left:-10000px;top:0;width:480px;height:360px;overflow:hidden;pointer-events:none;';
  document.body.append(box);
  const problems: string[] = [];
  let loaded = false;
  const host = new PlayerHost(box, {
    onLoaded: () => (loaded = true),
    onError: (e) => problems.push(`${e.target ?? 'Game'}${e.script ? ` (${e.script})` : ''}: ${e.message}`),
    onLog: (level, message) => {
      if (level !== 'log') problems.push(message);
    },
  });
  try {
    host.load(buildRunPackage(project), true);
    // Wait for the engine to load the game (at most a few seconds), then play.
    for (let waited = 0; !loaded && waited < 8000 && !signal?.aborted; waited += 100) await pause(100);
    const end = performance.now() + seconds * 1000;
    for (let i = 0; performance.now() < end && !signal?.aborted; i++) {
      const [key, code] = KEYS[i % KEYS.length];
      host.key('down', key, code);
      await pause(220);
      host.key('up', key, code);
      await pause(110);
    }
  } finally {
    host.destroy();
    box.remove();
  }
  return [...new Set(problems)];
}
