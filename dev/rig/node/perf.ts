/**
 * Rig timings in Node (warm JIT): auto-rig per working size, and bind when available.
 * Usage: node dev/rig/node/run.mjs perf [sample...]
 */
import { analyze } from '../../../src/rig/analyze';
import { autoRig } from '../../../src/rig/autorig';
import { bindRig, BIND_WORK_SIZE } from '../../../src/rig/bind';
import { SAMPLES } from '../../../src/rig/samples/kid-art';

const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];

export function runPerf(names: string[]): void {
  const defs = names.length ? SAMPLES.filter((s) => names.includes(s.name)) : SAMPLES;
  const drawings = defs.map((d) => d.draw());
  for (let warm = 0; warm < 2; warm++) for (const s of drawings) autoRig(s, s.kind);
  for (const s of drawings) {
    const t = (f: () => void) => {
      const v: number[] = [];
      for (let k = 0; k < 5; k++) {
        const t0 = performance.now();
        f();
        v.push(performance.now() - t0);
      }
      return median(v);
    };
    const a150 = t(() => analyze(s, { workSize: 150 }));
    const a240 = t(() => analyze(s, { workSize: 240 }));
    const rig = t(() => autoRig(s, s.kind));
    const r = autoRig(s, s.kind);
    const a = analyze(s, { workSize: BIND_WORK_SIZE });
    const bind = t(() => bindRig(s, r.rig));
    const rebind = t(() => bindRig(s, r.rig, { analysis: a }));
    console.log(`${s.name.padEnd(10)} ${s.image.width}x${s.image.height} analyze150 ${a150.toFixed(1)}ms analyze240 ${a240.toFixed(1)}ms autoRig ${rig.toFixed(1)}ms bind ${bind.toFixed(1)}ms rebind ${rebind.toFixed(1)}ms`);
  }
}
