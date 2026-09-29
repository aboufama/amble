/**
 * World + its drawings → the player's init message (§8.4; M2 owns). A working minimal version: code in
 * load order, each drawn cast member as `DrawnArt` (flat PNG, rig, part layers), sounds as PCM or bytes,
 * dials, twists, the game's storage and the game fonts.
 */
import { applyEffect } from '../audio/effects';
import { SAMPLE_RATE, renderSynth, SOUND_PRESETS } from '../audio/synth';
import { getServices } from '../app/services';
import { loadGameFonts } from '../app/player/fonts';
import type { DrawnArt, GameFile, InitMessage, PlayerPrefs, RobotOptions, SoundAsset } from '../cores/play';
import type { SoundPiece, World } from '../model/types';
import type { Store } from '../store/api';

export interface ToInitOptions {
  mode: 'play' | 'robot';
  prefs: PlayerPrefs;
  robot?: RobotOptions;
  autostart?: boolean;
}

/** Helper files first (alphabetical), `game.js` last (§4.2). */
export function orderFiles(world: World): GameFile[] {
  const helpers = world.code.filter((f) => f.path !== 'game.js').sort((a, b) => a.path.localeCompare(b.path));
  const game = world.code.filter((f) => f.path === 'game.js');
  return [...helpers, ...game].map((f) => ({ name: f.path, source: f.source }));
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
  const recipe = src.kind === 'synth' ? src.recipe : SOUND_PRESETS[src.preset];
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
