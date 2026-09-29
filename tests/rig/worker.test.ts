import { describe, expect, it } from 'vitest';
import { bindRig } from '../../src/rig/bind';
import { createRigWorker, RigWorkerError } from '../../src/rig/worker/client';
import { sample } from './helpers';

describe('the rig worker (inline, as in tests or under a strict CSP)', () => {
  it('rigs and binds like the library, and serves repeats from its cache', async () => {
    const w = createRigWorker({ worker: null });
    const s = sample('dog');
    const r = await w.autoRig({ image: s.image, layers: s.layers }, { kind: 'quadruped' });
    expect(r.rig.kind).toBe('quadruped');
    expect(r.confidence).toBeGreaterThan(0.6);
    const b = await w.bind({ image: s.image, layers: s.layers }, r.rig);
    const direct = bindRig({ image: s.image, layers: s.layers }, r.rig);
    expect(Array.from(b.indices)).toEqual(Array.from(direct.indices));
    const t0 = performance.now();
    const again = await w.bind({ image: s.image, layers: s.layers }, r.rig);
    expect(performance.now() - t0).toBeLessThan(direct.stats.ms);
    expect(Array.from(again.rest)).toEqual(Array.from(b.rest));
    w.terminate();
  }, 60_000);

  it('rigAndBind does both in one round trip; setKind and magicBones re-fit', async () => {
    const w = createRigWorker({ worker: null });
    const s = sample('slime');
    const res = await w.rigAndBind({ image: s.image }, { kind: 'blob' });
    expect(res.bound.rig).toEqual(res.rig);
    expect(res.bake.byteLength).toBeGreaterThan(1000);
    const obj = await w.setKind({ image: s.image }, res.rig, 'object');
    expect(obj.rig.kind).toBe('object');
    const magic = await w.magicBones({ image: s.image }, res.rig);
    expect(magic.rig.kind).toBe('blob');
    w.terminate();
  }, 60_000);

  it('keeps bones through a redraw in the same box', async () => {
    const w = createRigWorker({ worker: null });
    const s = sample('hero');
    const first = await w.autoRig({ image: s.image }, { kind: 'biped' });
    const again = await w.autoRig({ image: s.image }, { kind: 'biped', previous: first.rig });
    expect(again.kept).toBe(true);
    expect(again.rig.bones).toEqual(first.rig.bones);
    w.terminate();
  }, 60_000);

  it('in a lane, the newest request replaces one still waiting', async () => {
    const w = createRigWorker({ worker: null });
    const s = sample('slime');
    const r = await w.autoRig({ image: s.image }, { kind: 'blob' });
    const a = w.bind({ image: s.image }, r.rig, { lane: 'drag' });
    const b = w.bind({ image: s.image }, r.rig, { lane: 'drag', cell: 10 }).catch((e: unknown) => e);
    const c = w.bind({ image: s.image }, r.rig, { lane: 'drag', cell: 12 });
    await expect(a).resolves.toBeTruthy();
    const replaced = await b;
    expect(replaced).toBeInstanceOf(RigWorkerError);
    expect((replaced as RigWorkerError).superseded).toBe(true);
    const last = await c;
    expect(last.stats.cell).toBe(12);
    w.terminate();
  }, 60_000);

  it('reports errors as rejections', async () => {
    const w = createRigWorker({ worker: null });
    const s = sample('slime');
    const r = await w.autoRig({ image: s.image }, { kind: 'blob' });
    await expect(w.strip({ image: s.image }, r.rig, 'walk')).rejects.toBeTruthy();
    w.terminate();
  }, 60_000);
});
