/**
 * Node contact sheets: auto-rig and bind every sample, then draw every clip as a row of frames with the
 * software rasterizer (the browser harness draws the same clips in Phaser). First column: the drawing
 * as drawn, then the bound mesh at rest (they should match).
 * Usage: node dev/rig/node/run.mjs sheet [sample...]   (RIG_FRAMES=8, RIG_CELL=110, RIG_WIRE=1)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { autoRig } from '../../../src/rig/autorig';
import { bindRig } from '../../../src/rig/bind';
import { clipsFor } from '../../../src/rig/clips/library';
import { sampleClip, unionBounds } from '../../../src/rig/render/frames';
import { SAMPLES } from '../../../src/rig/samples/kid-art';
import { blank, blit, checker } from './draw';
import { rasterMesh } from './mesh';
import { encodePng } from './png';

const OUT = process.env.RIG_OUT ?? 'out';

export function runSheet(names: string[]): void {
  mkdirSync(OUT, { recursive: true });
  const defs = names.length ? SAMPLES.filter((s) => names.includes(s.name)) : SAMPLES;
  const n = Number(process.env.RIG_FRAMES ?? 8);
  const cell = Number(process.env.RIG_CELL ?? 110);
  for (const def of defs) {
    const s = def.draw();
    const r = autoRig(s, s.kind);
    const t0 = performance.now();
    const bound = bindRig(s, r.rig, { analysis: r.analysis });
    const bindMs = performance.now() - t0;
    const only = process.env.RIG_CLIPS?.split(',');
    const clips = clipsFor(r.rig.kind).filter((c) => !only || only.includes(c));
    const sims = clips.map((c) => sampleClip(bound, c, n)!);
    const pad = 4;
    const ax = r.rig.anchor[0], ay = r.rig.anchor[1];
    let top = Infinity;
    for (let i = 1; i < bound.rest.length; i += 2) top = Math.min(top, bound.rest[i]);
    // one scale for every row: the drawing is `cell` px tall at rest
    const k = cell / Math.max(1, ay - top);
    const rows = sims.map((sim) => unionBounds([sim]));
    const all = unionBounds(sims);
    const cw = Math.ceil((all.x1 - all.x0) * k + 2 * pad);
    const heights = rows.map((u) => Math.ceil((u.y1 - u.y0) * k + 2 * pad));
    const restW = Math.ceil(s.image.width * k) + 2 * pad, restH = Math.ceil(s.image.height * k) + 2 * pad;
    const sheet = blank(restW * 2 + cw * n, Math.max(restH, heights.reduce((a, b) => a + b, 0)));
    checker(sheet, 0, 0, restW * 2, restH);
    blit(sheet, s.image, pad, pad, k);
    const rest = new Float32Array(bound.rest.length);
    for (let i = 0; i < rest.length; i += 2) {
      rest[i] = bound.rest[i] - ax;
      rest[i + 1] = bound.rest[i + 1] - ay;
    }
    rasterMesh(sheet, bound, rest, restW + pad + ax * k, pad + ay * k, k, { wire: !!process.env.RIG_WIRE });
    let y0 = 0;
    sims.forEach((sim, row) => {
      const u = rows[row], ch = heights[row];
      for (let f = 0; f < sim.verts.length; f++) {
        const x0 = restW * 2 + f * cw;
        if ((row + f) % 2) checker(sheet, x0, y0, cw, ch);
        rasterMesh(sheet, bound, sim.verts[f], x0 + pad - all.x0 * k, y0 + pad - u.y0 * k, k, {
          alpha: sim.alpha[f],
          tint: sim.flash[f] > 0.5 ? [255, 255, 255] : null,
          wire: !!process.env.RIG_WIRE,
        });
      }
      y0 += ch;
    });
    writeFileSync(join(OUT, `sheet-${s.name}.png`), encodePng(sheet));
    const st = bound.stats;
    console.log(`${s.name.padEnd(10)} bind ${bindMs.toFixed(1)}ms verts ${st.vertices} tris ${st.triangles} parts ${st.parts} atlas ${st.atlasW}x${st.atlasH} cell ${st.cell.toFixed(1)} rows: ${sims.map((m) => m.clip).join(' ')}`);
  }
}
