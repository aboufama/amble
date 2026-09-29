/** Shared fixtures: each sample drawn, auto-rigged and bound once per test file. */
import { autoRig, type AutoRigResult } from '../../src/rig/autorig';
import { bindRig } from '../../src/rig/bind';
import { SAMPLES, type SampleDrawing } from '../../src/rig/samples/kid-art';
import type { BoundRig } from '../../src/rig/types';

const drawings = new Map<string, SampleDrawing>();
const rigs = new Map<string, AutoRigResult>();
const binds = new Map<string, BoundRig>();

export function sample(name: string): SampleDrawing {
  let s = drawings.get(name);
  if (!s) {
    const def = SAMPLES.find((d) => d.name === name);
    if (!def) throw new Error(`no sample ${name}`);
    drawings.set(name, (s = def.draw()));
  }
  return s;
}

export function rigged(name: string): AutoRigResult {
  let r = rigs.get(name);
  if (!r) {
    const s = sample(name);
    rigs.set(name, (r = autoRig(s, s.kind)));
  }
  return r;
}

export function bound(name: string): BoundRig {
  let b = binds.get(name);
  if (!b) {
    const r = rigged(name);
    binds.set(name, (b = bindRig(sample(name), r.rig, { analysis: r.analysis })));
  }
  return b;
}

export const SAMPLE_NAMES = SAMPLES.map((d) => d.name);
