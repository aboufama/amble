/**
 * A starter's hero rigged again from the bones his parts were drawn on (the Desk's Bring to life on the
 * bones): Pip's legs touch, so one path through the drawing runs from a foot up the other thigh. The hips
 * must stay on their own sides, at the scale the Desk exports him.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodePng } from '../../src/art/engine/png';
import { resize } from '../../src/art/engine/export';
import { autoRig } from '../../src/rig/autorig';
import type { JointHints, LayerPixels, RigData } from '../../src/rig/types';

const DIR = new URL('../../public/starters/moon-king/art/hero/', import.meta.url);

async function pixels(path: string, scale: number): Promise<LayerPixels> {
  const img = await decodePng(new Uint8Array(readFileSync(new URL(path, DIR))));
  const data = new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  if (scale === 1) return { data, width: img.width, height: img.height };
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  return { data: resize(data, img.width, img.height, w, h), width: w, height: h };
}

/** The bones' joints and limb tips as hints, like the Desk's `rigHints` (scaled to the export). */
function hintsOf(rig: RigData, k: number): { joints: JointHints; tips: JointHints } {
  const joints: JointHints = {};
  const tips: JointHints = {};
  const parents = new Set(rig.bones.map((b) => b.parent));
  rig.bones.forEach((b, i) => {
    joints[b.role as keyof JointHints] = [b.x * k, b.y * k];
    if (!parents.has(i)) tips[b.role as keyof JointHints] = [b.x2 * k, b.y2 * k];
  });
  return { joints, tips };
}

describe('a starter hero rigged again on his own bones', () => {
  for (const scale of [1, 128 / 226]) {
    it(`keeps each hip on its own side (export scale ${scale.toFixed(2)})`, async () => {
      const art = JSON.parse(readFileSync(new URL('art.json', DIR), 'utf8')) as { files: Record<string, string>; rigData: RigData };
      const layers: Record<string, LayerPixels> = { lines: await pixels('ink.png', scale) };
      for (const name of ['legL', 'legR', 'torso', 'head', 'armL', 'armR']) layers[`part:${name}`] = await pixels(`parts/${name}.png`, scale);
      const { joints, tips } = hintsOf(art.rigData, scale);
      const r = autoRig({ image: await pixels('flat.png', scale), layers }, 'biped', { hints: joints, tipHints: tips, unsnapped: 'keep', facing: art.rigData.facing });
      const size = Math.max(226, 96) * scale;
      for (const leg of ['legL1', 'legR1']) {
        const was = art.rigData.bones.find((b) => b.name === leg)!;
        const now = r.rig.bones.find((b) => b.name === leg)!;
        expect(Math.hypot(now.x - was.x * scale, now.y - was.y * scale) / size, leg).toBeLessThan(0.05);
      }
    }, 60_000);
  }
});
