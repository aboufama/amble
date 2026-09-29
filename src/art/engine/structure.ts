/**
 * Layer and frame operations. Each applies its change to the board and returns the steps to undo and redo
 * it, so every operation is undoable (deleted layers keep their pixels in the history).
 */
import { type Rect, emptyRect, isEmpty, unionInto } from './geom';
import type { Board, Cel } from './board';
import { alphaBounds, compositeLayer } from './blend';
import type { ArtFrame, ArtLayer } from './model';
import { type PixelChange, type Step, type StructStep, tilesOf } from './history';

/** Takes a "before" snapshot of tiles (the history's `snapshot`; a no-op for headless replay). */
export type Snapshotter = (frame: string, layer: string, tiles: Rect[]) => PixelChange;

export const noSnapshot: Snapshotter = (frame, layer) => ({ frame, layer, tiles: [] });

const celBytes = (c: Cel | null): number => (c?.data ? c.data.length : c?.packed ? c.packed.bytes.length : 0);

export interface SizedStructStep extends StructStep {
  /** Bytes the step keeps alive (for the history budget). */
  bytes: number;
}

function step(undo: () => void, redo: () => void, bytes = 0): SizedStructStep {
  return { undo, redo, bytes };
}

export function addLayer(board: Board, layer: ArtLayer, index: number): SizedStructStep {
  const redo = (): void => {
    board.layers.splice(Math.max(0, Math.min(board.layers.length, index)), 0, { ...layer });
    board.emit('layers', null, layer.id, null);
  };
  const undo = (): void => {
    const i = board.layerIndex(layer.id);
    if (i >= 0) board.layers.splice(i, 1);
    for (const f of board.frames) board.deleteCel(f.id, layer.id);
    board.emit('layers', null, layer.id, null);
  };
  redo();
  return step(undo, redo);
}

export function removeLayer(board: Board, id: string): SizedStructStep | null {
  const index = board.layerIndex(id);
  if (index < 0) return null;
  const meta = board.layers[index];
  const cels = board.frames.map((f) => [f.id, board.deleteCel(f.id, id)] as const);
  const redo = (): void => {
    const i = board.layerIndex(id);
    if (i >= 0) board.layers.splice(i, 1);
    for (const f of board.frames) board.deleteCel(f.id, id);
    board.emit('layers', null, id, null);
  };
  const undo = (): void => {
    board.layers.splice(index, 0, meta);
    for (const [f, c] of cels) board.restoreCel(f, id, c);
    board.emit('layers', null, id, null);
  };
  redo();
  return step(undo, redo, cels.reduce((n, [, c]) => n + celBytes(c), 0));
}

export function moveLayer(board: Board, id: string, index: number): SizedStructStep | null {
  const from = board.layerIndex(id);
  const to = Math.max(0, Math.min(board.layers.length - 1, index));
  if (from < 0 || from === to) return null;
  const move = (a: number, b: number) => (): void => {
    const [l] = board.layers.splice(a, 1);
    board.layers.splice(b, 0, l);
    board.emit('layers', null, id, null);
  };
  const redo = move(from, to);
  redo();
  return step(move(to, from), redo);
}

export function setLayer(board: Board, id: string, patch: Partial<Omit<ArtLayer, 'id'>>): SizedStructStep | null {
  const l = board.layer(id);
  if (!l) return null;
  const before: Partial<ArtLayer> = {};
  for (const k of Object.keys(patch) as (keyof typeof patch)[]) (before as Record<string, unknown>)[k] = l[k];
  const apply = (p: Partial<ArtLayer>) => (): void => {
    const cur = board.layer(id);
    if (!cur) return;
    Object.assign(cur, p);
    board.emit('layers', null, id, null);
  };
  const redo = apply(patch);
  redo();
  return step(apply(before), redo);
}

export function duplicateLayer(board: Board, id: string, copy: ArtLayer, index: number): SizedStructStep | null {
  if (!board.layer(id)) return null;
  const redo = (): void => {
    board.layers.splice(Math.max(0, Math.min(board.layers.length, index)), 0, { ...copy });
    for (const f of board.frames) {
      const c = board.cel(f.id, id);
      if (c.data) board.setPixels(f.id, copy.id, c.data.slice());
      else if (c.packed) board.restoreCel(f.id, copy.id, { data: null, packed: { box: { ...c.packed.box }, bytes: c.packed.bytes }, version: 0 });
    }
    board.emit('layers', null, copy.id, null);
  };
  const undo = (): void => {
    const i = board.layerIndex(copy.id);
    if (i >= 0) board.layers.splice(i, 1);
    for (const f of board.frames) board.deleteCel(f.id, copy.id);
    board.emit('layers', null, copy.id, null);
  };
  redo();
  return step(undo, redo);
}

