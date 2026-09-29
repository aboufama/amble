/**
 * Bone templates for stand-in characters, one per rig kind (biped, quadruped, flyer, swimmer, blob, object).
 * The same kinds the rig module fits to drawings, so a stand-in walks, jumps and gets hurt with the same
 * clip names as the drawing that replaces it. Sizes are in game px, relative to the art's w x h, in the
 * rest pose facing right, with the origin at the feet (y grows downward).
 * Each bone points along its own +y axis; a part is described in that frame (w across the bone, h along
 * it, centre (cx, cy) from the joint). Shapes with a direction (dome, wing, fin) point their far end
 * toward the bone's tip. Pure.
 */
import type { RigKind } from '../../../play/protocol';
import type { GhostShape } from './paint';

export interface PartDef {
  shape: GhostShape;
  w: number;
  h: number;
  /** Centre of the part relative to its joint, in the bone's own frame (the bone points along +y). */
  cx: number;
  cy: number;
}

export interface BoneDef {
  name: string;
  parent: string | null;
  /** Joint position relative to the parent's joint, in the parent's frame. */
  x: number;
  y: number;
  /** Rest rotation relative to the parent (radians, clockwise). */
  rest: number;
  /** Bone length along its +y axis (drawn as the bone line). */
  length: number;
  part?: PartDef;
  /** Draw order: lower is further back. */
  depth: number;
  /** A far-side limb: painted a little darker. */
  far?: boolean;
  /** The last bone of a chain: its tip gets a joint dot too. */
  end?: boolean;
}

export interface Template {
  kind: RigKind;
  bones: BoneDef[];
}

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

function biped(w: number, h: number): Template {
  // Chunky proportions: a stand-in must read at 40 px tall under a thick outline.
  const tw = clamp(w * 0.64, h * 0.28, h * 0.46);
  const hipY = -0.4 * h;
  const torsoH = 0.32 * h;
  const head = 0.32 * h;
  const arm1 = 0.15 * h;
  const arm2 = 0.14 * h;
  const leg1 = 0.2 * h;
  const leg2 = 0.19 * h;
  const armW = 0.11 * h;
  const legW = 0.14 * h;
  const limb = (name: string, parent: string, x: number, y: number, len: number, thick: number, depth: number, far: boolean, end: boolean): BoneDef => ({
    name, parent, x, y, rest: 0, length: len, depth, far, end,
    part: { shape: 'capsule', w: thick, h: len + thick * 0.9, cx: 0, cy: len / 2 },
  });
  const bones: BoneDef[] = [
    { name: 'hips', parent: null, x: 0, y: hipY, rest: 0, length: 0, depth: 0 },
    { name: 'spine', parent: 'hips', x: 0, y: 0, rest: Math.PI, length: torsoH * 0.92, depth: 4, part: { shape: 'box', w: tw, h: torsoH, cx: 0, cy: torsoH / 2 - 0.02 * h } },
    { name: 'head', parent: 'spine', x: 0, y: torsoH * 0.92, rest: 0, length: head * 0.5, depth: 5, end: true, part: { shape: 'circle', w: head, h: head, cx: 0, cy: head * 0.5 + 0.015 * h } },
    // Arms hang from the shoulders: the spine points up, so they turn half a circle to point down.
    { ...limb('armB1', 'spine', 0, torsoH * 0.82, arm1, armW, 1, true, false), rest: Math.PI },
    limb('armB2', 'armB1', 0, arm1, arm2, armW * 0.9, 1.1, true, true),
    limb('legB1', 'hips', -0.07 * h, 0, leg1, legW, 2, true, false),
    limb('legB2', 'legB1', 0, leg1, leg2, legW * 0.9, 2.1, true, true),
    limb('legF1', 'hips', 0.07 * h, 0, leg1, legW, 6, false, false),
    limb('legF2', 'legF1', 0, leg1, leg2, legW * 0.9, 6.1, false, true),
    { ...limb('armF1', 'spine', 0, torsoH * 0.82, arm1, armW, 7, false, false), rest: Math.PI },
    limb('armF2', 'armF1', 0, arm1, arm2, armW * 0.9, 7.1, false, true),
  ];
  return { kind: 'biped', bones };
}

