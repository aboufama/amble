import { chatJson, generateImage, type AiSettings, type Transport } from './openai';
import { imagePrompt, soundPrompt, svgPrompt, type ArtReference } from './prompt';
import { SOUND_SCHEMA, SVG_SCHEMA, SVG_SHEET_SCHEMA, type SvgReply, type SvgSheetReply } from './schema';
import { harness } from './harness';
import { candidateLine, fallbackSound, renderSoundReply, soundCandidates, soundKindFor, styleLines, type MadeSound, type SoundReply } from '../audio/custom';
import { resizeImage, sanitizeSvg, svgDataUrl, svgFromDataUrl, trimTransparent } from '../project/images';
import { closeSvg, svgSoFar } from './sketch';
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
  /** A drawing as it is drawn (its SVG so far, made whole), and once more when it is done. */
  onSketch?(sketch: Sketch): void;
}

export interface Sketch {
  target: string;
  name: string;
  kind: 'costume' | 'backdrop';
  svg: string;
  done: boolean;
}

/** onText for an art request: each of `jobs` (its nth "svg" in the reply) as it is drawn, a few times a second. */
function sketcher(jobs: AssetJob[], ctx: AssetContext): ((text: string) => void) | undefined {
  if (!ctx.onSketch) return undefined;
  let last = 0;
  return (text) => {
    const now = Date.now();
    if (now - last < 150) return;
    last = now;
    jobs.forEach((job, i) => {
      const got = svgSoFar(text, i);
      const svg = got && !got.done ? closeSvg(got.svg) : null;
      if (svg) ctx.onSketch!({ target: job.targetName, name: job.name, kind: job.kind === 'backdrop' ? 'backdrop' : 'costume', svg, done: false });
    });
  };
}

function sketched(asset: CompiledAsset, job: AssetJob, ctx: AssetContext): CompiledAsset {
  const svg = asset.mime === 'image/svg+xml' ? svgFromDataUrl(asset.dataUrl) : null;
  if (svg) ctx.onSketch?.({ target: job.targetName, name: job.name, kind: job.kind === 'backdrop' ? 'backdrop' : 'costume', svg, done: true });
  return asset;
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
    reasoningEffort: harness().artEffort,
    kind: 'art',
    signal: ctx.signal,
    onText: sketcher([job], ctx),
  });
  // Pixel art keeps its hard edges whether or not the artist remembered to ask for them.
  const svg = sanitizeSvg(reply.svg, size.width, size.height, { crispEdges: ctx.style.pixel });
  return sketched(svgAsset(job, size, svg), job, ctx);
}

function svgAsset(job: AssetJob, size: { width: number; height: number }, svg: string): CompiledAsset {
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

/**
 * All of one sprite's costumes in one request (the harness's "sheet" costumes): drawn together, they
 * are one character without a second round trip. Returns them in the order of `jobs`; a costume the
 * reply left out (or that doesn't parse) is null, for the caller to make on its own.
 */
export async function makeSvgSheet(jobs: AssetJob[], ctx: AssetContext): Promise<Array<CompiledAsset | null>> {
  const first = jobs[0];
  const sizes = jobs.map(imageSize);
  const { system } = svgPrompt({ kind: 'costume', mode: '2d', width: sizes[0].width, height: sizes[0].height, description: first.description, spriteName: first.targetName, gameTitle: ctx.gameTitle, style: ctx.style });
  const sheetSystem = system.replace(
    /^You are the artist[^\n]*\n/,
    `You are the artist of a 2D game made in Amble, a game maker for kids: you draw the game's pictures as SVG code. This request is all the costumes of one sprite: frames the game swaps in place as animation. Reply with JSON: { "costumes": [{ "name", "svg" }] }, one entry per costume asked for, in order.\n`,
  );
  const style = ctx.style;
  const user = [
    `Game: ${ctx.gameTitle}`,
    `Sprite: ${first.targetName}`,
    `Draw these ${jobs.length} costumes${style.words ? `, in the game's art style (${style.name})` : ''}. Draw the first one, then make each other one by copying it and changing only what its description asks (a leg forward, wings down, eyes closed): the same shapes, colours, line weight, size and position on the canvas, so the character doesn't flicker when the frames swap. A costume that is plainly something else (an explosion, a broken version) is drawn as asked, in the same style.`,
    ...jobs.map((j, i) => `- "${j.name}": ${sizes[i].width} x ${sizes[i].height} px: ${j.description}`),
  ].join('\n');
  const reply = await chatJson<SvgSheetReply>(ctx.transport, {
    model: ctx.settings.assetModel || ctx.settings.model,
    system: sheetSystem,
    user,
    schema: SVG_SHEET_SCHEMA as unknown as Record<string, unknown>,
    schemaName: 'svg_sheet',
    reasoningEffort: harness().artEffort,
    kind: 'art',
    signal: ctx.signal,
    onText: sketcher(jobs, ctx),
  });
  const byName = new Map((reply.costumes ?? []).map((c) => [String(c.name ?? '').trim(), String(c.svg ?? '')]));
  return jobs.map((job, i) => {
    const raw = byName.get(job.name) ?? reply.costumes?.[i]?.svg;
    if (!raw) return null;
    try {
      return sketched(svgAsset(job, sizes[i], sanitizeSvg(raw, sizes[i].width, sizes[i].height, { crispEdges: ctx.style.pixel })), job, ctx);
    } catch {
      return null;
    }
  });
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

/**
 * A sound for the game: the closest library sounds are shown to the model, which picks one or
 * designs its own (one request, as before). If the request fails, or the answer can't be used,
 * the best library match is used instead: a build never ends with a missing or silent sound.
 */
async function makeSound(job: AssetJob, ctx: AssetContext): Promise<CompiledAsset> {
  const candidates = soundCandidates(job.name, job.description, 10);
  let made: MadeSound | null = null;
  // The harness's "library" sounds: the closest library sound, with no request at all.
  if (harness().sounds !== 'library') try {
    const { system, user } = soundPrompt({
      name: job.name,
      description: job.description,
      gameTitle: ctx.gameTitle,
      music: soundKindFor(job.name, job.description) === 'music',
      candidates: candidates.map(candidateLine),
      styles: styleLines(),
    });
    const reply = await chatJson<SoundReply>(ctx.transport, {
      model: ctx.settings.assetModel || ctx.settings.model,
      system,
      user,
      schema: SOUND_SCHEMA as unknown as Record<string, unknown>,
      schemaName: 'sound_recipe',
      reasoningEffort: harness().soundEffort,
      kind: 'sound',
      signal: ctx.signal,
    });
    made = renderSoundReply(reply);
  } catch (err) {
    if (ctx.signal?.aborted) throw err;
  }
  const { dataUrl, duration } = made ?? fallbackSound(job.name, job.description, candidates);
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
    // The closest sound in the library (nothing is generated, so this works offline).
    const { dataUrl, duration } = fallbackSound(job.name, job.description);
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