/** Merges layer `id` into the layer below it (every frame), then removes it. */
export async function mergeDown(board: Board, id: string, snap: Snapshotter): Promise<Step[] | null> {
  const i = board.layerIndex(id);
  if (i <= 0) return null;
  const upper = board.layers[i];
  const lower = board.layers[i - 1];
  const steps: Step[] = [];
  for (const f of board.frames) {
    await board.ensureFrame(f.id);
    const src = board.pixels(f.id, upper.id);
    if (!src) continue;
    const box = alphaBounds(src, board.W, board.H);
    if (!box) continue;
    steps.push({ pixels: snap(f.id, lower.id, tilesOf(box, board.W, board.H)) });
    const dst = board.pixels(f.id, lower.id, true);
    compositeLayer(dst, src, board.W, board.H, box, upper.opacity, upper.blend);
    board.changed(f.id, lower.id, box);
  }
  const rm = removeLayer(board, id);
  if (rm) steps.push({ struct: rm });
  return steps;
}

/** Clears a layer in one frame (or all frames). */
export async function clearLayer(board: Board, id: string, frame: string | null, snap: Snapshotter): Promise<Step[]> {
  const steps: Step[] = [];
  for (const f of board.frames) {
    if (frame && f.id !== frame) continue;
    await board.ensureFrame(f.id);
    const d = board.pixels(f.id, id);
    if (!d) continue;
    const box = alphaBounds(d, board.W, board.H);
    if (!box) continue;
    steps.push({ pixels: snap(f.id, id, tilesOf(box, board.W, board.H)) });
    for (let y = box.y0; y < box.y1; y++) d.fill(0, (y * board.W + box.x0) * 4, (y * board.W + box.x1) * 4);
    board.changed(f.id, id, box);
  }
  return steps;
}

export function addFrame(board: Board, frame: ArtFrame, index: number, copyOf: string | null): SizedStructStep {
  const redo = (): void => {
    board.frames.splice(Math.max(0, Math.min(board.frames.length, index)), 0, { ...frame });
    if (copyOf)
      for (const l of board.layers) {
        const c = board.cel(copyOf, l.id);
        if (c.data) board.setPixels(frame.id, l.id, c.data.slice());
        else if (c.packed) board.restoreCel(frame.id, l.id, { data: null, packed: { box: { ...c.packed.box }, bytes: c.packed.bytes }, version: 0 });
      }
    board.emit('frames', frame.id, null, null);
  };
  const undo = (): void => {
    const i = board.frameIndex(frame.id);
    if (i >= 0) board.frames.splice(i, 1);
    for (const l of board.layers) board.deleteCel(frame.id, l.id);
    board.emit('frames', frame.id, null, null);
  };
  redo();
  return step(undo, redo);
}

export function removeFrame(board: Board, id: string): SizedStructStep | null {
  const index = board.frameIndex(id);
  if (index < 0 || board.frames.length <= 1) return null;
  const meta = board.frames[index];
  const cels = board.layers.map((l) => [l.id, board.deleteCel(id, l.id)] as const);
  const redo = (): void => {
    const i = board.frameIndex(id);
    if (i >= 0) board.frames.splice(i, 1);
    for (const l of board.layers) board.deleteCel(id, l.id);
    board.emit('frames', id, null, null);
  };
  const undo = (): void => {
    board.frames.splice(index, 0, meta);
    for (const [l, c] of cels) board.restoreCel(id, l, c);
    board.emit('frames', id, null, null);
  };
  redo();
  return step(undo, redo, cels.reduce((n, [, c]) => n + celBytes(c), 0));
}

export function moveFrame(board: Board, id: string, index: number): SizedStructStep | null {
  const from = board.frameIndex(id);
  const to = Math.max(0, Math.min(board.frames.length - 1, index));
  if (from < 0 || from === to) return null;
  const move = (a: number, b: number) => (): void => {
    const [f] = board.frames.splice(a, 1);
    board.frames.splice(b, 0, f);
    board.emit('frames', id, null, null);
  };
  const redo = move(from, to);
  redo();
  return step(move(to, from), redo);
}

export function setFrameHold(board: Board, id: string, hold: number): SizedStructStep | null {
  const f = board.frames.find((x) => x.id === id);
  if (!f) return null;
  const prev = f.hold;
  const next = Math.max(1, Math.min(48, Math.round(hold)));
  const set = (v: number) => (): void => {
    const cur = board.frames.find((x) => x.id === id);
    if (cur) cur.hold = v;
    board.emit('frames', id, null, null);
  };
  const redo = set(next);
  redo();
  return step(set(prev), redo);
}

/** The union of the boxes of all pixel steps (for redrawing after undo). */
export function stepsRect(steps: Step[]): Rect {
  const r = emptyRect();
  for (const s of steps)
    if ('pixels' in s)
      for (const t of s.pixels.tiles) unionInto(r, { x0: t.x, y0: t.y, x1: t.x + t.w, y1: t.y + t.h });
  return isEmpty(r) ? emptyRect() : r;
}
