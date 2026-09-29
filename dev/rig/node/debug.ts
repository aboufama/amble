/**
 * Node debug run of the auto-rigger over the sample drawings: prints joint errors against ground truth
 * and writes a debug sheet (drawing | analysis | bones + truth) per sample.
 * Usage: node dev/rig/node/run.mjs debug [sample...]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { autoRig } from '../../../src/rig/autorig';
import { SAMPLES } from '../../../src/rig/samples/kid-art';
import { checkTruth, missingExpected } from '../../../src/rig/samples/truth';
import { blank, blit, checker, cross, disc, drawRigOverlay, painterOf } from './draw';
import { encodePng } from './png';

const OUT = process.env.RIG_OUT ?? 'out';

export function runDebug(names: string[]): void {
  mkdirSync(OUT, { recursive: true });
  const defs = names.length ? SAMPLES.filter((s) => names.includes(s.name)) : SAMPLES;
  let fails = 0;
  for (const def of defs) {
    const s = def.draw();
    const r = autoRig(s, s.kind, process.env.RIG_WORK ? { workSize: Number(process.env.RIG_WORK) } : {});
    const checks = checkTruth(r.rig, s);
    const missing = missingExpected(r.rig, s);
    const bad = checks.filter((c) => !c.ok);
    fails += bad.length + missing.length;
    console.log(`${s.name.padEnd(10)} ${s.kind.padEnd(9)} work=${r.workSize} bones=${r.rig.bones.length} ${r.confidence} ${r.ms.toFixed(1)}ms issues=[${r.issues.join(',')}] facing=${r.rig.facing}`);
    for (const c of checks) {
      if (!c.ok) console.log(`   MISS ${c.truth.bone}.${c.truth.end}: want ${c.truth.at.map((v) => v.toFixed(0))} got ${c.got ? c.got.map((v) => v.toFixed(0)) : '-'} err ${c.err.toFixed(1)} > ${c.truth.tol}`);
    }
    if (missing.length) console.log(`   MISSING bones: ${missing.join(', ')}`);
    if (r.notes.length) console.log(`   notes: ${r.notes.join(' | ')}`);
    console.log(`   bones: ${r.rig.bones.map((b) => b.name + (b.dynamic ? '~' : '') + (b.rigid ? '!' : '')).join(' ')}`);
    // sheet: drawing | analysis | bones
    const k = Math.min(1.6, 360 / Math.max(s.image.width, s.image.height));
    const pw = Math.round(s.image.width * k), ph = Math.round(s.image.height * k);
    const sheet = blank(pw * 3 + 40, ph + 20);
    for (let c = 0; c < 3; c++) checker(sheet, 10 + c * (pw + 10), 10, pw, ph);
    blit(sheet, s.image, 10, 10, k);
    const a = r.analysis;
    const an = blank(a.w, a.h, [255, 255, 255]);
    for (let i = 0; i < a.w * a.h; i++) {
      let col: [number, number, number, number] = [255, 255, 255, 0];
      if (a.solid[i]) col = [205, 215, 235, 255];
      if (a.raw[i]) col = [150, 165, 200, 255];
      if (a.holes[i]) col = [250, 180, 90, 255];
      if (a.ink[i]) col = [80, 85, 100, 255];
      if (a.loose[i]) col = [240, 220, 110, 255];
      if (a.skel[i]) col = [220, 30, 40, 255];
      an.data.set(col, i * 4);
    }
    if (process.env.RIG_ZOOM) {
      const z = Number(process.env.RIG_ZOOM);
      const big = blank(a.w * z, a.h * z);
      blit(big, an, 0, 0, z);
      const bp = painterOf(big);
      for (const e of a.ends) {
        disc(bp, (e.x + 0.5) * z, (e.y + 0.5) * z, z * 0.8, [20, 90, 255]);
        cross(bp, (e.tipX + 0.5) * z, (e.tipY + 0.5) * z, [0, 160, 255]);
      }
      writeFileSync(join(OUT, `analysis-${s.name}.png`), encodePng(bp.toPixels()));
    }
    const ka = k / a.scale;
    blit(sheet, an, Math.round(pw + 20 - a.pad * ka), Math.round(10 - a.pad * ka), ka);
    blit(sheet, s.image, 2 * pw + 30, 10, k, 0.55);
    const p = painterOf(sheet);
    for (const e of a.ends) disc(p, pw + 20 + ((e.tipX - a.pad) / a.scale) * k, 10 + ((e.tipY - a.pad) / a.scale) * k, 3, [20, 90, 255]);
    drawRigOverlay(p, r.rig, 2 * pw + 30, 10, k);
    for (const c of checks) cross(p, 2 * pw + 30 + c.truth.at[0] * k, 10 + c.truth.at[1] * k, c.ok ? [20, 170, 60] : [230, 20, 20]);
    writeFileSync(join(OUT, `debug-${s.name}.png`), encodePng(p.toPixels()));
  }
  console.log(fails ? `${fails} misses` : 'all joints within tolerance');
}
