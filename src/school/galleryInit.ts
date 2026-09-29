/**
 * A student's `.amble` file → the player's init message, for the gallery (§2.14). The file's drawings and
 * sounds come from the file itself: a gallery file is never imported into this Chromebook's worlds, so
 * `world/init.ts` (which reads the store) can't be used here. Same shape: helper files first, `game.js`
 * last; each drawn member as `DrawnArt` (flat PNG, bones, part layers); sounds as PCM or bytes.
 */
import { applyEffect } from '../audio/effects';
import { renderSynth, SAMPLE_RATE, SOUND_PRESETS } from '../audio/synth';
import { loadGameFonts } from '../app/player/fonts';
import type { DrawnArt, GameFile, InitMessage, PlayerPrefs, SoundAsset } from '../cores/play';
import type { AmbleFile, BlobRef, SoundPiece, World } from '../model/types';

export function gameFiles(world: World): GameFile[] {
  const helpers = world.code.filter((f) => f.path !== 'game.js').sort((a, b) => a.path.localeCompare(b.path));
  const game = world.code.filter((f) => f.path === 'game.js');
  return [...helpers, ...game].map((f) => ({ name: f.path, source: f.source }));
}

function drawnArt(file: AmbleFile, world: World): DrawnArt[] {
  const blob = (ref: BlobRef) => file.blobs.get(ref) ?? null;
  const out: DrawnArt[] = [];
  for (const slot of Object.values(world.cast)) {
    if (!slot.art) continue;
    const record = file.art.find((a) => a.id === slot.art);
    const image = record?.export ? blob(record.export.flat) : null;
    if (!record?.export || !image) continue;
    const art: DrawnArt = { key: slot.key, image };
    if (record.rigData) art.rig = record.rigData;
    const layers: Record<string, Blob> = {};
    for (const [name, part] of Object.entries(record.export.parts)) {
      const b = blob(part.blob);
      if (b) layers[name.startsWith('part:') ? name : `part:${name}`] = b;
    }
    if (Object.keys(layers).length) art.layers = layers;
    out.push(art);
  }
  return out;
}

async function soundAsset(piece: SoundPiece, file: AmbleFile): Promise<SoundAsset | null> {
  const src = piece.source;
  if (src.kind === 'recording') {
    const b = file.blobs.get(src.blob);
    return b ? { key: piece.name, bytes: await b.arrayBuffer(), caption: piece.caption } : null;
  }
  const recipe = src.kind === 'synth' ? src.recipe : SOUND_PRESETS[src.preset];
  if (!recipe) return null;
  let pcm = renderSynth(recipe);
  for (const effect of piece.effects) pcm = applyEffect(pcm, SAMPLE_RATE, effect);
  return { key: piece.name, pcm: [pcm], sampleRate: SAMPLE_RATE, caption: piece.caption };
}

export async function initFromFile(file: AmbleFile, o: { mode: 'play' | 'robot'; prefs: PlayerPrefs; seconds?: number }): Promise<InitMessage> {
  const world = file.world;
  if (!world) throw new Error('This file has no world in it.');
  const sounds: SoundAsset[] = [];
  for (const piece of Object.values(world.sounds)) {
    const asset = await soundAsset(piece, file);
    if (asset) sounds.push(asset);
  }
  const init: InitMessage = {
    type: 'init',
    mode: o.mode,
    files: gameFiles(world),
    art: drawnArt(file, world),
    sounds,
    fonts: await loadGameFonts(),
    dials: { ...world.dials },
    twists: [...world.twists],
    storage: { ...world.gameStorage },
    prefs: o.prefs,
    autostart: o.mode === 'robot',
  };
  if (o.mode === 'robot') init.robot = { gameMs: (o.seconds ?? 6) * 1000, seed: 1, bot: 'auto' };
  return init;
}
