/**
 * Undo and redo for everything. Pixel changes store the touched 64x64 tiles as they were before the change
 * (copied from the CPU pixel store at commit: no GPU readback, no hitch at pen-up); the "after" side is
 * captured when the step is first undone (with linear undo that is exactly the state the change produced).
 * All-zero tiles are stored as null. When idle, older steps' tiles are deflated (in the worker), and the
 * stack is capped by bytes, not steps.
 */
import { type Rect, isEmpty, tileAlign, unionInto, emptyRect } from './geom';
import { TILE } from './raster';
import { copyIn, copyOut, isZero } from './blend';
import type { Board } from './board';

type Packed = { z: Uint8Array };
type TileData = Uint8ClampedArray | null | Packed;

export interface TileSnap {
  x: number;
  y: number;
  w: number;
  h: number;
  before: TileData;
  /** Captured on first undo. */
  after?: TileData;
}

export interface PixelChange {
  frame: string;
  layer: string;
  tiles: TileSnap[];
}

/** A structural change (layers, frames) with its inverse. */
export interface StructStep {
  undo: () => void;
  redo: () => void;
  /** Bytes the step keeps alive (a deleted layer's pixels), for the budget. */
  bytes?: number;
}

export type Step = { pixels: PixelChange } | { struct: StructStep };

export interface HistoryEntry {
  label: string;
  /** In the order they happened; undo runs them backwards. */
  steps: Step[];
  /** Coalescing key: consecutive structural entries with the same key within 1.5 s merge (sliders). */
  merge?: string;
  at: number;
  bytes: number;
}

export interface Packer {
  pack(data: Uint8Array): Promise<Uint8Array>;
  unpack(z: Uint8Array): Promise<Uint8Array>;
}

const isPacked = (d: TileData): d is Packed => d !== null && !(d instanceof Uint8ClampedArray);

function tileBytes(d: TileData | undefined): number {
  if (!d) return 16;
  return isPacked(d) ? d.z.length + 16 : d.length + 16;
}

/** Bytes one entry keeps alive (its tiles as they are now, raw or packed, plus struct steps' own). */
export function entryBytes(e: HistoryEntry): number {
  let n = 64;
  for (const s of e.steps) {
    if ('pixels' in s) for (const t of s.pixels.tiles) n += tileBytes(t.before) + tileBytes(t.after);
    else n += s.struct.bytes ?? 0;
  }
  return n;
}

const hasPixels = (e: { steps: Step[] }): boolean => e.steps.some((s) => 'pixels' in s);

/** Tiles (clamped to the board) covering a rect. */
export function tilesOf(r: Rect, W: number, H: number): Rect[] {
  const a = tileAlign(r, TILE, W, H);
  const out: Rect[] = [];
  for (let y = a.y0; y < a.y1; y += TILE) for (let x = a.x0; x < a.x1; x += TILE) out.push({ x0: x, y0: y, x1: Math.min(W, x + TILE), y1: Math.min(H, y + TILE) });
  return out;
}

/** Tiles flagged in a stroke's tile map (TILE-sized cells, row-major, tilesW wide). */
export function tilesFromFlags(flags: Uint8Array, tilesW: number, W: number, H: number): Rect[] {
  const out: Rect[] = [];
  for (let i = 0; i < flags.length; i++) {
    if (!flags[i]) continue;
    const x = (i % tilesW) * TILE;
    const y = Math.floor(i / tilesW) * TILE;
    out.push({ x0: x, y0: y, x1: Math.min(W, x + TILE), y1: Math.min(H, y + TILE) });
  }
  return out;
}

export class History {
  undoStack: HistoryEntry[] = [];
  redoStack: HistoryEntry[] = [];
  bytes = 0;
  private busy: Promise<unknown> = Promise.resolve();

  constructor(
    private board: Board,
    public limitBytes: number,
    private packer: Packer | null = null,
  ) {}

