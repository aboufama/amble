/**
 * ASCII view of a window of the analysis: '#' skeleton, 'o' solid, ':' ink, '.' raw only, ' ' empty.
 * Usage: node dev/rig/node/run.mjs ascii <sample> <workSize> <x0> <y0> <x1> <y1> [raw]
 * With `raw`, shows the plain Zhang-Suen skeleton of the shape (before loop cutting and pruning).
 */
import { analyze, analyzeShape } from '../../../src/rig/analyze';
import { dilate, makeThin, zhangSuen } from '../../../src/rig/imgproc';
import { SAMPLES } from '../../../src/rig/samples/kid-art';

export function runAscii(args: string[]): void {
  const [name, size, x0s, y0s, x1s, y1s, mode] = args;
  const s = SAMPLES.find((d) => d.name === name)!.draw();
  let skel: Uint8Array, solid: Uint8Array, ink: Uint8Array, raw: Uint8Array, w: number, h: number;
  if (mode === 'raw') {
    const a = analyzeShape(s, { workSize: Number(size ?? 150) });
    ({ solid, ink, raw, w, h } = a);
    skel = zhangSuen(dilate(solid, w, h, 1), w, h);
    for (let i = 0; i < w * h; i++) if (!solid[i]) skel[i] = 0;
    makeThin(skel, w, h);
  } else {
    const a = analyze(s, { workSize: Number(size ?? 150) });
    ({ skel, solid, ink, raw, w, h } = a);
  }
  const [x0, y0, x1, y1] = [x0s, y0s, x1s, y1s].map(Number);
  for (let y = y0; y <= Math.min(h - 1, y1); y++) {
    let row = `${String(y).padStart(3)} `;
    for (let x = x0; x <= Math.min(w - 1, x1); x++) {
      const i = y * w + x;
      row += mode === 'ink' ? (ink[i] ? ':' : solid[i] ? 'o' : ' ') : skel[i] ? '#' : solid[i] ? (ink[i] ? ':' : 'o') : raw[i] ? '.' : ' ';
    }
    console.log(row);
  }
}
