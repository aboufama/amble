import { chatJson, generateImage, type AiSettings, type Transport } from './openai';
import { imagePrompt, soundPrompt, svgPrompt, type ArtReference } from './prompt';
import { SOUND_SCHEMA, SVG_SCHEMA, type SvgReply } from './schema';
import { synthToDataUrl, type SynthRecipe } from '../audio/synth';
import { resizeImage, sanitizeSvg, svgDataUrl, svgFromDataUrl, trimTransparent } from '../project/images';
import { uid } from '../project/ids';
import type { ArtBrief } from '../project/styles';
import type { CompiledAsset } from '../project/types';

export interface AssetJob {
  targetId: string;
  targetName: string;
  kind: 'costume' | 'backdrop' | 'sound';
  name: string;
  description: string;
  width: number;
  height: number;
  /** A costume its sprite already has: this one is drawn from it, so the two are one character. */
  reference?: ArtReference;
}

export interface AssetContext {
  transport: Transport;
  settings: AiSettings;
  gameTitle: string;
  /** The game's art brief: the same for every picture, so they share a look. */
  style: ArtBrief;
  signal?: AbortSignal;
}

/**
 * The order pictures are made in. A sprite's costumes are frames of one character, each drawn in
 * its own request: its first costume leads and the others follow (they are given its drawing).
 * Backdrops, sounds and the first costume of every sprite wait for nothing. Sets with followers
 * come first, so the drawings that others wait for are started right away.
 */
export function costumeSets(jobs: AssetJob[]): Array<{ first: number; rest: number[] }> {
  const sets: Array<{ first: number; rest: number[] }> = [];
  const bySprite = new Map<string, { first: number; rest: number[] }>();
  jobs.forEach((job, index) => {
    const set = job.kind === 'costume' ? bySprite.get(job.targetId) : undefined;
    if (set) {
      set.rest.push(index);
      return;
    }
    const alone = { first: index, rest: [] };
    if (job.kind === 'costume') bySprite.set(job.targetId, alone);
    sets.push(alone);
  });
  return [...sets.filter((set) => set.rest.length), ...sets.filter((set) => !set.rest.length)];
}

/** The longest drawing handed on to a sprite's other costumes (more is too much to copy faithfully). */
const REFERENCE_LIMIT = 24_000;

/** A finished costume, as what the sprite's other costumes are drawn from. */
export function referenceOf(asset: CompiledAsset): ArtReference | null {
  if (asset.kind !== 'image') return null;
  const res = asset.resolution || 1;
  const svg = asset.mime === 'image/svg+xml' ? svgFromDataUrl(asset.dataUrl) : null;
  return {
    name: asset.name,
    description: asset.description || asset.request || asset.name,
    width: Math.round(asset.width / res),
    height: Math.round(asset.height / res),
    ...(svg && svg.length <= REFERENCE_LIMIT ? { svg } : {}),
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));

function imageSize(job: AssetJob): { width: number; height: number } {
  if (job.kind === 'backdrop') return { width: 480, height: 360 };
  return { width: Math.round(clamp(job.width || 96, 16, 400)), height: Math.round(clamp(job.height || 96, 16, 400)) };
}

async function makeSvgImage(job: AssetJob, ctx: AssetContext): Promise<CompiledAsset> {
  const size = imageSize(job);
  const { system, user } = svgPrompt({
    kind: job.kind === 'backdrop' ? 'backdrop' : 'costume',
    mode: '2d',
    width: size.width,
    height: size.height,
    description: job.description,
    spriteName: job.targetName,
    gameTitle: ctx.gameTitle,
    style: ctx.style,
    reference: job.reference,
  });
  const reply = await chatJson<SvgReply>(ctx.transport, {
    model: ctx.settings.assetModel || ctx.settings.model,
    system,
    user,
    schema: SVG_SCHEMA as unknown as Record<string, unknown>,
    schemaName: 'svg_art',
    reasoningEffort: 'low',
    kind: 'art',
    signal: ctx.signal,
  });
  // Pixel art keeps its hard edges whether or not the artist remembered to ask for them.
  const svg = sanitizeSvg(reply.svg, size.width, size.height, { crispEdges: ctx.style.pixel });
  return {
    id: uid('a'),
    kind: 'image',
    name: job.name,
    dataUrl: svgDataUrl(svg),
    mime: 'image/svg+xml',
    width: size.width,
    height: size.height,
    resolution: 1,
    centerX: size.width / 2,
    centerY: size.height / 2,
    description: job.description,
    targetId: job.targetId,
    targetName: job.targetName,
    request: job.description,
  };
}