  /** Copies the "before" tiles of (frame, layer) over the given tile rects. Call before changing pixels. */
  snapshot(frame: string, layer: string, tiles: Rect[]): PixelChange {
    const data = this.board.pixels(frame, layer, false);
    const W = this.board.W;
    const snaps: TileSnap[] = [];
    for (const t of tiles) {
      const before = !data || isZero(data, W, t) ? null : copyOut(data, W, t);
      snaps.push({ x: t.x0, y: t.y0, w: t.x1 - t.x0, h: t.y1 - t.y0, before });
    }
    return { frame, layer, tiles: snaps };
  }

  /**
   * Pushes a finished step (clears redo, evicts the oldest steps beyond the byte budget). A step with a
   * `merge` key joins the top step when they match (a slider drag); `o.merge: false` keeps this one separate
   * but still lets the next one join it. Resolves to the entry the step is in (the top one when merged).
   */
  push(e: Omit<HistoryEntry, 'at' | 'bytes'>, o: { merge?: boolean } = {}): HistoryEntry {
    const now = Date.now();
    const top = this.undoStack[this.undoStack.length - 1];
    this.dropRedo();
    if (o.merge !== false && e.merge && top && top.merge === e.merge && now - top.at < 1500 && !hasPixels(e) && !hasPixels(top) && e.steps.length === 1 && top.steps.length === 1) {
      // Coalesce (e.g. an opacity slider): keep the first undo, take the latest redo.
      const a = top.steps[0];
      const b = e.steps[0];
      if ('struct' in a && 'struct' in b) top.steps[0] = { struct: { undo: a.struct.undo, redo: b.struct.redo } };
      top.at = now;
      return top;
    }
    const entry: HistoryEntry = { ...e, at: now, bytes: 0 };
    entry.bytes = entryBytes(entry);
    this.undoStack.push(entry);
    this.bytes += entry.bytes;
    while (this.bytes > this.limitBytes && this.undoStack.length > 1) this.bytes -= this.undoStack.shift()!.bytes;
    return entry;
  }

  private dropRedo(): void {
    for (const r of this.redoStack) this.bytes -= r.bytes;
    this.redoStack = [];
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Undoes the last step; resolves to it (or null). Steps run one at a time. All or nothing: what has to
   * come back first (packed tiles from the worker, packed frames) is fetched before anything changes, so
   * when that fails the pixels are untouched, the step stays where it was and the promise rejects.
   */
  undo(): Promise<HistoryEntry | null> {
    const run = this.busy.then(async () => {
      const at = this.undoStack.length - 1;
      const e = this.undoStack.pop();
      if (!e) return null;
      this.bytes -= e.bytes;
      let src: Map<TileSnap, TileData>;
      try {
        src = await this.fetch(e, 'before');
      } catch (err) {
        this.putBack(this.undoStack, at, e);
        throw err;
      }
      for (let i = e.steps.length - 1; i >= 0; i--) {
        const s = e.steps[i];
        if ('pixels' in s) this.apply(s.pixels, 'before', src);
        else s.struct.undo();
      }
      e.bytes = entryBytes(e);
      this.bytes += e.bytes;
      this.redoStack.push(e);
      return e;
    });
    this.busy = run.catch(() => undefined);
    return run;
  }

  redo(): Promise<HistoryEntry | null> {
    const run = this.busy.then(async () => {
      const at = this.redoStack.length - 1;
      const e = this.redoStack.pop();
      if (!e) return null;
      this.bytes -= e.bytes;
      let src: Map<TileSnap, TileData>;
      try {
        src = await this.fetch(e, 'after');
      } catch (err) {
        this.putBack(this.redoStack, at, e);
        throw err;
      }
      for (const s of e.steps) {
        if ('pixels' in s) this.apply(s.pixels, 'after', src);
        else s.struct.redo();
      }
      e.bytes = entryBytes(e);
      this.bytes += e.bytes;
      this.undoStack.push(e);
      return e;
    });
    this.busy = run.catch(() => undefined);
    return run;
  }

  /** A step whose undo or redo could not run goes back where it was (below anything pushed meanwhile). */
  private putBack(stack: HistoryEntry[], at: number, e: HistoryEntry): void {
    stack.splice(Math.min(at, stack.length), 0, e);
    e.bytes = entryBytes(e);
    this.bytes += e.bytes;
  }

  /**
   * The tile contents a step's `which` side needs, as raw pixels (null = empty), with the frames they go into
   * unpacked: the only waiting an undo or redo does. Raw tiles are taken as they are now, so packing that
   * finishes meanwhile changes nothing.
   */
  private async fetch(e: HistoryEntry, which: 'before' | 'after'): Promise<Map<TileSnap, TileData>> {
    const out = new Map<TileSnap, TileData>();
    for (const s of e.steps) {
      if (!('pixels' in s)) continue;
      const p = s.pixels;
      if (this.board.frameIndex(p.frame) >= 0) await this.board.ensureFrame(p.frame);
      for (const t of p.tiles) {
        const d = t[which];
        if (d === undefined) continue;
        if (d && isPacked(d)) {
          const raw = await this.unpackTile(d);
          out.set(t, new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.byteLength));
        } else out.set(t, d);
      }
    }
    return out;
  }

