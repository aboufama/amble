/**
 * Bakes for the player (§6.3, §6.5). The game runtime does not bind drawings to their bones (that code
 * stays in the editor, which keeps the runtime small), so every drawing with bones gets its bind from the
 * rig worker before it goes to a game: off the game's thread, and cached by the worker by drawing and
 * bones, so a drawing seen before costs a hash and a copy. The bones are scaled to the image exactly as
 * the runtime scales them (`scaleRigTo`), so the game finds the bake for what it spawns.
 */
import type { DrawnArt, ImageSource } from '../../cores/play';

type WorkerImage = Blob | ImageBitmap;

async function workerImage(src: ImageSource): Promise<WorkerImage> {
  if (typeof src !== 'string') return src;
  const img = new Image();
  img.src = src;
  await img.decode();
  return createImageBitmap(img);
}

const PNG = 0x89504e47;
const IHDR = 0x49484452;

/** Pixel size of an image as the game decodes it: a PNG's header, else a decode. */
async function sizeOf(src: WorkerImage): Promise<{ w: number; h: number }> {
  if (!(src instanceof Blob)) return { w: src.width, h: src.height };
  const head = new DataView(await src.slice(0, 24).arrayBuffer());
  if (head.byteLength >= 24 && head.getUint32(0) === PNG && head.getUint32(12) === IHDR) return { w: head.getUint32(16), h: head.getUint32(20) };
  const bmp = await createImageBitmap(src);
  const size = { w: bmp.width, h: bmp.height };
  bmp.close();
  return size;
}

/** The drawing with its bake; unchanged when it has no bones or a bake already, or the bind fails. */
export async function withBake(art: DrawnArt): Promise<DrawnArt> {
  if (art.rig === undefined || art.rig === null || art.bake) return art;
  try {
    const { rigWorker, parseRig, scaleRigTo } = await import('../../cores/rig');
    const image = await workerImage(art.image);
    const { w, h } = await sizeOf(image);
    const rig = scaleRigTo(parseRig(art.rig), w, h);
    let layers: Record<string, WorkerImage> | undefined;
    if (art.layers) {
      layers = {};
      for (const [name, src] of Object.entries(art.layers)) layers[name] = await workerImage(src);
    }
    return { ...art, bake: await rigWorker.bake(layers ? { image, layers } : { image }, rig) };
  } catch (err) {
    // The game then says these bones could not load, and the drawing moves as one piece.
    console.warn(`The bones for ${art.key} could not be prepared:`, err);
    return art;
  }
}

export function withBakes(art: readonly DrawnArt[]): Promise<DrawnArt[]> {
  return Promise.all(art.map(withBake));
}
