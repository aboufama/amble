/**
 * What the rig worker does, with its caches. Runs in the worker, or inline on the main thread when a
 * worker can't start (tests, a strict CSP). Analyses are cached by the art's pixel hash and working
 * size (a rebind after a joint drag skips the analysis); bakes by art + bones + binder version.
 */
import { analyze, EXCLUDED_LAYERS, type Analysis } from '../analyze';
import { autoRig } from '../autorig';
import { bakeBound, unbakeBound } from '../bake';
import { bindRig, BIND_WORK_SIZE, type BindOptions } from '../bind';
import { magicBones, rigForRedraw, setKind } from '../editing';
import { bindKey, hashPixels, hashString } from '../hash';
import { packStrip, renderClipFrames } from '../render/frames';
import type { AnyCanvas } from '../render/canvas';
import type { LayerPixels, RigData, RigInput } from '../types';
import type { ImageSource, RigReply, RigRequest, RigResponse, RigSource } from './protocol';

class Lru<V> {
  private readonly m = new Map<string, V>();
  constructor(private readonly size: number) {}
  get(k: string): V | undefined {
    const v = this.m.get(k);
    if (v !== undefined) {
      this.m.delete(k);
      this.m.set(k, v);
    }
    return v;
  }
  set(k: string, v: V): void {
    this.m.delete(k);
    this.m.set(k, v);
    while (this.m.size > this.size) this.m.delete(this.m.keys().next().value as string);
  }
  clear(): void {
    this.m.clear();
  }
}

function canvas2d(w: number, h: number): { canvas: AnyCanvas; ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D } {
  const canvas: AnyCanvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!ctx) throw new Error('Canvas 2D is not available');
  return { canvas, ctx };
}

/** Pixels from a blob, a bitmap or pixels (straight alpha). */
export async function toPixels(src: ImageSource | LayerPixels): Promise<LayerPixels> {
  if ('data' in src) return src;
  const bmp = typeof Blob !== 'undefined' && src instanceof Blob ? await createImageBitmap(src, { premultiplyAlpha: 'none' }) : (src as ImageBitmap);
  const { ctx } = canvas2d(bmp.width, bmp.height);
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, bmp.width, bmp.height);
  if (bmp !== src) bmp.close();
  return { data: d.data, width: d.width, height: d.height };
}

async function toInput(src: RigSource): Promise<RigInput> {
  const image = await toPixels(src.image);
  if (!src.layers) return { image };
  const layers: Record<string, LayerPixels> = {};
  for (const [k, v] of Object.entries(src.layers)) {
    const px = await toPixels(v);
    const pos = 'data' in v ? { x: (v as LayerPixels).x, y: (v as LayerPixels).y } : {};
    layers[k] = { ...px, ...pos };
  }
  return { image, layers };
}

/** Hash of the layers that change rigging (lines and parts; shading, sketch... never do). */
function layersKey(input: RigInput): string {
  if (!input.layers) return '';
  const keys = Object.keys(input.layers).filter((k) => !EXCLUDED_LAYERS.includes(k)).sort();
  if (!keys.length) return '';
  return hashString(keys.map((k) => {
    const l = input.layers![k];
    return `${k}@${l.x ?? 0},${l.y ?? 0}:${hashPixels(l)}`;
  }).join('|'));
}

export interface CoreResult {
  response: RigResponse;
  transfer: Transferable[];
}

export interface RigCore {
  handle(req: RigRequest): Promise<CoreResult>;
}