async function makeImageModelArt(job: AssetJob, ctx: AssetContext): Promise<CompiledAsset> {
  const size = imageSize(job);
  const isBackdrop = job.kind === 'backdrop';
  const png = await generateImage(ctx.transport, {
    model: ctx.settings.imageModel,
    prompt: imagePrompt({ kind: isBackdrop ? 'backdrop' : 'costume', mode: '2d', description: job.description, gameTitle: ctx.gameTitle, style: ctx.style, reference: job.reference }),
    size: isBackdrop ? '1536x1024' : '1024x1024',
    transparent: !isBackdrop,
    signal: ctx.signal,
  });
  // Store bitmaps at 2x for crisp rendering.
  let dataUrl: string;
  let width: number;
  let height: number;
  if (isBackdrop) {
    width = size.width * 2;
    height = size.height * 2;
    dataUrl = await resizeImage(png, width, height, 'cover');
  } else {
    const trimmed = await trimTransparent(png);
    const scale = Math.min((size.width * 2) / trimmed.width, (size.height * 2) / trimmed.height);
    width = Math.max(2, Math.round(trimmed.width * scale));
    height = Math.max(2, Math.round(trimmed.height * scale));
    dataUrl = await resizeImage(trimmed.dataUrl, width, height, 'contain');
  }
  return {
    id: uid('a'),
    kind: 'image',
    name: job.name,
    dataUrl,
    mime: 'image/png',
    width,
    height,
    resolution: 2,
    centerX: width / 2,
    centerY: height / 2,
    description: job.description,
    targetId: job.targetId,
    targetName: job.targetName,
    request: job.description,
  };
}

async function makeSound(job: AssetJob, ctx: AssetContext): Promise<CompiledAsset> {
  const { system, user } = soundPrompt(job.description);
  const recipe = await chatJson<SynthRecipe>(ctx.transport, {
    model: ctx.settings.assetModel || ctx.settings.model,
    system,
    user,
    schema: SOUND_SCHEMA as unknown as Record<string, unknown>,
    schemaName: 'sound_recipe',
    reasoningEffort: 'low',
    kind: 'sound',
    signal: ctx.signal,
  });
  const { dataUrl, duration } = synthToDataUrl(recipe);
  return {
    id: uid('a'),
    kind: 'sound',
    name: job.name,
    dataUrl,
    mime: 'audio/wav',
    duration,
    description: job.description,
    targetId: job.targetId,
    targetName: job.targetName,
    request: job.description,
  };
}

/** Generates one compiled asset. */
export async function generateAsset(job: AssetJob, ctx: AssetContext): Promise<CompiledAsset> {
  switch (job.kind) {
    case 'sound':
      return makeSound(job, ctx);
    default:
      return ctx.settings.artMode === 'image' ? makeImageModelArt(job, ctx) : makeSvgImage(job, ctx);
  }
}

/**
 * Simple stand-in art when generation fails, so the game still runs. A costume stands in as
 * `like`, another costume of its sprite, when there is one: an animation that misses a pose looks
 * better than one that flashes a box.
 */
export function placeholderAsset(job: AssetJob, like?: CompiledAsset): CompiledAsset {
  const base = { id: uid('a'), name: job.name, description: job.description, targetId: job.targetId, targetName: job.targetName, request: job.description };
  if (job.kind === 'sound') {
    const { dataUrl, duration } = synthToDataUrl({ segments: [{ wave: 'sine', startFreq: 660, endFreq: 880, duration: 0.1, startVolume: 0.6, endVolume: 0 }] });
    return { ...base, kind: 'sound', dataUrl, mime: 'audio/wav', duration };
  }
  if (like?.kind === 'image' && job.kind === 'costume') return { ...like, ...base };
  const { width, height } = imageSize(job);
  const hue = [...job.name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const letter = (job.name.trim()[0] ?? '?').toUpperCase().replace(/[<&>]/g, '?');
  const svg =
    job.kind === 'backdrop'
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="hsl(${hue},55%,85%)"/></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect x="3" y="3" width="${width - 6}" height="${height - 6}" rx="${Math.min(width, height) / 5}" fill="hsl(${hue},70%,60%)" stroke="hsl(${hue},60%,30%)" stroke-width="4"/><text x="50%" y="55%" font-family="sans-serif" font-weight="bold" font-size="${Math.min(width, height) / 2}" text-anchor="middle" dominant-baseline="middle" fill="white">${letter}</text></svg>`;
  return { ...base, kind: 'image', dataUrl: svgDataUrl(svg), mime: 'image/svg+xml', width, height, resolution: 1, centerX: width / 2, centerY: height / 2 };
}

/** Is this picture the stand-in box (and so nothing to draw a character from)? */
export function isPlaceholder(asset: CompiledAsset): boolean {
  if (asset.kind !== 'image' || asset.mime !== 'image/svg+xml') return false;
  const again = placeholderAsset({ targetId: asset.targetId, targetName: asset.targetName, kind: 'costume', name: asset.name, description: '', width: asset.width, height: asset.height });
  return again.dataUrl === asset.dataUrl;
}
