/**
 * Parts: which bones make up each drawable piece, and in which order pieces are drawn (back to front).
 * Flat drawings are cut into the default parts of their kind; drawings made in parts (`part:<name>`
 * layers) use one part per layer, in layer order.
 */
import { layerAlpha } from './analyze';
import type { LayerPixels, RigData, RigPart } from './types';

export interface PartSpec {
  name: string;
  order: number;
  bones: string[];
}

/** The pieces of a kind (layer names for drawing on the bones), with their bones and draw order. */
export function specsFor(rig: Pick<RigData, 'kind' | 'facing'>): PartSpec[] {
  switch (rig.kind) {
    case 'biped':
      return [
        { name: 'legL', order: 0, bones: ['legL1', 'legL2'] },
        { name: 'legR', order: 1, bones: ['legR1', 'legR2'] },
        { name: 'torso', order: 3, bones: ['hips', 'spine'] },
        { name: 'head', order: 4, bones: ['neck', 'head'] },
        { name: 'armL', order: 5, bones: ['armL1', 'armL2'] },
        { name: 'armR', order: 6, bones: ['armR1', 'armR2'] },
      ];
    case 'quadruped':
      return [
        { name: 'legFL', order: 0, bones: ['legFL1', 'legFL2'] },
        { name: 'legBL', order: 1, bones: ['legBL1', 'legBL2'] },
        { name: 'tail', order: 2, bones: ['tail1', 'tail2', 'tail3'] },
        { name: 'body', order: 3, bones: ['spine'] },
        { name: 'legFR', order: 4, bones: ['legFR1', 'legFR2'] },
        { name: 'legBR', order: 5, bones: ['legBR1', 'legBR2'] },
        { name: 'head', order: 6, bones: ['neck', 'head'] },
      ];
    case 'flyer':
      return [
        { name: 'wingL', order: 0, bones: ['wingL1', 'wingL2'] },
        { name: 'wingR', order: rig.facing === 0 ? 1 : 6, bones: ['wingR1', 'wingR2'] },
        { name: 'tail', order: 2, bones: ['tail1', 'tail2', 'tail3'] },
        { name: 'legL', order: 2.5, bones: ['legL1', 'legL2'] },
        { name: 'legR', order: 2.6, bones: ['legR1', 'legR2'] },
        { name: 'body', order: 3, bones: ['body', 'spine', 'hips'] },
        { name: 'head', order: 4, bones: ['neck', 'head'] },
      ];
    case 'swimmer':
      return [{ name: 'body', order: 3, bones: ['body', 'neck', 'head', 'tail1', 'tail2', 'tail3', 'spine'] }];
    case 'blob':
      return [{ name: 'body', order: 3, bones: ['body', 'top'] }];
    case 'object':
      return [{ name: 'body', order: 3, bones: ['body', 'top'] }];
  }
}

/** The auto-cut parts of a rig: the kind's pieces, then extras as pieces of their own. */
export function defaultParts(rig: RigData): RigPart[] {
  const names = new Set(rig.bones.map((b) => b.name));
  const parts: RigPart[] = [];
  for (const s of specsFor(rig)) {
    const present = s.bones.filter((b) => names.has(b));
    if (present.length) parts.push({ name: s.name, order: s.order, bones: present });
  }
  addLeftovers(rig, parts);
  return parts.sort((a, b) => a.order - b.order);
}

/**
 * Bones no part claims: extras become pieces of their own (behind their parent's piece, like a tail or
 * a held wand; wheels in front), bones under an extra join their parent's piece.
 */
function addLeftovers(rig: RigData, parts: RigPart[]): void {
  const covered = new Set(parts.flatMap((p) => p.bones));
  for (const b of rig.bones) {
    if (covered.has(b.name)) continue;
    const parentBone = b.parent >= 0 ? rig.bones[b.parent] : undefined;
    const parentPart = parentBone ? parts.find((p) => p.bones.includes(parentBone.name)) : undefined;
    if (!parentPart || (b.role === 'extra' && parentBone?.role !== 'extra')) {
      const base = parentPart?.order ?? 0;
      const order = /^wheel/.test(b.name) ? base + 0.5 + parts.length * 0.001 : base - 0.5;
      parts.push({ name: b.name, order, bones: [b.name] });
    } else parentPart.bones.push(b.name);
    covered.add(b.name);
  }
}

/**
 * Parts from `part:<name>` layers, in layer order (the first layer is at the back). Known names
 * (`armL`, `head`, `torso`, `wingR`...) take their template bones; any other name takes the bone
 * nearest to the layer's drawing.
 */
export function partsFromLayers(rig: RigData, layers: Record<string, LayerPixels>): RigPart[] {
  const keys = Object.keys(layers).filter((k) => k.startsWith('part:'));
  if (!keys.length) return [];
  const specs = specsFor(rig);
  const names = new Set(rig.bones.map((b) => b.name));
  const claimed = new Set<string>();
  const parts: RigPart[] = [];
  keys.forEach((key, order) => {
    const name = key.slice(5);
    const spec = specs.find((s) => s.name.toLowerCase() === name.toLowerCase());
    let bones = spec ? spec.bones.filter((b) => names.has(b) && !claimed.has(b)) : [];
    if (!bones.length) {
      const c = layerCentroid(layers[key]);
      if (c) {
        let best = -1, bd = Infinity;
        rig.bones.forEach((b, i) => {
          if (claimed.has(b.name)) return;
          const d = Math.hypot((b.x + b.x2) / 2 - c[0], (b.y + b.y2) / 2 - c[1]);
          if (d < bd) {
            bd = d;
            best = i;
          }
        });
        if (best >= 0) bones = [rig.bones[best].name];
      }
    }
    bones.forEach((b) => claimed.add(b));
    parts.push({ name, order, bones, layer: key });
  });
  addLeftovers(rig, parts);
  return parts.sort((a, b) => a.order - b.order);
}

function layerCentroid(l: LayerPixels): [number, number] | null {
  let sx = 0, sy = 0, n = 0;
  const ox = l.x ?? 0, oy = l.y ?? 0;
  for (let y = 0; y < l.height; y += 2) for (let x = 0; x < l.width; x += 2) {
    if (layerAlpha(l, x + ox, y + oy) > 64) {
      sx += x + ox;
      sy += y + oy;
      n++;
    }
  }
  return n ? [sx / n, sy / n] : null;
}
