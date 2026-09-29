/**
 * World + its drawings → the player's init message (§8.4; M2 owns): code in load order, each drawn cast
 * member as `DrawnArt` (flat PNG, bones, part layers), sounds as PCM or bytes, dials, twists, the game's
 * storage and the game fonts. The student's own keys (the Controls sheet, `World.controls`) ride in one
 * small generated file that runs after game.js and sets them before the game's `create()`.
 */
import { applyEffect } from '../audio/effects';
import { SAMPLE_RATE, renderSynth } from '../audio/synth';
import { getServices } from '../app/services';
import { loadGameFonts } from '../app/player/fonts';
import type { DrawnArt, GameFile, InitMessage, PlayerPrefs, RobotOptions, SoundAsset } from '../cores/play';
import type { Action, SoundPiece, World } from '../model/types';
import { instrument } from '../cores/ai';
import type { Store } from '../store/api';
import { presetRecipe } from './sounds';

export interface ToInitOptions {
  mode: 'play' | 'robot';
  prefs: PlayerPrefs;
  robot?: RobotOptions;
  autostart?: boolean;
}

/** The runtime's loop guard (`Amble.__loop`), the same one the AI pipeline's robot test uses. */
export const LOOP_GUARD = 'Amble.__loop()';

/**
 * Helper files first (alphabetical), `game.js` last (§4.2), then the student's keys when they set any.
 * Every loop gets the guard at the top of its body (line numbers unchanged), so a loop that never ends
 * is stopped with "This loop never ends" instead of freezing the Chromebook.
 */
export function orderFiles(world: World): GameFile[] {
  const helpers = world.code.filter((f) => f.path !== 'game.js').sort((a, b) => a.path.localeCompare(b.path));
  const game = world.code.filter((f) => f.path === 'game.js');
  const files = [...helpers, ...game].map((f) => ({ name: f.path, source: instrument(f.source, { guard: LOOP_GUARD }).code }));
  const keys = controlsFile(world.controls);
  return keys ? [...files, keys] : files;
}

/** KeyboardEvent.code → the key name games bind (Phaser's KeyCodes). */
export function phaserKeyName(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  const digits = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];
  if (/^Digit[0-9]$/.test(code)) return digits[Number(code.slice(5))];
  if (/^Numpad[0-9]$/.test(code)) return `NUMPAD_${digits[Number(code.slice(6))]}`;
  const named: Record<string, string> = {
    ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', ArrowUp: 'UP', ArrowDown: 'DOWN', Space: 'SPACE', Enter: 'ENTER', NumpadEnter: 'ENTER',
    ShiftLeft: 'SHIFT', ShiftRight: 'SHIFT', ControlLeft: 'CTRL', ControlRight: 'CTRL', AltLeft: 'ALT', AltRight: 'ALT', Backspace: 'BACKSPACE',
    Comma: 'COMMA', Period: 'PERIOD', Slash: 'FORWARD_SLASH', Semicolon: 'SEMICOLON', Quote: 'QUOTES', BracketLeft: 'OPEN_BRACKET',
    BracketRight: 'CLOSED_BRACKET', Minus: 'MINUS', Equal: 'PLUS', Backquote: 'BACKTICK', Backslash: 'BACK_SLASH',
  };
  return named[code] ?? null;
}

export const CONTROLS_FILE = 'amble-keys.js';

/** The generated file that puts the student's keys on the game's controls (null when they set none). */
export function controlsFile(controls: World['controls']): GameFile | null {
  const bind: Partial<Record<Action, string[]>> = {};
  for (const [action, codes] of Object.entries(controls) as Array<[Action, string[] | undefined]>) {
    const names = [...new Set((codes ?? []).map(phaserKeyName).filter((n): n is string => !!n))];
    if (names.length) bind[action] = names;
  }
  if (!Object.keys(bind).length) return null;
  const source = `// Your keys, from the Controls sheet (Amble writes this file; it is not part of your code).
(function () {
  var keys = ${JSON.stringify(bind)};
  if (typeof Game !== 'function' || !Game.prototype) return;
  var create = Game.prototype.create;
  Game.prototype.create = function () {
    var c = this.controls;
    if (c && c.bind) for (var a in keys) c.bind[a] = keys[a].slice();
    return create ? create.apply(this, arguments) : undefined;
  };
})();
`;
  return { name: CONTROLS_FILE, source };
}

async function drawnArt(world: World, store: Store): Promise<DrawnArt[]> {
  const out: DrawnArt[] = [];
  for (const slot of Object.values(world.cast)) {
    if (!slot.art) continue;
    const record = await store.art.get(slot.art);
    if (!record?.export) continue;
    const image = await store.blobs.get(record.export.flat);
    if (!image) continue;
    const art: DrawnArt = { key: slot.key, image };
    if (record.rigData) art.rig = record.rigData;
    const parts = Object.entries(record.export.parts);
    if (parts.length) {
      const layers: Record<string, Blob> = {};
      for (const [name, part] of parts) {
        const blob = await store.blobs.get(part.blob);
        if (blob) layers[name.startsWith('part:') ? name : `part:${name}`] = blob;
      }
      art.layers = layers;
    }
    out.push(art);
  }
  return out;
}

async function soundAsset(piece: SoundPiece, store: Store): Promise<SoundAsset | null> {
  const src = piece.source;
  if (src.kind === 'recording') {
    const blob = await store.blobs.get(src.blob);
    return blob ? { key: piece.name, bytes: await blob.arrayBuffer(), caption: piece.caption } : null;
  }
  const recipe = src.kind === 'synth' ? src.recipe : presetRecipe(src.preset, src.variation);
  if (!recipe) return null;
  let pcm = renderSynth(recipe);
  for (const effect of piece.effects) pcm = applyEffect(pcm, SAMPLE_RATE, effect);
  return { key: piece.name, pcm: [pcm], sampleRate: SAMPLE_RATE, caption: piece.caption };
}

export async function toInitMessage(world: World, o: ToInitOptions): Promise<InitMessage> {
  const store = getServices().store;
  const [art, fonts] = await Promise.all([drawnArt(world, store), loadGameFonts()]);
  const sounds: SoundAsset[] = [];
  for (const piece of Object.values(world.sounds)) {
    const asset = await soundAsset(piece, store);
    if (asset) sounds.push(asset);
  }
  const init: InitMessage = {
    type: 'init',
    mode: o.mode,
    files: orderFiles(world),
    art,
    sounds,
    fonts,
    dials: { ...world.dials },
    twists: [...world.twists],
    storage: { ...world.gameStorage },
    prefs: o.prefs,
    autostart: o.autostart ?? false,
  };
  if (o.mode === 'robot') init.robot = o.robot ?? { gameMs: 6000, seed: 1, bot: 'auto' };
  return init;
}