  /** Writes one side of a pixel change back (synchronously, from what `fetch` got). */
  private apply(p: PixelChange, which: 'before' | 'after', fetched: Map<TileSnap, TileData>): void {
    const b = this.board;
    if (!b.layer(p.layer) || b.frameIndex(p.frame) < 0) return;
    const W = b.W;
    let data = b.pixels(p.frame, p.layer, false);
    const dirty = emptyRect();
    for (const t of p.tiles) {
      const r = { x0: t.x, y0: t.y, x1: t.x + t.w, y1: t.y + t.h };
      if (which === 'before' && t.after === undefined) t.after = !data || isZero(data, W, r) ? null : copyOut(data, W, r);
      if (!fetched.has(t)) continue;
      const src = fetched.get(t) as Uint8ClampedArray | null;
      if (!data) {
        if (!src) continue;
        data = b.pixels(p.frame, p.layer, true);
      }
      copyIn(data, W, r, src);
      unionInto(dirty, r);
    }
    if (!isEmpty(dirty)) b.changed(p.frame, p.layer, dirty);
  }

  private unpackTile(d: Packed): Promise<Uint8Array> {
    if (!this.packer) throw new Error('history: packed tile without a packer');
    return this.packer.unpack(d.z);
  }

  /**
   * Deflates raw tiles of all but the newest `keepRaw` steps, one tile per worker round trip (so the main
   * thread is never held). Stops early when `stop()` says so; resolves to true when nothing is left.
   */
  async compressIdle(keepRaw = 3, stop: () => boolean = () => false): Promise<boolean> {
    if (!this.packer) return true;
    const stacks = [this.undoStack.slice(0, Math.max(0, this.undoStack.length - keepRaw)), this.redoStack.slice(0, Math.max(0, this.redoStack.length - keepRaw))];
    for (const list of stacks)
      for (const e of list) {
        let changed = false;
        try {
          for (const s of e.steps) {
            if (!('pixels' in s)) continue;
            for (const t of s.pixels.tiles) {
              if (stop()) return false;
              for (const k of ['before', 'after'] as const) {
                const d = t[k];
                if (!d || isPacked(d)) continue;
                let z: Uint8Array;
                try {
                  z = await this.packer.pack(new Uint8Array(d.buffer, d.byteOffset, d.byteLength));
                } catch {
                  // The worker went away: the tile stays raw, and packing picks up again next time.
                  return false;
                }
                if (t[k] !== d) continue;
                t[k] = { z };
                changed = true;
              }
            }
          }
        } finally {
          if (changed) this.recount(e);
        }
      }
    return true;
  }

  /**
   * Re-measures an entry whose tiles changed form. Packing runs alongside undo, redo and new steps, so the
   * entry may have left the stacks meanwhile (dropped, or in the middle of an undo): the total counts it
   * only while it is on a stack, and whoever puts it back counts it then.
   */
  private recount(e: HistoryEntry): void {
    const before = e.bytes;
    e.bytes = entryBytes(e);
    if (this.undoStack.includes(e) || this.redoStack.includes(e)) this.bytes += e.bytes - before;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.bytes = 0;
  }

  /** Labels for the UI's undo/redo buttons. */
  labels(): { undo: string | null; redo: string | null } {
    return { undo: this.undoStack[this.undoStack.length - 1]?.label ?? null, redo: this.redoStack[this.redoStack.length - 1]?.label ?? null };
  }
}
