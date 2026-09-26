import { chatJson, generateImage, type AiSettings, type Transport } from './openai';
import { imagePrompt, modelPrompt, soundPrompt, svgPrompt } from './prompt';
import { MODEL_SCHEMA, SOUND_SCHEMA, SVG_SCHEMA, type SvgReply } from './schema';
import { synthToDataUrl, type SynthRecipe } from '../audio/synth';
import { resizeImage, sanitizeSvg, svgDataUrl, trimTransparent } from '../project/images';
import { uid } from '../project/ids';
import type { CompiledAsset, ModelRecipe, WorldMode } from '../project/types';
import type { ModelPart, PartShape } from '../player/protocol';

export interface AssetJob {
  targetId: string;
  targetName: string;
  kind: 'costume' | 'backdrop' | 'model' | 'sound';
  name: string;
  description: string;
  width: number;
  height: number;
}

export interface AssetContext {
  transport: Transport;
  settings: AiSettings;
  mode: WorldMode;
  gameTitle: string;
  styleHint: string;
  signal?: AbortSignal;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));

function imageSize(job: AssetJob, mode: WorldMode): { width: number; height: number } {
  if (job.kind === 'backdrop') return mode === '2d' ? { width: 480, height: 360 } : { width: clamp(job.width || 960, 64, 1024), height: clamp(job.height || 540, 64, 1024) };
  return { width: Math.round(clamp(job.width || 96, 16, 400)), height: Math.round(clamp(job.height || 96, 16, 400)) };
}

async function makeSvgImage(job: AssetJob, ctx: AssetContext): Promise<CompiledAsset> {
  const size = imageSize(job, ctx.mode);
  const { system, user } = svgPrompt({
    kind: job.kind === 'backdrop' ? 'backdrop' : 'costume',
    mode: ctx.mode,
    width: size.width,
    height: size.height,
    description: job.description,
    spriteName: job.targetName,
    gameTitle: ctx.gameTitle,
    styleHint: ctx.styleHint,
  });
  const reply = await chatJson<SvgReply>(ctx.transport, {
    model: ctx.settings.assetModel || ctx.settings.model,
    system,
    user,
    schema: SVG_SCHEMA as unknown as Record<string, unknown>,
    schemaName: 'svg_art',
    reasoningEffort: 'low',
    signal: ctx.signal,
  });
  const svg = sanitizeSvg(reply.svg, size.width, size.height);
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
  const size = imageSize(job, ctx.mode);
  const isBackdrop = job.kind === 'backdrop';
  const png = await generateImage(ctx.transport, {
    model: ctx.settings.imageModel,
    prompt: imagePrompt({ kind: isBackdrop ? 'backdrop' : 'costume', mode: ctx.mode, description: job.description, gameTitle: ctx.gameTitle }),
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

const SHAPES: PartShape[] = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'capsule'];

export function cleanRecipe(raw: { parts?: unknown[] }): ModelRecipe {
  const vec = (v: unknown, fallback: number): [number, number, number] => {
    const a = Array.isArray(v) ? v : [];
    return [0, 1, 2].map((i) => (Number.isFinite(Number(a[i])) ? Number(a[i]) : fallback)) as [number, number, number];
  };
  const parts: ModelPart[] = (raw.parts ?? []).slice(0, 120).map((p) => {
    const part = (p ?? {}) as Record<string, unknown>;
    const shape = SHAPES.includes(part.shape as PartShape) ? (part.shape as PartShape) : 'box';
    return {
      shape,
      size: vec(part.size, 1).map((n) => clamp(Math.abs(n), 0.005, 200)) as [number, number, number],
      position: vec(part.position, 0),
      rotation: vec(part.rotation, 0),
      color: /^#[0-9a-f]{6}$/i.test(String(part.color)) ? String(part.color) : '#cccccc',
      roughness: clamp(Number(part.roughness ?? 0.7), 0, 1),
      metalness: clamp(Number(part.metalness ?? 0), 0, 1),
      emissive: clamp(Number(part.emissive ?? 0), 0, 1),
      opacity: clamp(Number(part.opacity ?? 1), 0.05, 1),
    };
  });
  if (!parts.length) {
    parts.push({ shape: 'box', size: [1, 1, 1], position: [0, 0.5, 0], rotation: [0, 0, 0], color: '#cccccc', roughness: 0.7, metalness: 0, emissive: 0, opacity: 1 });
  }
  return { parts };
}

async function makeModel(job: AssetJob, ctx: AssetContext): Promise<CompiledAsset> {
  const { system, user } = modelPrompt({
    description: job.description,
    width: job.width,
    height: job.height,
    spriteName: job.targetName,
    gameTitle: ctx.gameTitle,
  });
  const reply = await chatJson<{ parts: unknown[] }>(ctx.transport, {
    model: ctx.settings.assetModel || ctx.settings.model,
    system,
    user,
    schema: MODEL_SCHEMA as unknown as Record<string, unknown>,
    schemaName: 'model_recipe',
    reasoningEffort: 'low',
    signal: ctx.signal,
  });
  return {
    id: uid('a'),
    kind: 'model',
    name: job.name,
    recipe: cleanRecipe(reply),
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
    case 'model':
      return makeModel(job, ctx);
    case 'sound':
      return makeSound(job, ctx);
    default:
      return ctx.settings.artMode === 'image' ? makeImageModelArt(job, ctx) : makeSvgImage(job, ctx);
  }
}

/** Simple stand-in art when generation fails, so the game still runs. */
export function placeholderAsset(job: AssetJob, mode: WorldMode): CompiledAsset {
  const base = { id: uid('a'), name: job.name, description: job.description, targetId: job.targetId, targetName: job.targetName, request: job.description };
  if (job.kind === 'sound') {
    const { dataUrl, duration } = synthToDataUrl({ segments: [{ wave: 'sine', startFreq: 660, endFreq: 880, duration: 0.1, startVolume: 0.6, endVolume: 0 }] });
    return { ...base, kind: 'sound', dataUrl, mime: 'audio/wav', duration };
  }
  if (job.kind === 'model') {
    return { ...base, kind: 'model', recipe: cleanRecipe({ parts: [] }) };
  }
  const { width, height } = imageSize(job, mode);
  const hue = [...job.name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const letter = (job.name.trim()[0] ?? '?').toUpperCase().replace(/[<&>]/g, '?');
  const svg =
    job.kind === 'backdrop'
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="hsl(${hue},55%,85%)"/></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect x="3" y="3" width="${width - 6}" height="${height - 6}" rx="${Math.min(width, height) / 5}" fill="hsl(${hue},70%,60%)" stroke="hsl(${hue},60%,30%)" stroke-width="4"/><text x="50%" y="55%" font-family="sans-serif" font-weight="bold" font-size="${Math.min(width, height) / 2}" text-anchor="middle" dominant-baseline="middle" fill="white">${letter}</text></svg>`;
  return { ...base, kind: 'image', dataUrl: svgDataUrl(svg), mime: 'image/svg+xml', width, height, resolution: 1, centerX: width / 2, centerY: height / 2 };
}
