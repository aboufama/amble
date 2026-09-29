/**
 * The engine worker's jobs (fill analysis and regions, history tile packing, PNG encoding), as plain
 * functions: the worker entry calls them, and so does the in-thread fallback when workers are unavailable.
 */
import { type Analysis, type FillParams, type FillResult, analyze, fillRegion, uniformSeed, wallsFromColor } from './fill';
import { deflate, encodePng, inflate } from './png';
import { Board } from './board';
import { type ArtExport, type ExportOptions, exportArt } from './export';
import { encodeCel } from './serialize';
import type { ArtCel, ArtFrame, ArtLayer } from './model';

/** A board shipped to the worker: meta plus copies of the cels' pixels. */
export interface BoardCopy {
  W: number;
  H: number;
  pixelArt: boolean;
  layers: ArtLayer[];
  frames: ArtFrame[];
  cels: Array<{ frame: string; layer: string; data: Uint8ClampedArray }>;
}

export type WorkerRequest =
  | { type: 'analyze'; key: string; W: number; H: number; maxGap: number; walls: Uint8Array }
  | { type: 'fillLines'; key: string; x: number; y: number; params: FillParams; walls?: Uint8Array; W: number; H: number; maxGap: number }
  | { type: 'fillColor'; rgba: Uint8ClampedArray; W: number; H: number; x: number; y: number; tolerance: number; nudge: boolean; params: FillParams }
  | { type: 'pack'; data: Uint8Array }
  | { type: 'unpack'; z: Uint8Array }
  | { type: 'encode'; rgba: Uint8ClampedArray; w: number; h: number }
  | { type: 'encodeCel'; W: number; H: number; frame: string; layer: string; data: Uint8ClampedArray }
  | { type: 'export'; board: BoardCopy; opts: ExportOptions };

export type WorkerResponse =
  | { type: 'analyze'; ms: number }
  | { type: 'fill'; result: FillResult | null; analyzeMs: number }
  | { type: 'pack'; z: Uint8Array }
  | { type: 'unpack'; data: Uint8Array }
  | { type: 'encode'; png: Uint8Array }
  | { type: 'encodeCel'; cel: ArtCel | null }
  | { type: 'export'; result: ArtExport | null };

export function boardFromCopy(c: BoardCopy): Board {
  const b = new Board(c.W, c.H, c.pixelArt);
  b.layers = c.layers;
  b.frames = c.frames;
  for (const cel of c.cels) b.setPixels(cel.frame, cel.layer, cel.data);
  return b;
}

/** Lines analyses by key; the most recent few are kept. */
export class AnalysisCache {
  private map = new Map<string, Analysis>();

  get(key: string): Analysis | undefined {
    return this.map.get(key);
  }

  set(key: string, a: Analysis): void {
    this.map.delete(key);
    this.map.set(key, a);
    while (this.map.size > 3) this.map.delete(this.map.keys().next().value as string);
  }
}

export async function handle(req: WorkerRequest, cache: AnalysisCache): Promise<{ res: WorkerResponse; transfer: ArrayBuffer[] }> {
  switch (req.type) {
    case 'analyze': {
      const a = analyze(req.walls, req.W, req.H, req.maxGap);
      cache.set(req.key, a);
      return { res: { type: 'analyze', ms: a.ms }, transfer: [] };
    }
    case 'fillLines': {
      let a = cache.get(req.key);
      let analyzeMs = 0;
      if (!a) {
        if (!req.walls) throw new Error('fill: analysis missing');
        a = analyze(req.walls, req.W, req.H, req.maxGap);
        analyzeMs = a.ms;
        cache.set(req.key, a);
      }
      const result = fillRegion(a, req.x, req.y, req.params);
      return { res: { type: 'fill', result, analyzeMs }, transfer: result ? [result.mask.buffer as ArrayBuffer, result.under.buffer as ArrayBuffer, result.over.buffer as ArrayBuffer] : [] };
    }
    case 'fillColor': {
      const x = Math.max(0, Math.min(req.W - 1, Math.floor(req.x)));
      const y = Math.max(0, Math.min(req.H - 1, Math.floor(req.y)));
      const [sx, sy] = req.nudge ? uniformSeed(req.rgba, req.W, req.H, x, y, req.tolerance) : [x, y];
      const maxGap = Math.max(...req.params.gaps, req.params.fallbackGap);
      const a = analyze(wallsFromColor(req.rgba, req.W, req.H, sx, sy, req.tolerance), req.W, req.H, maxGap);
      const result = fillRegion(a, sx, sy, req.params);
      return { res: { type: 'fill', result, analyzeMs: a.ms }, transfer: result ? [result.mask.buffer as ArrayBuffer, result.under.buffer as ArrayBuffer, result.over.buffer as ArrayBuffer] : [] };
    }
    case 'pack': {
      const z = await deflate(req.data);
      return { res: { type: 'pack', z }, transfer: [z.buffer as ArrayBuffer] };
    }
    case 'unpack': {
      const data = await inflate(req.z);
      return { res: { type: 'unpack', data }, transfer: [data.buffer as ArrayBuffer] };
    }
    case 'encode': {
      const png = await encodePng(req.rgba, req.w, req.h);
      return { res: { type: 'encode', png }, transfer: [png.buffer as ArrayBuffer] };
    }
    case 'encodeCel': {
      const b = new Board(req.W, req.H, false);
      b.layers = [{ id: req.layer, name: '', role: 'paint', visible: true, locked: false, opacity: 1, blend: 'normal', alphaLock: false }];
      b.frames = [{ id: req.frame, hold: 1 }];
      b.setPixels(req.frame, req.layer, req.data);
      return { res: { type: 'encodeCel', cel: await encodeCel(b, req.frame, req.layer) }, transfer: [] };
    }
    case 'export':
      return { res: { type: 'export', result: await exportArt(boardFromCopy(req.board), req.opts) }, transfer: [] };
  }
}
