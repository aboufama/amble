/** Ad-hoc probes of the analysis internals. Usage: node dev/rig/node/run.mjs probe closeLegs 240 */
import { analyze } from '../../../src/rig/analyze';
import { SAMPLES } from '../../../src/rig/samples/kid-art';

export function runProbe(args: string[]): void {
  const [name, size] = args;
  const s = SAMPLES.find((d) => d.name === name)!.draw();
  const a = analyze(s, { workSize: Number(size ?? 150) });
  let sk = 0, so = 0, holes = 0;
  for (let i = 0; i < a.w * a.h; i++) {
    sk += a.skel[i];
    so += a.solid[i];
    holes += a.holes[i];
  }
  console.log(`w=${a.w} h=${a.h} solid=${so} skel=${sk} holes=${holes} ends=${a.ends.length} pruned=${a.pruned} strokeW=${a.strokeW.toFixed(2)} limbR=${a.limbR.toFixed(2)}`);
  for (const e of a.ends) console.log(`  end tip=(${e.tipX.toFixed(0)},${e.tipY.toFixed(0)}) len=${e.len.toFixed(1)} junction=${e.junction} thick=${e.thick.toFixed(1)} bulk=${e.bulk.toFixed(1)}`);
}
