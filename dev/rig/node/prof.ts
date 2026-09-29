/** Bind stage timings (warm, median of 5). Usage: node dev/rig/node/run.mjs prof [sample...] */
import { analyze } from '../../../src/rig/analyze';
import { autoRig } from '../../../src/rig/autorig';
import { bindRig, BIND_WORK_SIZE } from '../../../src/rig/bind';
import { SAMPLES } from '../../../src/rig/samples/kid-art';

export function runProf(names: string[]): void {
  const defs = names.length ? SAMPLES.filter((s) => names.includes(s.name)) : SAMPLES;
  for (const def of defs) {
    const s = def.draw();
    const r = autoRig(s, s.kind);
    const a = analyze(s, { workSize: BIND_WORK_SIZE });
    const runs: Record<string, number[]> = {};
    for (let k = 0; k < 6; k++) {
      const b = bindRig(s, r.rig, { analysis: a });
      if (k === 0) continue;
      for (const [st, v] of Object.entries(b.stats.stages ?? {})) (runs[st] ??= []).push(v);
      (runs.total ??= []).push(b.stats.ms);
    }
    const med = (v: number[]) => [...v].sort((p, q) => p - q)[Math.floor(v.length / 2)];
    console.log(`${def.name.padEnd(10)} ${s.image.width}x${s.image.height} ` + Object.entries(runs).map(([k, v]) => `${k} ${med(v).toFixed(1)}`).join('  '));
  }
}
