/**
 * Bring to life (§2.10, §8.4) and keeping drawings safe (§4.4), with fake services: one commit holds every
 * blob the drawing's JSON points at (blobs before JSON), the world's slot and the draft's removal; the
 * footstep comes after the commit; the hot swap carries the bones; drawn-on-the-bones rigs are `parts`;
 * no limbs means one piece; a redraw keeps the bones the student placed.
 */
import { describe, expect, it, vi } from 'vitest';
import { newArtDoc, type ArtExportResult } from '../../src/cores/art';
import type { RigData, RigSource } from '../../src/cores/rig';
import { templateFor } from '../../src/cores/rig';
import { bringToLife, exportRefs, type BringDeps, type BringToLifeInput } from '../../src/draw/api';
import { artIdFor, recordFor, saveDrawing } from '../../src/draw/drafts';
import type { ArtRecord, BlobRef, DeskDraft, World } from '../../src/model/types';
import type { Commit } from '../../src/store/api';
import { MemoryStore } from '../../src/store/memory';
import { sampleWorld } from '../foundation/samples';
import { blobRefOf } from '../../src/model/ids';

const png = (n: number) => new Blob([new Uint8Array([137, 80, 78, 71, n, n + 1, n + 2])], { type: 'image/png' });

function exported(parts: string[] = []): ArtExportResult {
  return {
    flat: { png: png(1), w: 200, h: 180 },
    box: [100, 120, 400, 360],
    scale: 0.5,
    anchor: [100, 178],
    anchorBoard: [300, 476],
    layers: [],
    linesMask: { png: png(2), w: 200, h: 180 },
    parts: parts.map((name, i) => ({ name, png: png(10 + i), w: 200, h: 180 })),
    thumb: { png: png(3), w: 128, h: 115 },
  } as ArtExportResult;
}

interface Calls {
  commits: Commit[];
  order: string[];
  swaps: unknown[];
  rigs: Array<{ source: RigSource; req: Record<string, unknown> }>;
}

function deps(store: MemoryStore, rigReply: (req: Record<string, unknown>) => { rig: RigData; confidence: number; issues: string[] }): { deps: BringDeps; calls: Calls } {
  const calls: Calls = { commits: [], order: [], swaps: [], rigs: [] };
  const commit = store.commit.bind(store);
  store.commit = async (c: Commit) => {
    calls.commits.push(c);
    calls.order.push('commit');
    return commit(c);
  };
  return {
    calls,
    deps: {
      store,
      history: {
        record: vi.fn(async (world: World, step: { text: string }) => {
          calls.order.push(`footstep:${step.text}`);
          return { ...world, steps: [...world.steps, { id: 's_new', at: 1, by: 'student', kind: 'draw', text: step.text }], head: 's_new' } as World;
        }),
      } as unknown as BringDeps['history'],
      player: {
        swapArt: (a) => {
          calls.order.push('swap');
          calls.swaps.push(a);
        },
      },
      rig: async (source, req) => {
        calls.rigs.push({ source, req: req as unknown as Record<string, unknown> });
        const r = rigReply(req as unknown as Record<string, unknown>);
        return { ...r, notes: [] };
      },
      sticker: async () => png(4),
      export: async () => null,
    },
  };
}

function input(o: Partial<BringToLifeInput> = {}): BringToLifeInput {
  return {
    doc: newArtDoc({ name: 'Moon King', kind: 'character', rig: 'blob', width: 64, height: 64, layers: 'freehand' }),
    artId: 'a_moonking01',
    name: 'Moon King',
    kind: 'character',
    rig: 'blob',
    mode: 'free',
    parts: {},
    worldId: 'w_sample0001',
    castKey: 'moonKing',
    shelf: false,
    guideHints: null,
    exported: exported(),
    exportMax: 1024,
    facing: 'left',
    role: 'boss',
    ...o,
  };
}

/** Every blob ref a record's JSON points at. */
function refsOf(rec: ArtRecord): BlobRef[] {
  return [rec.doc, ...rec.cels, ...(rec.export ? exportRefs(rec.export) : [])];
}

