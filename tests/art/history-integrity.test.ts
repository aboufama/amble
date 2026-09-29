/**
 * Undo integrity under the Desk's real timing: old steps are deflated in the background (one tile per
 * worker round trip) while the student keeps working, and a packed tile has to come back from the worker
 * before an undo can use it.
 */
import { describe, expect, it } from 'vitest';
import { Board } from '../../src/art/engine/board';
import { History, entryBytes, tilesOf, type Packer } from '../../src/art/engine/history';
import { makeLayer } from '../../src/art/engine/model';
import { sameBytes } from './helpers';

const F = 'f1';
const L = 'l1';
const W = 128;
const H = 128;

function board(): Board {
  const b = new Board(W, H, false);
  b.layers = [makeLayer(L, 'paint')];
  b.frames = [{ id: F, hold: 1 }];
  return b;
}

/** Paints the whole layer one grey level (a step that touches all four 64 px tiles). */
function paintStep(h: History, b: Board, level: number, label: string): void {
  const all = { x0: 0, y0: 0, x1: W, y1: H };
  const change = h.snapshot(F, L, tilesOf(all, W, H));
  b.pixels(F, L, true).fill(level);
  b.changed(F, L, all);
  h.push({ label, steps: [{ pixels: change }] });
}

/** A stand-in for deflate: a tiny token that remembers the bytes (packing shrinks a tile, like the real one). */
function tokens(): { pack(data: Uint8Array): Uint8Array; unpack(z: Uint8Array): Uint8Array } {
  const kept = new Map<Uint8Array, Uint8Array>();
  return {
    pack(data) {
      const z = new Uint8Array(8);
      kept.set(z, data.slice());
      return z;
    },
    unpack(z) {
      const raw = kept.get(z);
      if (!raw) throw new Error('unknown token');
      return raw.slice();
    },
  };
}

/** A packer whose round trips finish only when the test says so (the worker is busy). */
function slowPacker(): Packer & { waiting: number; releaseAll(): Promise<void> } {
  const queue: Array<() => void> = [];
  const t = tokens();
  const p = {
    get waiting() {
      return queue.length;
    },
    pack: (data: Uint8Array) => new Promise<Uint8Array>((resolve) => queue.push(() => resolve(t.pack(data)))),
    unpack: (z: Uint8Array) => new Promise<Uint8Array>((resolve) => queue.push(() => resolve(t.unpack(z)))),
    async releaseAll() {
      for (let i = 0; i < 1000 && (queue.length || i < 5); i++) {
        queue.shift()?.();
        await new Promise((r) => setTimeout(r, 0));
      }
    },
  };
  return p;
}

const counted = (h: History): number => [...h.undoStack, ...h.redoStack].reduce((n, e) => n + entryBytes(e), 0);

describe('the undo budget while old steps are packed in the background', { timeout: 60_000 }, () => {
  it('stays equal to what the stacks hold when a step is dropped while it is being packed', async () => {
    const b = board();
    const packer = slowPacker();
    const h = new History(b, 1 << 30, packer);
    for (let i = 1; i <= 5; i++) paintStep(h, b, i * 10, `step ${i}`);
    const idle = h.compressIdle(3);
    await new Promise((r) => setTimeout(r, 0));
    expect(packer.waiting).toBe(1); // the oldest step's first tile is at the worker
    // The student keeps going: a tighter budget drops the oldest steps, the one being packed among them.
    h.limitBytes = counted(h) - 1;
    paintStep(h, b, 99, 'step 6');
    expect(h.undoStack.map((e) => e.label)).not.toContain('step 1');
    await packer.releaseAll();
    await idle;
    expect(h.bytes).toBe(counted(h));
  });

  it('stays equal to what the stacks hold when a step is undone while it is being packed', async () => {
    const b = board();
    const packer = slowPacker();
    const h = new History(b, 1 << 30, packer);
    paintStep(h, b, 10, 'first');
    paintStep(h, b, 20, 'second');
    const idle = h.compressIdle(0);
    await new Promise((r) => setTimeout(r, 0));
    expect(packer.waiting).toBe(1);
    const undone = h.undo();
    await packer.releaseAll();
    await Promise.all([idle, undone]);
    expect(h.canRedo).toBe(true);
    expect(h.bytes).toBe(counted(h));
  });
});

describe('an undo whose packed tiles cannot come back', { timeout: 60_000 }, () => {
  it('changes no pixels and keeps the step, so the student can try again', async () => {
    const b = board();
    let unpacks = 0;
    let failSecond = true;
    const t = tokens();
    const packer: Packer = {
      pack: async (data) => t.pack(data),
      unpack: async (z) => {
        unpacks++;
        if (failSecond && unpacks === 2) throw new Error('worker failed');
        return t.unpack(z);
      },
    };
    const h = new History(b, 1 << 30, packer);
    paintStep(h, b, 10, 'grey');
    paintStep(h, b, 200, 'white');
    await h.compressIdle(0);
    const before = b.pixels(F, L)!.slice();
    await expect(h.undo()).rejects.toThrow('worker failed');
    // All or nothing: no tile of the step was put back.
    expect(sameBytes(b.pixels(F, L)!, before)).toBe(true);
    expect(h.labels().undo).toBe('white');
    expect(h.canRedo).toBe(false);
    expect(h.bytes).toBe(counted(h));
    // The worker is back: the same undo works.
    failSecond = false;
    await h.undo();
    expect(b.pixels(F, L)![0]).toBe(10);
    expect(b.pixels(F, L)![(W * H - 1) * 4]).toBe(10);
    expect(h.labels().redo).toBe('white');
  });
});