function blob(w: number, h: number): Template {
  const armW = clamp(w * 0.14, 5, 40);
  const armH = h * 0.36;
  return {
    kind: 'blob',
    bones: [
      { name: 'body', parent: null, x: 0, y: 0, rest: Math.PI, length: h * 0.52, depth: 2, part: { shape: 'dome', w, h: h * 0.9, cx: 0, cy: h * 0.45 } },
      { name: 'top', parent: 'body', x: 0, y: h * 0.52, rest: 0, length: h * 0.3, depth: 2.1, end: true },
      { name: 'armL', parent: 'body', x: -w * 0.43, y: h * 0.42, rest: Math.PI, length: armH * 0.8, depth: 1, far: true, end: true, part: { shape: 'capsule', w: armW, h: armH, cx: 0, cy: armH * 0.42 } },
      { name: 'armR', parent: 'body', x: w * 0.43, y: h * 0.42, rest: Math.PI, length: armH * 0.8, depth: 1.1, far: true, end: true, part: { shape: 'capsule', w: armW, h: armH, cx: 0, cy: armH * 0.42 } },
    ],
  };
}

function quadruped(w: number, h: number): Template {
  const bodyW = w * 0.7;
  const bodyH = h * 0.4;
  const legH = h * 0.47;
  const legW = clamp(h * 0.13, 4, 30);
  const head = h * 0.36;
  const leg = (name: string, x: number, depth: number, far: boolean): BoneDef => ({
    name, parent: 'spine', x, y: 0, rest: 0, length: legH * 0.9, depth, far, end: true,
    part: { shape: 'capsule', w: legW, h: legH, cx: 0, cy: legH * 0.45 },
  });
  return {
    kind: 'quadruped',
    bones: [
      { name: 'spine', parent: null, x: -w * 0.25, y: -h * 0.46, rest: 0, length: 0, depth: 3, part: { shape: 'capsule', w: bodyW, h: bodyH, cx: w * 0.24, cy: -h * 0.08 } },
      { name: 'tail', parent: 'spine', x: -w * 0.08, y: -h * 0.12, rest: 2.3, length: h * 0.28, depth: 1, end: true, part: { shape: 'capsule', w: legW * 0.8, h: h * 0.32, cx: 0, cy: h * 0.15 } },
      leg('legBL', w * 0.02, 0, true),
      leg('legFL', w * 0.44, 0.1, true),
      leg('legBR', -w * 0.02, 5, false),
      leg('legFR', w * 0.48, 5.1, false),
      { name: 'neck', parent: 'spine', x: w * 0.48, y: -h * 0.16, rest: -2.4, length: h * 0.2, depth: 5.5, part: { shape: 'capsule', w: legW * 0.95, h: h * 0.26, cx: 0, cy: h * 0.1 } },
      { name: 'head', parent: 'neck', x: 0, y: h * 0.2, rest: 2.4, length: head * 0.3, depth: 6.1, end: true, part: { shape: 'circle', w: head, h: head * 0.9, cx: head * 0.12, cy: -head * 0.1 } },
    ],
  };
}

