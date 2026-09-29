/**
 * Template skeletons: the bones of a kind before anything is drawn, in the pose that animates best
 * (people in a star pose with arms 30° out and feet a hand apart, four-legged animals with their legs
 * apart, flyers with open wings, blobs round). Used for the Desk's "Draw on the bones" guide, the
 * star-pose hints of a free drawing, the Trail's waiting figure and "just bones" placeholders.
 */
import { specsFor } from './parts';
import type { CharacterKind, Facing, JointHints, RigBone, RigData } from './types';

type B = [name: string, role: RigBone['role'], parent: string | null, x: number, y: number, x2: number, y2: number];

const D = Math.PI / 180;

function biped(w: number, h: number, facing: Facing): B[] {
  const cx = w / 2;
  const side = facing !== 0;
  const dir = facing || 1;
  const sw = side ? 0.02 * h : Math.min(0.11 * h, 0.22 * w);
  const ua = 0.17 * h, fa = 0.16 * h;
  // arms 30° out from the body (a side view lets them hang a little forward)
  const a1 = (side ? 12 : 30) * D, a2 = (side ? 18 : 36) * D;
  const arm = (s: number): [number, number, number, number, number, number] => {
    const sx = cx + s * sw, sy = 0.34 * h;
    const ex = sx + s * Math.sin(a1) * ua * (side ? dir * s : 1), ey = sy + Math.cos(a1) * ua;
    const hx = ex + s * Math.sin(a2) * fa * (side ? dir * s : 1), hy = ey + Math.cos(a2) * fa;
    return [sx, sy, ex, ey, hx, hy];
  };
  const [lsx, lsy, lex, ley, lhx, lhy] = arm(-1);
  const [rsx, rsy, rex, rey, rhx, rhy] = arm(1);
  const hipX = side ? 0.025 * h : 0.07 * h, kneeX = side ? 0.03 * h : 0.08 * h, footX = side ? 0.045 * h : 0.1 * h;
  return [
    ['hips', 'hips', null, cx, 0.58 * h, cx, 0.63 * h],
    ['spine', 'spine', null, cx, 0.58 * h, cx, 0.3 * h],
    ['head', 'head', 'spine', cx, 0.3 * h, cx, 0.03 * h],
    ['armL1', 'armL1', 'spine', lsx, lsy, lex, ley],
    ['armL2', 'armL2', 'armL1', lex, ley, lhx, lhy],
    ['armR1', 'armR1', 'spine', rsx, rsy, rex, rey],
    ['armR2', 'armR2', 'armR1', rex, rey, rhx, rhy],
    ['legL1', 'legL1', 'hips', cx - hipX, 0.63 * h, cx - kneeX, 0.8 * h],
    ['legL2', 'legL2', 'legL1', cx - kneeX, 0.8 * h, cx - footX, 0.985 * h],
    ['legR1', 'legR1', 'hips', cx + hipX, 0.63 * h, cx + kneeX, 0.8 * h],
    ['legR2', 'legR2', 'legR1', cx + kneeX, 0.8 * h, cx + footX, 0.985 * h],
  ];
}

function quadruped(w: number, h: number): B[] {
  return [
    ['spine', 'spine', null, 0.26 * w, 0.46 * h, 0.7 * w, 0.46 * h],
    ['neck', 'neck', 'spine', 0.7 * w, 0.46 * h, 0.8 * w, 0.24 * h],
    ['head', 'head', 'neck', 0.8 * w, 0.24 * h, 0.98 * w, 0.28 * h],
    ['tail1', 'tail1', 'spine', 0.24 * w, 0.42 * h, 0.13 * w, 0.3 * h],
    ['tail2', 'tail2', 'tail1', 0.13 * w, 0.3 * h, 0.03 * w, 0.16 * h],
    ['legFL1', 'legFL1', 'spine', 0.64 * w, 0.56 * h, 0.66 * w, 0.77 * h],
    ['legFL2', 'legFL2', 'legFL1', 0.66 * w, 0.77 * h, 0.68 * w, 0.985 * h],
    ['legFR1', 'legFR1', 'spine', 0.72 * w, 0.56 * h, 0.75 * w, 0.77 * h],
    ['legFR2', 'legFR2', 'legFR1', 0.75 * w, 0.77 * h, 0.78 * w, 0.985 * h],
    ['legBL1', 'legBL1', 'spine', 0.24 * w, 0.56 * h, 0.22 * w, 0.77 * h],
    ['legBL2', 'legBL2', 'legBL1', 0.22 * w, 0.77 * h, 0.2 * w, 0.985 * h],
    ['legBR1', 'legBR1', 'spine', 0.32 * w, 0.56 * h, 0.31 * w, 0.77 * h],
    ['legBR2', 'legBR2', 'legBR1', 0.31 * w, 0.77 * h, 0.3 * w, 0.985 * h],
  ];
}

