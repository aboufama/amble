import { fileToDataUrl, loadImage, resizeImage, sanitizeSvg, svgDataUrl, svgSize } from './images';
import { uid } from './ids';
import type { ImageAsset, ModelAsset, SoundAsset } from './types';

const baseName = (file: File) => file.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'costume';

/** Imports an image file as a costume or backdrop. */
export async function importImageFile(file: File, asBackdrop = false): Promise<ImageAsset> {
  const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
  if (isSvg) {
    const text = await file.text();
    const size = svgSize(text) ?? { width: 100, height: 100 };
    const clean = sanitizeSvg(text, Math.round(size.width), Math.round(size.height));
    return {
      id: uid('a'),
      name: baseName(file),
      kind: 'image',
      dataUrl: svgDataUrl(clean),
      mime: 'image/svg+xml',
      width: size.width,
      height: size.height,
      resolution: 1,
      centerX: size.width / 2,
      centerY: size.height / 2,
    };
  }
  const original = await fileToDataUrl(file);
  const img = await loadImage(original);
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  let dataUrl = original;
  let resolution = 1;
  if (asBackdrop) {
    // Backdrops cover the stage, stored at 2x for sharpness.
    w = 960;
    h = 720;
    dataUrl = await resizeImage(original, w, h, 'cover');
    resolution = 2;
  } else if (w > 480 || h > 360) {
    const scale = Math.min(960 / w, 720 / h, 1);
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
    dataUrl = await resizeImage(original, w, h, 'contain');
    resolution = 2;
  }
  return { id: uid('a'), name: baseName(file), kind: 'image', dataUrl, mime: dataUrl.startsWith('data:image/png') ? 'image/png' : file.type || 'image/png', width: w, height: h, resolution, centerX: w / 2, centerY: h / 2 };
}

/** Imports a .glb 3D model. */
export async function importModelFile(file: File): Promise<ModelAsset> {
  if (!/\.glb$/i.test(file.name)) throw new Error('3D models must be .glb files.');
  if (file.size > 25 * 1024 * 1024) throw new Error('That model is too big (25 MB max).');
  const dataUrl = await fileToDataUrl(new Blob([await file.arrayBuffer()], { type: 'model/gltf-binary' }));
  return { id: uid('a'), name: baseName(file), kind: 'model', dataUrl };
}

let ctx: AudioContext | null = null;

export async function audioDuration(dataUrl: string): Promise<number> {
  ctx ??= new AudioContext();
  const data = await (await fetch(dataUrl)).arrayBuffer();
  const buffer = await ctx.decodeAudioData(data);
  return buffer.duration;
}

/** Imports an audio file (wav, mp3, ogg, m4a, webm) as a sound. */
export async function importSoundFile(file: File | Blob, name?: string): Promise<SoundAsset> {
  if (file.size > 15 * 1024 * 1024) throw new Error('That sound is too big (15 MB max).');
  const dataUrl = await fileToDataUrl(file);
  let duration = 0;
  try {
    duration = await audioDuration(dataUrl);
  } catch {
    throw new Error("This browser can't play that sound file.");
  }
  return {
    id: uid('a'),
    name: name ?? ((file as File).name ? baseName(file as File) : 'recording'),
    kind: 'sound',
    dataUrl,
    mime: file.type || 'audio/wav',
    duration,
  };
}

export function pickFile(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.click();
  });
}