function flyer(w: number, h: number): Template {
  const bodyW = w * 0.62;
  const bodyH = h * 0.44;
  const head = h * 0.36;
  const wingW = w * 0.5;
  const wingH = h * 0.5;
  return {
    kind: 'flyer',
    bones: [
      { name: 'body', parent: null, x: 0, y: -h * 0.42, rest: 0, length: 0, depth: 3, part: { shape: 'ellipse', w: bodyW, h: bodyH, cx: 0, cy: 0 } },
      { name: 'wingB', parent: 'body', x: -w * 0.04, y: -bodyH * 0.25, rest: Math.PI, length: wingH * 0.8, depth: 1, far: true, end: true, part: { shape: 'wing', w: wingW, h: wingH, cx: -wingW * 0.1, cy: wingH * 0.45 } },
      { name: 'tail', parent: 'body', x: -bodyW * 0.45, y: 0, rest: Math.PI / 2, length: w * 0.16, depth: 2, end: true, part: { shape: 'fin', w: h * 0.26, h: w * 0.2, cx: 0, cy: w * 0.09 } },
      { name: 'head', parent: 'body', x: bodyW * 0.42, y: -bodyH * 0.3, rest: 0, length: 0, depth: 4, end: true, part: { shape: 'circle', w: head, h: head, cx: head * 0.2, cy: -head * 0.1 } },
      { name: 'wingF', parent: 'body', x: w * 0.02, y: -bodyH * 0.3, rest: Math.PI, length: wingH * 0.8, depth: 5, end: true, part: { shape: 'wing', w: wingW, h: wingH, cx: -wingW * 0.1, cy: wingH * 0.45 } },
    ],
  };
}

function swimmer(w: number, h: number): Template {
  const segs = 4;
  const seg = (w * 0.78) / segs;
  const bones: BoneDef[] = [
    { name: 'head', parent: null, x: w * 0.36, y: -h * 0.5, rest: Math.PI / 2, length: 0, depth: 6, part: { shape: 'ellipse', w: h * 0.9, h: seg * 1.35, cx: 0, cy: seg * 0.25 } },
  ];
  for (let i = 1; i <= segs; i++) {
    const thick = h * (0.86 - i * 0.14);
    bones.push({
      name: `spine${i}`, parent: i === 1 ? 'head' : `spine${i - 1}`, x: 0, y: i === 1 ? seg * 0.55 : seg, rest: 0, length: seg, depth: 6 - i,
      part: { shape: 'capsule', w: thick, h: seg + thick * 0.6, cx: 0, cy: seg / 2 },
    });
  }
  bones.push({ name: 'fin', parent: `spine${segs}`, x: 0, y: seg, rest: 0, length: h * 0.1, depth: 0.5, end: true, part: { shape: 'fin', w: h * 0.7, h: seg * 0.9, cx: 0, cy: seg * 0.35 } });
  return { kind: 'swimmer', bones };
}

function object(w: number, h: number): Template {
  return {
    kind: 'object',
    bones: [{ name: 'body', parent: null, x: 0, y: 0, rest: Math.PI, length: h * 0.7, depth: 1, end: true, part: { shape: 'roundbox', w, h: h * 0.92, cx: 0, cy: h * 0.46 } }],
  };
}

export function templateFor(kind: RigKind, w: number, h: number): Template {
  switch (kind) {
    case 'quadruped':
      return quadruped(w, h);
    case 'flyer':
      return flyer(w, h);
    case 'swimmer':
      return swimmer(w, h);
    case 'blob':
      return blob(w, h);
    case 'object':
    case 'none':
      return object(w, h);
    default:
      return biped(w, h);
  }
}

export interface BoneWorld {
  x: number;
  y: number;
  angle: number;
}

/** Forward kinematics: where every joint is for a pose (bone name -> extra rotation). */
export function solve(template: Template, pose: Record<string, number>, out = new Map<string, BoneWorld>()): Map<string, BoneWorld> {
  for (const b of template.bones) {
    const p = b.parent ? out.get(b.parent) : undefined;
    const pa = p?.angle ?? 0;
    const cos = Math.cos(pa);
    const sin = Math.sin(pa);
    const x = (p?.x ?? 0) + b.x * cos - b.y * sin;
    const y = (p?.y ?? 0) + b.x * sin + b.y * cos;
    const w = out.get(b.name);
    const angle = pa + b.rest + (pose[b.name] ?? 0);
    if (w) {
      w.x = x;
      w.y = y;
      w.angle = angle;
    } else out.set(b.name, { x, y, angle });
  }
  return out;
}
