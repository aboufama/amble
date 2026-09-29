/**
 * Shows the colour region flooded from a working pixel (as the pins see it): 'R' region, ':' ink,
 * 'o' other solid. Usage: node dev/rig/node/run.mjs region <sample> <workSize> <x> <y> <x0> <y0> <x1> <y1>
 */
import { analyze } from '../../../src/rig/analyze';
import { colourDist } from '../../../src/rig/fit/common';
import { SAMPLES } from '../../../src/rig/samples/kid-art';

export function runRegion(args: string[]): void {
  const [name, size, xs, ys, x0s, y0s, x1s, y1s] = args;
  const s = SAMPLES.find((d) => d.name === name)!.draw();
  const a = analyze(s, { workSize: Number(size) });
  const { w, solid, ink, holes } = a;
  const start = Number(ys) * w + Number(xs);
  const R = new Uint8Array(w * a.h);
  const q = [start];
  R[start] = 1;
  for (let qi = 0; qi < q.length; qi++) {
    const p = q[qi];
    for (const n of [p - 1, p + 1, p - w, p + w]) {
      if (R[n] || !solid[n] || ink[n] || holes[n] || colourDist(a, p, n) > 40) continue;
      R[n] = 1;
      q.push(n);
    }
  }
  console.log(`region size ${q.length} of ${a.area}`);
  const [x0, y0, x1, y1] = [x0s, y0s, x1s, y1s].map(Number);
  for (let y = y0; y <= y1; y++) {
    let row = `${String(y).padStart(3)} `;
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      row += R[i] ? 'R' : ink[i] ? ':' : solid[i] ? 'o' : ' ';
    }
    console.log(row);
  }
}