export function createRigCore(): RigCore {
  const analyses = new Lru<Analysis>(8);
  const bakes = new Lru<ArrayBuffer>(12);
  /** Per-request view of the caches for one drawing. */
  const prepare = async (src: RigSource) => {
    const input = await toInput(src);
    const art = hashPixels(input.image);
    const lk = layersKey(input);
    const analyzeCached = (workSize: number): Analysis => {
      const key = `${art}|${lk}|${workSize}`;
      let a = analyses.get(key);
      if (!a) analyses.set(key, (a = analyze(input, { workSize })));
      return a;
    };
    return { input, art, lk, analyzeCached };
  };
  const reply = (r: { rig: RigData; confidence: number; notes: string[]; issues: RigReply['issues']; kept?: boolean }, t0: number): RigReply => ({
    rig: r.rig, confidence: r.confidence, notes: r.notes, issues: r.issues, kept: r.kept, ms: performance.now() - t0,
  });
  const bindCached = (p: Awaited<ReturnType<typeof prepare>>, rig: RigData, opts: BindOptions = {}) => {
    const rest: BindOptions = { ...opts };
    delete rest.analysis;
    const key = `${bindKey({ ...rig, artHash: p.art }, p.lk)}|${JSON.stringify(rest)}`;
    let bake = bakes.get(key);
    const cached = !!bake;
    if (!bake) {
      const bound = bindRig(p.input, { ...rig, artHash: rig.artHash || p.art }, { ...rest, analysis: p.analyzeCached(BIND_WORK_SIZE) });
      bakes.set(key, (bake = bakeBound(bound)));
    }
    // the cache keeps its own copy; the caller gets one to take
    return { bake: bake.slice(0), cached };
  };
  return {
    async handle(req: RigRequest): Promise<CoreResult> {
      const t0 = performance.now();
      switch (req.op) {
        case 'autoRig': {
          const p = await prepare(req.input);
          const r = req.req;
          if (r.previous) {
            const res = rigForRedraw(p.input, r.previous, r.kind, { facing: r.facing, analyze: p.analyzeCached });
            return { response: { op: 'autoRig', reply: reply(res, t0) }, transfer: [] };
          }
          const res = autoRig(p.input, r.kind, { hints: r.hints, tipHints: r.tipHints, unsnapped: r.unsnapped, facing: r.facing, made: r.made, analyze: p.analyzeCached });
          return { response: { op: 'autoRig', reply: reply(res, t0) }, transfer: [] };
        }
        case 'rigAndBind': {
          const p = await prepare(req.input);
          const r = req.req;
          const res = r.previous
            ? rigForRedraw(p.input, r.previous, r.kind, { facing: r.facing, analyze: p.analyzeCached })
            : autoRig(p.input, r.kind, { hints: r.hints, tipHints: r.tipHints, unsnapped: r.unsnapped, facing: r.facing, made: r.made, analyze: p.analyzeCached });
          const { bake } = bindCached(p, res.rig, req.opts);
          return { response: { op: 'rigAndBind', reply: reply(res, t0), bake }, transfer: [bake] };
        }
        case 'bind': {
          const p = await prepare(req.input);
          const { bake, cached } = bindCached(p, req.rig, req.opts);
          return { response: { op: 'bind', bake, ms: performance.now() - t0, cached }, transfer: [bake] };
        }
        case 'setKind': {
          const p = await prepare(req.input);
          const res = setKind(p.input, req.rig, req.kind, { ...req.req, analyze: p.analyzeCached });
          return { response: { op: 'setKind', reply: reply(res, t0) }, transfer: [] };
        }
        case 'magicBones': {
          const p = await prepare(req.input);
          const res = magicBones(p.input, req.rig, { ...req.req, analyze: p.analyzeCached });
          return { response: { op: 'magicBones', reply: reply(res, t0) }, transfer: [] };
        }
        case 'strip': {
          const p = await prepare(req.input);
          const bound = unbakeBound(bindCached(p, req.rig).bake);
          const { packed, ...frameOpts } = req.opts ?? {};
          const strip = renderClipFrames(bound, req.clip, frameOpts);
          if (!strip) throw new Error(`No move called "${req.clip}" for a ${req.rig.kind}`);
          const canvases = packed ? [packStrip(strip)] : strip.frames;
          const frames = await Promise.all(canvases.map((c) => toBitmap(c)));
          const meta = { clip: strip.clip, loop: strip.loop, dur: strip.dur, fps: strip.fps, width: strip.width, height: strip.height, anchorX: strip.anchorX, anchorY: strip.anchorY, scale: strip.scale };
          return { response: { op: 'strip', meta, frames }, transfer: frames };
        }
        case 'clear':
          analyses.clear();
          bakes.clear();
          return { response: { op: 'clear' }, transfer: [] };
      }
    },
  };
}

function toBitmap(c: AnyCanvas): Promise<ImageBitmap> {
  if (typeof OffscreenCanvas !== 'undefined' && c instanceof OffscreenCanvas) return Promise.resolve(c.transferToImageBitmap());
  return createImageBitmap(c);
}

