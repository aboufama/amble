/**
 * Bring to life goes before the Desk's previews (§2.10): the rig worker runs one request at a time, and lanes
 * only replace their own waiting request, so the previews' queued rig jobs used to run first. Bring to life
 * drops them: the drawing comes alive at once, and the previews keep their picture.
 */
import { describe, expect, it, vi } from 'vitest';
import { newArtDoc, type ArtExportResult } from '../../src/cores/art';
import { templateFor } from '../../src/cores/rig';
import { bringToLife, type BringDeps } from '../../src/draw/api';
import { isPreviewLane, PREVIEW_LANE } from '../../src/draw/preview';
import { createHistory } from '../../src/history/api';
import type { CharacterKind } from '../../src/model/types';
import { createRigWorker, RigWorkerError } from '../../src/rig/worker/client';
import type { WorkerAnswer, WorkerCall } from '../../src/rig/worker/protocol';
import { MemoryStore } from '../../src/store/memory';

/** A worker the test answers by hand: what was posted, in order, and `answer()` for the one running. */
function fakeWorker() {
  const posted: WorkerCall[] = [];
  const worker = {
    postMessage: (c: WorkerCall) => posted.push(c),
    terminate: () => undefined,
    onmessage: null as ((e: MessageEvent<WorkerAnswer>) => void) | null,
    onerror: null,
  };
  const answer = () => {
    const call = posted[posted.length - 1];
    const kind = (call.request as { req: { kind: CharacterKind } }).req.kind;
    worker.onmessage?.({ data: { id: call.id, ok: true, response: { op: 'autoRig', reply: { rig: templateFor(kind, 100, 100), confidence: 1, notes: [], issues: [] } } } } as unknown as MessageEvent<WorkerAnswer>);
  };
  const kinds = () => posted.map((c) => (c.request as { req: { kind: CharacterKind } }).req.kind);
  return { worker: worker as unknown as Worker, answer, kinds };
}

const image = new Blob([new Uint8Array([1])], { type: 'image/png' });

describe("the rig worker's queue", () => {
  it("drops the previews' waiting jobs, never the one running or other lanes, so Bring to life goes next", async () => {
    const f = fakeWorker();
    const w = createRigWorker({ worker: f.worker });
    const running = w.autoRig({ image }, { kind: 'blob', lane: PREVIEW_LANE });
    const bind = w.autoRig({ image }, { kind: 'biped', lane: 'preview-7' }).catch((e: unknown) => e);
    const strip = w.autoRig({ image }, { kind: 'quadruped', lane: 'strip:walk' });
    const again = w.autoRig({ image }, { kind: 'flyer', lane: PREVIEW_LANE }).catch((e: unknown) => e);
    expect(f.kinds()).toEqual(['blob']);

    // Bring to life starts.
    expect(w.drop(isPreviewLane)).toBe(2);
    for (const dropped of [await bind, await again]) {
      expect(dropped).toBeInstanceOf(RigWorkerError);
      expect((dropped as RigWorkerError).superseded).toBe(true);
    }
    const bring = w.autoRig({ image }, { kind: 'object', lane: 'bring:a_x' });

    f.answer();
    await expect(running).resolves.toBeTruthy();
    f.answer();
    await expect(strip).resolves.toBeTruthy();
    f.answer();
    await expect(bring).resolves.toMatchObject({ rig: { kind: 'object' } });
    // The previews' jobs never reached the worker.
    expect(f.kinds()).toEqual(['blob', 'quadruped', 'object']);
    expect(w.drop(isPreviewLane)).toBe(0);
  });

  it("knows the Desk previews' lanes", () => {
    expect(isPreviewLane(PREVIEW_LANE)).toBe(true);
    expect(isPreviewLane('preview-3')).toBe(true);
    expect(isPreviewLane('bring:a_x')).toBe(false);
    expect(isPreviewLane('bones-fit')).toBe(false);
    expect(isPreviewLane('strip:abc:walk')).toBe(false);
  });
});

describe('Bring to life', () => {
  it("drops the previews' waiting rig jobs before asking for its own bones", async () => {
    const order: string[] = [];
    const deps: BringDeps = {
      store: new MemoryStore(),
      history: createHistory(),
      player: null,
      rig: vi.fn(async () => {
        order.push('rig');
        return { rig: templateFor('blob', 200, 180), confidence: 0.9, notes: [], issues: [] };
      }),
      sticker: async () => new Blob([new Uint8Array([137, 80, 78, 71, 4])], { type: 'image/png' }),
      export: async () => null,
      dropPreviews: () => order.push('drop'),
    };
    const png = (n: number) => new Blob([new Uint8Array([137, 80, 78, 71, n])], { type: 'image/png' });
    const exported = { flat: { png: png(1), w: 200, h: 180 }, box: [0, 0, 400, 360], scale: 0.5, anchor: [100, 178], anchorBoard: [200, 356], layers: [], linesMask: null, parts: [], thumb: { png: png(3), w: 128, h: 115 } } as unknown as ArtExportResult;
    const doc = newArtDoc({ name: 'Blorp', kind: 'character', rig: 'blob', width: 64, height: 64, layers: 'freehand' });
    await bringToLife({ doc, artId: null, name: 'Blorp', kind: 'character', rig: 'blob', mode: 'free', parts: {}, worldId: null, castKey: null, shelf: true, guideHints: null, exported }, deps);
    expect(order).toEqual(['drop', 'rig']);
  });
});
