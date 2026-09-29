/**
 * Loading a game into the realm: its fonts, drawings and recordings (decoded, never fetched), then its
 * files as classic blob: scripts in order, each ending in `//# sourceURL=amble:///<file>` so stack traces
 * name the student's file and line, and finally the start script that boots `class Game`.
 */
import type { DrawnArt, FontAsset, GameFile, SoundAsset } from '../../play/protocol';
import type { DrawnStore } from './assets';
import type { AudioHub } from './audio';
import { sourceUrlFor, type ScriptRegistry } from './stack';

type Warn = (message: string) => void;

function runScript(url: string): Promise<void> {
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.async = false;
    s.src = url;
    // A file that does not parse still "loads"; its SyntaxError reaches window.onerror with the line.
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.head.append(s);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Registers the game's fonts (waiting at most 1.5 s: text falls back to system fonts meanwhile). */
export async function loadFonts(fonts: FontAsset[], warn: Warn): Promise<void> {
  const jobs = fonts.map(async (f) => {
    try {
      const face = new FontFace(f.family, f.bytes, { weight: String(f.weight ?? 400) });
      await face.load();
      document.fonts.add(face);
    } catch {
      warn(`The font ${f.family} could not load.`);
    }
  });
  await Promise.race([Promise.all(jobs), delay(1500)]);
}

export async function loadArt(list: DrawnArt[], drawn: DrawnStore, warn: Warn): Promise<void> {
  await Promise.all(
    list.map(async (a) => {
      try {
        drawn.set(await drawn.decode(a));
      } catch {
        warn(`The drawing for ${a.key} could not load.`);
      }
    }),
  );
}

export async function loadSounds(list: SoundAsset[], audio: AudioHub, into: Map<string, AudioBuffer>, warn: Warn): Promise<void> {
  await Promise.all(
    list.map(async (s) => {
      try {
        const buf = await audio.decode(s);
        if (buf) into.set(s.key, buf);
      } catch {
        warn(`The sound ${s.key} could not load.`);
      }
    }),
  );
}

/** Runs the game's files in order (helpers first, game.js last). */
export async function runFiles(files: GameFile[], scripts: ScriptRegistry): Promise<void> {
  for (const f of files) {
    const url = URL.createObjectURL(new Blob([`${f.source}\n//# sourceURL=${sourceUrlFor(f.name)}\n`], { type: 'text/javascript' }));
    scripts.add(f.name, url);
    await runScript(url);
  }
}

/** Boots `class Game` (a top-level class is a global binding only another classic script can see). */
export function runStart(): Promise<void> {
  const url = URL.createObjectURL(new Blob(["Amble.__start(typeof Game !== 'undefined' ? Game : undefined);"], { type: 'text/javascript' }));
  return runScript(url);
}
