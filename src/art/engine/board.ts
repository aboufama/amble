/**
 * The live document: layers x frames of cels. Each cel's pixels are a straight-alpha RGBA8 buffer the size
 * of the board (the source of truth; views mirror them into canvases). Empty cels hold no buffer.
 * Idle frames can be packed (deflated) to stay inside the memory budget and are unpacked on demand.
 */
import type { Rect } from './geom';
import { type ArtFrame, type ArtLayer, LIMITS, isPartRole, uid } from './model';
import { deflate, inflate } from './png';
import { alphaBounds, copyIn, copyOut } from './blend';

export interface Cel {
  /** Board-sized RGBA, or null when empty or packed. */
  data: Uint8ClampedArray | null;
  /** Deflated content box while packed. */
  packed: { box: Rect; bytes: Uint8Array } | null;
  /** Bumped on every change (cache keys for fill analysis, thumbnails and saving). */
  version: number;
}

export type ChangeKind = 'pixels' | 'layers' | 'frames';

export interface BoardListener {
  (kind: ChangeKind, frame: string | null, layer: string | null, rect: Rect | null): void;
}

export const celKey = (frame: string, layer: string): string => `${frame}/${layer}`;

export class Board {
  readonly W: number;
  readonly H: number;
  readonly pixelArt: boolean;
  /**
   * This board instance, for caches that outlive it (the page's engine worker). Cel versions only mean
   * something within one board: a drawing opened again has the same frame and layer ids, and its versions
   * start over, so a key without this could name the old visit's pixels.
   */
  readonly uid = uid('b');
  layers: ArtLayer[] = [];
  frames: ArtFrame[] = [];
  private cels = new Map<string, Cel>();
  private listeners = new Set<BoardListener>();
  /** Frames touched recently, most recent last (for packing). */
  private recent: string[] = [];

  constructor(W: number, H: number, pixelArt: boolean) {
    if (!(W >= 1 && H >= 1 && W <= LIMITS.maxBoard && H <= LIMITS.maxBoard)) throw new Error(`Board size must be 1..${LIMITS.maxBoard} px`);
    this.W = Math.round(W);
    this.H = Math.round(H);
    this.pixelArt = pixelArt;
  }

  listen(fn: BoardListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(kind: ChangeKind, frame: string | null, layer: string | null, rect: Rect | null): void {
    for (const fn of this.listeners) fn(kind, frame, layer, rect);
  }

  layer(id: string): ArtLayer | undefined {
    return this.layers.find((l) => l.id === id);
  }

  layerIndex(id: string): number {
    return this.layers.findIndex((l) => l.id === id);
  }

  frameIndex(id: string): number {
    return this.frames.findIndex((f) => f.id === id);
  }

  maxLayers(): number {
    return this.layers.some((l) => isPartRole(l.role)) ? LIMITS.maxLayersWithParts : LIMITS.maxLayers;
  }

  cel(frame: string, layer: string): Cel {
    const k = celKey(frame, layer);
    let c = this.cels.get(k);
    if (!c) {
      c = { data: null, packed: null, version: 0 };
      this.cels.set(k, c);
    }
    return c;
  }

  hasCel(frame: string, layer: string): boolean {
    const c = this.cels.get(celKey(frame, layer));
    return !!c && (!!c.data || !!c.packed);
  }

  /** The cel's pixels; creates an empty buffer when `create`. Throws for packed cels (unpack first). */
  pixels(frame: string, layer: string, create: true): Uint8ClampedArray;
  pixels(frame: string, layer: string, create?: boolean): Uint8ClampedArray | null;
  pixels(frame: string, layer: string, create = false): Uint8ClampedArray | null {
    const c = this.cel(frame, layer);
    if (c.packed) throw new Error(`Cel ${celKey(frame, layer)} is packed; await board.ensureFrame() first`);
    if (!c.data && create) c.data = new Uint8ClampedArray(this.W * this.H * 4);
    this.touchFrame(frame);
    return c.data;
  }

  /** Replaces a cel's pixels (null = empty). */
  setPixels(frame: string, layer: string, data: Uint8ClampedArray | null): void {
    const c = this.cel(frame, layer);
    c.data = data;
    c.packed = null;
    c.version++;
  }

  /** Records a pixel change in rect (after it happened). */
  changed(frame: string, layer: string, rect: Rect | null): void {
    this.cel(frame, layer).version++;
    this.emit('pixels', frame, layer, rect);
  }

  version(frame: string, layer: string): number {
    return this.cels.get(celKey(frame, layer))?.version ?? 0;
  }

  deleteCel(frame: string, layer: string): Cel | null {
    const k = celKey(frame, layer);
    const c = this.cels.get(k) ?? null;
    this.cels.delete(k);
    return c;
  }

  restoreCel(frame: string, layer: string, cel: Cel | null): void {
    const k = celKey(frame, layer);
    if (cel) {
      cel.version++;
      this.cels.set(k, cel);
    } else this.cels.delete(k);
  }

  /** Every (frame, layer) cel that exists, for saving. */
  entries(): Array<[string, string, Cel]> {
    const out: Array<[string, string, Cel]> = [];
    for (const f of this.frames)
      for (const l of this.layers) {
        const c = this.cels.get(celKey(f.id, l.id));
        if (c && (c.data || c.packed)) out.push([f.id, l.id, c]);
      }
    return out;
  }

  /** Bytes of unpacked pixel buffers. */
  residentBytes(): number {
    let n = 0;
    for (const c of this.cels.values()) if (c.data) n += c.data.length;
    return n;
  }

  private touchFrame(frame: string): void {
    const i = this.recent.lastIndexOf(frame);
    if (i === this.recent.length - 1 && i >= 0) return;
    if (i >= 0) this.recent.splice(i, 1);
    this.recent.push(frame);
  }

  /** Unpacks every cel of a frame (and keeps it recent). */
  async ensureFrame(frame: string): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const l of this.layers) {
      const c = this.cels.get(celKey(frame, l.id));
      if (c?.packed) jobs.push(this.unpack(c));
    }
    await Promise.all(jobs);
    this.touchFrame(frame);
  }

  private async unpack(c: Cel): Promise<void> {
    const p = c.packed;
    if (!p) return;
    const raw = await inflate(p.bytes);
    if (c.packed !== p) return;
    const data = new Uint8ClampedArray(this.W * this.H * 4);
    copyIn(data, this.W, p.box, new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.byteLength));
    c.data = data;
    c.packed = null;
  }

  /**
   * Packs the least recently used frames' cels (never `keep`) until the resident pixels fit the budget.
   * Content is trimmed and deflated; versions do not change.
   */
  async packIdle(keep: ReadonlySet<string>, budget: number = LIMITS.residentCelBytes): Promise<number> {
    let packed = 0;
    for (const frame of [...this.recent]) {
      if (this.residentBytes() <= budget) break;
      if (keep.has(frame)) continue;
      for (const l of this.layers) {
        const c = this.cels.get(celKey(frame, l.id));
        if (!c?.data) continue;
        const data = c.data;
        const box = alphaBounds(data, this.W, this.H);
        const bytes = box ? await deflate(new Uint8Array(copyOut(data, this.W, box).buffer)) : new Uint8Array(0);
        if (c.data !== data) continue; // changed while packing
        c.packed = box ? { box, bytes } : null;
        c.data = null;
        packed++;
      }
      this.recent.splice(this.recent.indexOf(frame), 1);
    }
    return packed;
  }
}