function flyer(w: number, h: number, facing: Facing): B[] {
  if (facing === 0) {
    const cx = w / 2;
    return [
      ['body', 'body', null, cx, 0.74 * h, cx, 0.38 * h],
      ['head', 'head', 'body', cx, 0.38 * h, cx, 0.06 * h],
      ['wingL1', 'wingL1', 'body', cx - 0.08 * w, 0.42 * h, cx - 0.28 * w, 0.28 * h],
      ['wingL2', 'wingL2', 'wingL1', cx - 0.28 * w, 0.28 * h, cx - 0.48 * w, 0.4 * h],
      ['wingR1', 'wingR1', 'body', cx + 0.08 * w, 0.42 * h, cx + 0.28 * w, 0.28 * h],
      ['wingR2', 'wingR2', 'wingR1', cx + 0.28 * w, 0.28 * h, cx + 0.48 * w, 0.4 * h],
      ['legL1', 'legL1', 'body', cx - 0.05 * w, 0.74 * h, cx - 0.06 * w, 0.87 * h],
      ['legL2', 'legL2', 'legL1', cx - 0.06 * w, 0.87 * h, cx - 0.08 * w, 0.985 * h],
      ['legR1', 'legR1', 'body', cx + 0.05 * w, 0.74 * h, cx + 0.06 * w, 0.87 * h],
      ['legR2', 'legR2', 'legR1', cx + 0.06 * w, 0.87 * h, cx + 0.08 * w, 0.985 * h],
    ];
  }
  return [
    ['body', 'body', null, 0.36 * w, 0.56 * h, 0.62 * w, 0.5 * h],
    ['head', 'head', 'body', 0.62 * w, 0.5 * h, 0.95 * w, 0.44 * h],
    ['wingL1', 'wingL1', 'body', 0.44 * w, 0.46 * h, 0.34 * w, 0.26 * h],
    ['wingL2', 'wingL2', 'wingL1', 0.34 * w, 0.26 * h, 0.2 * w, 0.04 * h],
    ['wingR1', 'wingR1', 'body', 0.5 * w, 0.46 * h, 0.44 * w, 0.24 * h],
    ['wingR2', 'wingR2', 'wingR1', 0.44 * w, 0.24 * h, 0.34 * w, 0.02 * h],
    ['tail1', 'tail1', 'body', 0.36 * w, 0.56 * h, 0.18 * w, 0.58 * h],
    ['tail2', 'tail2', 'tail1', 0.18 * w, 0.58 * h, 0.03 * w, 0.5 * h],
    ['legL1', 'legL1', 'body', 0.44 * w, 0.7 * h, 0.43 * w, 0.85 * h],
    ['legL2', 'legL2', 'legL1', 0.43 * w, 0.85 * h, 0.4 * w, 0.985 * h],
    ['legR1', 'legR1', 'body', 0.52 * w, 0.7 * h, 0.52 * w, 0.85 * h],
    ['legR2', 'legR2', 'legR1', 0.52 * w, 0.85 * h, 0.55 * w, 0.985 * h],
  ];
}

function swimmer(w: number, h: number): B[] {
  return [
    ['body', 'body', null, 0.45 * w, 0.5 * h, 0.7 * w, 0.5 * h],
    ['head', 'head', 'body', 0.7 * w, 0.5 * h, 0.98 * w, 0.5 * h],
    ['tail1', 'tail1', 'body', 0.45 * w, 0.5 * h, 0.24 * w, 0.5 * h],
    ['tail2', 'tail2', 'tail1', 0.24 * w, 0.5 * h, 0.02 * w, 0.5 * h],
  ];
}

function blob(w: number, h: number): B[] {
  return [
    ['body', 'body', null, w / 2, 0.98 * h, w / 2, 0.5 * h],
    ['top', 'top', 'body', w / 2, 0.5 * h, w / 2, 0.03 * h],
  ];
}

