/**
 * The art barrel over the merged engine (§8.2): a blank drawing loads as a valid ArtDoc, a script replays
 * through the real brushes, export gives a trimmed PNG with its anchor and ink mask (null when empty),
 * and the storage split keeps cels content-addressed and the stroke log apart.
 */
import { describe, expect, it } from 'vitest';
import {
  ART_CORE,
  deserializeArtDoc,
  exportArt,
  newArtDoc,
  packArtDoc,
  readLog,
  replayArtScript,
  serializeArtDoc,
  unpackArtDoc,
  validateArtDoc,
  validateArtScript,
  type ArtScript,
} from '../../src/cores/art';

/** A small round character: an ink ring, a fill under the lines, and a smile. */
function blob(): ArtScript {
  const ring: [number, number, number][] = [];
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    ring.push([64 + 36 * Math.cos(a), 70 + 36 * Math.sin(a), 0.8]);
  }
  return {
    v: 1,
    name: 'barrel-blob',
    kind: 'character',
    rig: 'blob',
    width: 128,
    height: 128,
    layers: [
      { id: 'colors', role: 'colors' },
      { id: 'lines', role: 'lines' },
    ],
    ops: [
      { op: 'stroke', layer: 'lines', brush: 'ink', size: 4, color: '#2b1d16', points: ring },
      { op: 'fill', layer: 'colors', x: 64, y: 70, color: '#7cc95a', underLines: true },
      { op: 'stroke', layer: 'lines', brush: 'ink', size: 3, color: '#2b1d16', points: [[50, 80, 0.6], [64, 90, 0.9], [78, 80, 0.6]] },
    ],
  };
}

