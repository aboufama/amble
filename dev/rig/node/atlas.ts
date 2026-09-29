/**
 * Writes a sample's part atlas (every part cut out, with its hidden areas and bleed) enlarged on a
 * checkerboard, to review the cut. Usage: node dev/rig/node/run.mjs atlas hero [zoom]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyze } from '../../../src/rig/analyze';
import { autoRig } from '../../../src/rig/autorig';
import { bindRig, BIND_WORK_SIZE, defaultParts } from '../../../src/rig/bind';
import { cutParts } from '../../../src/rig/bind/cut';
import { computeOwnership } from '../../../src/rig/bind/ownership';
import { SAMPLES } from '../../../src/rig/samples/kid-art';
import { blank, blit, checker } from './draw';
import { encodePng } from './png';

const OUT = process.env.RIG_OUT ?? 'out';

export function runAtlas(args: string[]): void {
  mkdirSync(OUT, { recursive: true });
  const [name = 'hero', zoomArg] = args;
  const def = SAMPLES.find((s) => s.name === name) ?? SAMPLES[0];
  const s = def.draw();
  const r = autoRig(s, s.kind);
  const b = bindRig(s, r.rig, { analysis: r.analysis });
  const z = Number(zoomArg ?? 3);
  const sheet = blank(b.atlas.width * z, b.atlas.height * z);
  checker(sheet, 0, 0, sheet.width, sheet.height);
  blit(sheet, b.atlas, 0, 0, z);
  writeFileSync(join(OUT, `atlas-${name}.png`), encodePng(sheet));
  // which part owns each art pixel (before hidden areas), and the synthesized pixels
  const A = analyze(s, { workSize: BIND_WORK_SIZE });
  const parts = defaultParts(r.rig).sort((p, q) => p.order - q.order);
  const index = new Map(r.rig.bones.map((bn, i) => [bn.name, i] as [string, number]));
  const boneToPart = new Int16Array(r.rig.bones.length);
  parts.forEach((p, k) => p.bones.forEach((n) => (boneToPart[index.get(n)!] = k)));
  const adj = parts.map(() => parts.map(() => true));
  const own = computeOwnership(A, r.rig, parts, boneToPart, true);
  const imgs = cutParts(s.image, s.layers, A, r.rig, parts, boneToPart, adj, own, { hidden: true, bleed: false, inkAware: true });
  const W = s.image.width, H = s.image.height;
  const map = blank(W, H, [255, 255, 255]);
  const cols = [[230, 25, 75], [60, 180, 75], [67, 99, 216], [245, 130, 49], [145, 30, 180], [66, 212, 244], [240, 50, 230], [154, 99, 36]];
  for (let i = 0; i < W * H; i++) {
    if (s.image.data[i * 4 + 3] <= 8) continue;
    const k = imgs.findIndex((im) => im.mask[i] && !im.synth.has(i));
    if (k < 0) continue;
    const c = cols[k % cols.length];
    const ink = A.inkArt[i] === 1;
    map.data.set([ink ? c[0] * 0.5 : c[0], ink ? c[1] * 0.5 : c[1], ink ? c[2] * 0.5 : c[2], 255], i * 4);
  }
  for (const [k, im] of imgs.entries()) for (const [i] of im.synth) {
    if (!map.data[i * 4 + 3] || map.data[i * 4] === 255) map.data.set([...cols[k % cols.length].map((v) => (v + 255 * 2) / 3), 255], i * 4);
  }
  const big = blank(W * z, H * z);
  blit(big, map, 0, 0, z);
  writeFileSync(join(OUT, `parts-${name}.png`), encodePng(big));
  parts.forEach((p, k) => console.log(`part ${k} ${p.name} colour ${cols[k % cols.length].join(',')}`));
  // one part's image with its synthesized pixels tinted (fill pink, outline dark red)
  const focus = parts.findIndex((p) => p.name === (process.env.RIG_PART ?? 'torso'));
  if (focus >= 0) {
    const im = imgs[focus];
    const img = blank(W, H, [255, 255, 255]);
    for (let i = 0; i < W * H; i++) {
      if (!im.mask[i]) continue;
      const syn = im.synth.get(i);
      if (syn) {
        const dark = syn[0] + syn[1] + syn[2] < 200;
        img.data.set(dark ? [150, 0, 40, 255] : [255, 150, 190, 255], i * 4);
      } else img.data.set([s.image.data[i * 4], s.image.data[i * 4 + 1], s.image.data[i * 4 + 2], 255], i * 4);
    }
    const bigP = blank(W * z, H * z);
    blit(bigP, img, 0, 0, z);
    writeFileSync(join(OUT, `part-${name}-${parts[focus].name}.png`), encodePng(bigP));
  }
  for (const p of b.partRanges) console.log(`${p.name.padEnd(8)} order ${p.order} tris ${p.count} atlas ${JSON.stringify(p.atlas)} bone ${r.rig.bones[p.bone]?.name}`);
}