function object(w: number, h: number): B[] {
  return [['body', 'body', null, w / 2, 0.99 * h, w / 2, 0.01 * h]];
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * The template skeleton of a kind in a w × h box (art px, anchor at the bottom centre). `facing`
 * defaults to the viewer for people, blobs and things, and to the right for animals, flyers and
 * swimmers.
 */
export function templateFor(kind: CharacterKind, w: number, h: number, facing?: Facing): RigData {
  const f: Facing = facing ?? (kind === 'quadruped' || kind === 'swimmer' || kind === 'flyer' ? 1 : 0);
  const W = Math.max(8, w), H = Math.max(8, h);
  let list: B[];
  switch (kind) {
    case 'biped': list = biped(W, H, f); break;
    case 'quadruped': list = quadruped(W, H); break;
    case 'flyer': list = flyer(W, H, f); break;
    case 'swimmer': list = swimmer(W, H); break;
    case 'blob': list = blob(W, H); break;
    default: list = object(W, H);
  }
  // animals are drawn facing right; facing left mirrors them
  const mirror = f === -1 && kind !== 'biped';
  const X = (x: number) => round2(mirror ? W - x : x);
  const index = new Map<string, number>();
  const bones: RigBone[] = list.map(([name, role, parent, x, y, x2, y2], i) => {
    index.set(name, i);
    const b: RigBone = { name, role, parent: parent === null ? -1 : index.get(parent) ?? -1, x: X(x), y: round2(y), x2: X(x2), y2: round2(y2) };
    if (role === 'tail1' || role === 'tail2' || role === 'tail3') b.dynamic = { stiffness: 0.18, damping: 0.86, gravity: 300 };
    return b;
  });
  return { format: 'amble-rig', v: 1, kind, facing: f, anchor: [round2(W / 2), round2(H)], bones, artHash: '', made: 'auto' };
}

/**
 * A template's joints as hints for fitting a drawing made over it (the star-pose guide), scaled from
 * the template's box to the drawing's: `joints` where bones start, `tips` where limbs end.
 */
export function templateHints(template: RigData, box: { x: number; y: number; w: number; h: number } | null = null, from?: { w: number; h: number }): { joints: JointHints; tips: JointHints } {
  const sw = from?.w ?? template.anchor[0] * 2, sh = from?.h ?? template.anchor[1];
  const bx = box?.x ?? 0, by = box?.y ?? 0, kx = box ? box.w / sw : 1, ky = box ? box.h / sh : 1;
  const joints: JointHints = {}, tips: JointHints = {};
  const hasChild = new Set(template.bones.map((b) => b.parent));
  template.bones.forEach((b, i) => {
    if (b.role === 'extra') return;
    joints[b.role] = [bx + b.x * kx, by + b.y * ky];
    if (!hasChild.has(i)) tips[b.role] = [bx + b.x2 * kx, by + b.y2 * ky];
  });
  return { joints, tips };
}

export interface GhostShape {
  bone: string;
  /** A circle at (x1, y1)–(x2, y2)'s middle, or a capsule along it. */
  shape: 'circle' | 'capsule';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  r: number;
}

/**
 * Body shapes around a template's bones (a head circle, a torso capsule, limb capsules), for the
 * dashed guide outline and placeholder silhouettes.
 */
export function ghostShapes(rig: RigData): GhostShape[] {
  const H = Math.max(8, rig.anchor[1] - Math.min(...rig.bones.map((b) => Math.min(b.y, b.y2))));
  const out: GhostShape[] = [];
  for (const b of rig.bones) {
    const len = Math.hypot(b.x2 - b.x, b.y2 - b.y);
    let r = 0.045 * H;
    let shape: GhostShape['shape'] = 'capsule';
    switch (b.role) {
      case 'head':
        if (rig.kind === 'biped' || (rig.kind === 'flyer' && rig.facing === 0)) {
          shape = 'circle';
          r = len / 2;
        } else r = 0.11 * H;
        break;
      case 'spine': r = rig.kind === 'biped' ? 0.12 * H : 0.17 * H; break;
      case 'hips': r = 0.1 * H; break;
      case 'neck': r = 0.08 * H; break;
      case 'body': r = rig.kind === 'blob' ? 0.45 * Math.min(H, rig.anchor[0] * 2) : rig.kind === 'object' ? 0.4 * H : 0.16 * H; break;
      case 'top': r = rig.kind === 'blob' ? 0.3 * H : 0.1 * H; break;
      case 'tail1': case 'tail2': case 'tail3': r = rig.kind === 'swimmer' ? 0.14 * H : 0.035 * H; break;
      case 'wingL1': case 'wingR1': case 'wingL2': case 'wingR2': r = 0.06 * H; break;
      default: r = 0.045 * H;
    }
    out.push({ bone: b.name, shape, x1: b.x, y1: b.y, x2: b.x2, y2: b.y2, r });
  }
  return out;
}

export interface PartStep {
  /** Step of "Draw on the bones": body, head, arms, legs, wings, tail, extras. */
  step: string;
  /** Parts drawn in this step, each on its own `part:<name>` layer. */
  parts: { name: string; order: number; bones: string[] }[];
}

/**
 * The steps of drawing a kind on its bones, in the order a student draws, with the parts (layer
 * names) of each step and their draw order (low = behind): create layers sorted by `order`.
 */
export function partSteps(kind: CharacterKind, facing?: Facing): PartStep[] {
  const f: Facing = facing ?? (kind === 'quadruped' || kind === 'swimmer' || kind === 'flyer' ? 1 : 0);
  const specs = specsFor({ kind, facing: f });
  const pick = (...names: string[]) => specs.filter((s) => names.includes(s.name)).map((s) => ({ name: s.name, order: s.order, bones: [...s.bones] }));
  const steps: PartStep[] = [];
  const push = (step: string, ...names: string[]) => {
    const parts = pick(...names);
    if (parts.length) steps.push({ step, parts });
  };
  switch (kind) {
    case 'biped':
      push('body', 'torso');
      push('head', 'head');
      push('arms', 'armL', 'armR');
      push('legs', 'legL', 'legR');
      break;
    case 'quadruped':
      push('body', 'body');
      push('head', 'head');
      push('legs', 'legFL', 'legFR', 'legBL', 'legBR');
      push('tail', 'tail');
      break;
    case 'flyer':
      push('body', 'body');
      push('head', 'head');
      push('wings', 'wingL', 'wingR');
      push('legs', 'legL', 'legR');
      push('tail', 'tail');
      break;
    default:
      push('body', 'body');
  }
  steps.push({ step: 'extras', parts: [] });
  return steps;
}