describe('art barrel', () => {
  it('is wired to the real engine', () => {
    expect(ART_CORE).toBe('real');
  });

  it('makes blank drawings the engine accepts', () => {
    const free = newArtDoc({ name: 'Blorp', kind: 'character', rig: 'biped', width: 1024, height: 1024 });
    expect(validateArtDoc(free)).toEqual([]);
    expect(free.layers.map((l) => [l.role, l.visible])).toEqual([
      ['sketch', false],
      ['colors', true],
      ['lines', true],
    ]);
    expect(newArtDoc({ name: 'Doodle', kind: 'character', width: 800, height: 800, layers: 'dock' }).layers.map((l) => l.role)).toEqual(['colors', 'lines']);
    expect(newArtDoc({ name: 'Pix', kind: 'item', width: 32, height: 32, pixelArt: true }).layers.map((l) => l.role)).toEqual(['paint']);
    expect(newArtDoc({ name: 'Big', kind: 'background', width: 5000, height: 1080 }).width).toBe(2048);
  });

  it('exports nothing for an empty drawing', async () => {
    expect(await exportArt(newArtDoc({ name: 'Empty', kind: 'character', width: 64, height: 64 }), { maxSide: 1024 })).toBeNull();
  });

  it('replays a script and exports it with an anchor at the feet and an ink mask', async () => {
    expect(validateArtScript(blob())).toEqual([]);
    const doc = await replayArtScript(blob());
    expect(doc.cels.length).toBeGreaterThanOrEqual(2);
    expect(doc.strokeLog).not.toBeNull();
    const exported = await exportArt(doc, { maxSide: 1024, scale: 1 });
    expect(exported).not.toBeNull();
    const art = exported!;
    expect(art.flat.png.type).toBe('image/png');
    expect(art.flat.w).toBeGreaterThan(60);
    expect(art.flat.w).toBeLessThanOrEqual(128);
    // A character stands on its feet: the anchor is at the bottom of the trimmed image.
    expect(art.anchor[1]).toBeGreaterThan(art.flat.h * 0.8);
    expect(art.linesMask).not.toBeNull();
    expect(art.thumb.w).toBeGreaterThan(0);
    const small = await exportArt(doc, { maxSide: 32 });
    expect(Math.max(small!.flat.w, small!.flat.h)).toBeLessThanOrEqual(32);
  });

  it('exports the body parts asked for with pairs (drawing on the bones), each part over its colours', async () => {
    const ring = (cx: number, cy: number, r: number): [number, number, number][] =>
      Array.from({ length: 33 }, (_, i) => [cx + r * Math.cos((i / 32) * Math.PI * 2), cy + r * Math.sin((i / 32) * Math.PI * 2), 0.8]);
    const script: ArtScript = {
      v: 1,
      name: 'barrel-parts',
      kind: 'character',
      rig: 'blob',
      width: 128,
      height: 128,
      layers: [
        { id: 'body', role: 'part:body' },
        { id: 'body-lines', role: 'lines' },
        { id: 'head', role: 'part:head' },
        { id: 'head-lines', role: 'lines' },
      ],
      ops: [
        { op: 'stroke', layer: 'body-lines', brush: 'ink', size: 4, color: '#2b1d16', points: ring(64, 88, 26) },
        { op: 'fill', layer: 'body', x: 64, y: 88, color: '#7cc95a' },
        { op: 'stroke', layer: 'head-lines', brush: 'ink', size: 4, color: '#2b1d16', points: ring(64, 40, 18) },
        { op: 'fill', layer: 'head', x: 64, y: 40, color: '#ffd23f' },
      ],
    };
    expect(validateArtScript(script)).toEqual([]);
    const doc = await replayArtScript(script);
    const pairs = [
      { name: 'body', layers: ['body', 'body-lines'] },
      { name: 'head', layers: ['head', 'head-lines'] },
    ];
    const withParts = (await exportArt(doc, { maxSide: 1024, scale: 1, pairs }))!;
    expect(withParts.parts.map((p) => p.name)).toEqual(['body', 'head']);
    for (const p of withParts.parts) {
      expect(p.png.type).toBe('image/png');
      expect([p.w, p.h]).toEqual([withParts.flat.w, withParts.flat.h]);
    }
    expect((await exportArt(doc, { maxSide: 1024, scale: 1 }))!.parts).toEqual([]);
    // Parts come even with a flat-only export (the rigger reads them).
    expect((await exportArt(doc, { maxSide: 1024, flatOnly: true, pairs }))!.parts.map((p) => p.name)).toEqual(['body', 'head']);
  });

  it('splits a drawing for storage and rebuilds it (the stroke log kept apart)', async () => {
    const doc = await replayArtScript(blob());
    const stored = await serializeArtDoc(doc);
    expect(stored.cels).toHaveLength(doc.cels.length);
    expect(stored.json.cels.every((c) => /^sha256:[0-9a-f]{64}$/.test(c.ref))).toBe(true);
    expect(JSON.stringify(stored.json)).not.toContain('strokeLog');
    expect(stored.strokeLog).toBe(doc.strokeLog);
    const blobs = new Map(stored.cels.map((c) => [c.ref, c.blob]));
    const back = await deserializeArtDoc(stored.docBlob, async (ref) => blobs.get(ref) ?? null);
    expect(back.strokeLog).toBeNull();
    expect(validateArtDoc(back)).toEqual([]);
    expect((await serializeArtDoc(back)).docRef).toBe(stored.docRef);
    const withLog = await deserializeArtDoc(stored.json, async (ref) => blobs.get(ref) ?? null, [new Uint8Array(await stored.strokeLog!.arrayBuffer())]);
    expect((await readLog(withLog))?.length).toBe((await readLog(doc))?.length);
  });

  it('packs a drawing into one file and back', async () => {
    const doc = await replayArtScript(blob());
    const bytes = await packArtDoc(doc);
    const back = await unpackArtDoc(bytes);
    expect(back.cels.map((c) => [c.layer, c.w, c.h])).toEqual(doc.cels.map((c) => [c.layer, c.w, c.h]));
  });
});
