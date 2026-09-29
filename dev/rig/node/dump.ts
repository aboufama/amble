/** Prints the auto-rig of samples as JSON (bones in art px). Usage: node dev/rig/node/run.mjs dump fish */
import { autoRig } from '../../../src/rig/autorig';
import { SAMPLES } from '../../../src/rig/samples/kid-art';

export function runDump(names: string[]): void {
  for (const def of SAMPLES.filter((s) => names.includes(s.name))) {
    const s = def.draw();
    const r = autoRig(s, s.kind);
    console.log(def.name, JSON.stringify({ anchor: r.rig.anchor, facing: r.rig.facing, bones: r.rig.bones.map((b) => `${b.name}<${b.parent}> ${b.x},${b.y} -> ${b.x2},${b.y2}`) }, null, 1));
  }
}