describe('Bring to life', () => {
  it('commits every blob with the JSON that points at them, the world slot and the draft, once, then the footstep, then the swap', async () => {
    const store = new MemoryStore();
    const world = sampleWorld();
    await store.commit({ worlds: [world] });
    const draft: DeskDraft = { artId: 'a_moonking01', worldId: world.id, castKey: 'moonKing', doc: '{}', cels: {}, tool: 'ink', at: 5 };
    await store.drafts.put(draft);
    const blob = templateFor('blob', 200, 180, -1);
    const { deps: d, calls } = deps(store, () => ({ rig: blob, confidence: 0.9, issues: [] }));

    const res = await bringToLife(input(), d);

    expect(calls.order).toEqual(['commit', 'footstep:You drew Moon King', 'commit', 'swap']);
    const first = calls.commits[0];
    const inCommit = new Set(await Promise.all((first.blobs ?? []).map((b) => blobRefOf(b))));
    for (const ref of refsOf(res.record)) expect(inCommit.has(ref)).toBe(true);
    expect(first.art?.map((a) => a.id)).toEqual(['a_moonking01']);
    expect(first.worlds?.[0].cast.moonKing).toMatchObject({ art: 'a_moonking01', madeBy: 'student' });
    expect(first.clearDrafts).toEqual(['a_moonking01']);
    expect(await store.drafts.get('a_moonking01')).toBeNull();

    // What the game gets: the flat picture and its bones.
    expect(calls.swaps).toHaveLength(1);
    expect(calls.swaps[0]).toMatchObject({ key: 'moonKing', rig: blob });
    expect(res.record).toMatchObject({ rig: 'blob', facing: 'left', role: 'boss', mode: 'free', version: 1 });
    expect(res.record.rigInfo).toMatchObject({ made: 'auto' });
    expect(res.lowConfidence).toBe(false);
    expect((await store.worlds.get(world.id))?.head).toBe('s_new');
  });

  it('rigs a drawing made on the bones from its parts (made: parts), with the template joints as hints', async () => {
    const store = new MemoryStore();
    await store.commit({ worlds: [sampleWorld()] });
    const biped = templateFor('biped', 200, 180, 0);
    const { deps: d, calls } = deps(store, () => ({ rig: biped, confidence: 0.4, issues: [] }));
    const res = await bringToLife(
      input({
        rig: 'biped',
        mode: 'bones',
        parts: { torso: { colors: 'torso', lines: 'torso-lines' }, head: { colors: 'head', lines: 'head-lines' } },
        exported: exported(['torso', 'head']),
        partHints: { joints: { head: [300, 200] }, tips: { head: [300, 150] } },
        facing: 'viewer',
      }),
      d,
    );
    const req = calls.rigs[0].req;
    expect(req.hints).toEqual({ head: [(300 - 100) * 0.5, (200 - 120) * 0.5] });
    expect(req.unsnapped).toBe('keep');
    expect(Object.keys(calls.rigs[0].source.layers ?? {})).toEqual(['lines', 'part:torso', 'part:head']);
    expect(res.record.rigInfo?.made).toBe('parts');
    // Parts drawn on their bones are trusted: no "check the bones" note.
    expect(res.lowConfidence).toBe(false);
    expect(Object.keys(res.record.export?.parts ?? {})).toEqual(['torso', 'head']);
  });

  it('moves as one piece when no limbs are found (a blob when round)', async () => {
    const store = new MemoryStore();
    await store.commit({ worlds: [sampleWorld()] });
    const { deps: d, calls } = deps(store, (req) =>
      req.kind === 'biped' ? { rig: templateFor('biped', 200, 180, 0), confidence: 0.2, issues: ['no-legs', 'no-arms'] } : { rig: templateFor(req.kind as 'blob', 200, 180, 0), confidence: 1, issues: [] },
    );
    const res = await bringToLife(input({ rig: 'biped', exported: exported() }), d);
    expect(calls.rigs.map((r) => r.req.kind)).toEqual(['biped', 'blob']);
    expect(res.onePiece).toBe(true);
    expect(res.record.rig).toBe('blob');
  });

  it('keeps the bones the student placed when a drawing is drawn again', async () => {
    const store = new MemoryStore();
    await store.commit({ worlds: [sampleWorld()] });
    const placed = { ...templateFor('blob', 200, 180, 0), made: 'hand' as const };
    const { deps: d, calls } = deps(store, () => ({ rig: placed, confidence: 1, issues: [] }));
    await bringToLife(input(), d);
    const stored = await store.art.get('a_moonking01');
    await store.commit({ art: [{ ...(stored as ArtRecord), rigData: placed }] });
    const again = await bringToLife(input(), d);
    expect(calls.rigs[1].req.previous).toEqual(placed);
    expect(again.record.version).toBe(2);
    expect(calls.order.filter((o) => o.startsWith('footstep'))).toEqual(['footstep:You drew Moon King', 'footstep:You drew Moon King again']);
  });

  it('says "Draw something first!" for an empty drawing', async () => {
    const store = new MemoryStore();
    const { deps: d } = deps(store, () => ({ rig: templateFor('blob', 1, 1, 0), confidence: 1, issues: [] }));
    await expect(bringToLife(input({ exported: null }), d)).rejects.toThrow('Draw something first!');
  });
});

describe('keeping drawings safe', () => {
  it('gives a cast member’s drawing a stable id from its world and key', async () => {
    const a = await artIdFor('w_1', 'boss');
    expect(a).toMatch(/^a_[0-9a-z]{10}$/);
    expect(await artIdFor('w_1', 'boss')).toBe(a);
    expect(await artIdFor('w_1', 'hero')).not.toBe(a);
    expect(await artIdFor('w_2', 'boss')).not.toBe(a);
  });

  it('saves a checkpoint in one commit that clears the draft, keeping what games load', async () => {
    const store = new MemoryStore();
    const commits: Commit[] = [];
    const commit = store.commit.bind(store);
    store.commit = async (c: Commit) => {
      commits.push(c);
      return commit(c);
    };
    await store.drafts.put({ artId: 'a_x', worldId: null, castKey: null, doc: '{}', cels: {}, tool: 'ink', at: 1 });
    const doc = newArtDoc({ name: 'Blorp', kind: 'character', rig: 'biped', width: 64, height: 64, layers: 'freehand' });
    const previous = { export: { flat: 'sha256:aa' }, rigData: { kind: 'biped' }, version: 3, createdAt: 7 } as unknown as ArtRecord;
    const rec = await saveDrawing(store, { doc, artId: 'a_x', previous, name: 'Blorp', kind: 'character', rig: 'biped', role: null, facing: 'viewer', mode: 'free', parts: {}, shelf: true });
    expect(commits).toHaveLength(1);
    expect(commits[0].clearDrafts).toEqual(['a_x']);
    expect(await store.drafts.get('a_x')).toBeNull();
    expect(rec).toMatchObject({ export: { flat: 'sha256:aa' }, rigData: { kind: 'biped' }, version: 3, createdAt: 7 });
    const { refs } = await recordFor({ doc, artId: 'a_x', previous: null, name: 'Blorp', kind: 'character', rig: 'biped', role: null, facing: 'viewer', mode: 'free', parts: {}, shelf: true });
    expect(refs).toEqual(rec.cels);
  });
});
