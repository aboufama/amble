/**
 * The rig core as the app sees it (§8.2): RigData v1, parsing, the rig worker client, templates, the pure
 * editing API, the Canvas 2D preview and the move list. The Phaser adapter stays inside the player bundle.
 *
 * FOUNDATION-STUB: the rig core (`src/rig`) has not merged yet. The types mirror the core's working copy of
 * `src/rig/types.ts`; the functions are small stand-ins (template skeletons, simple edits, a still preview)
 * or throw `NotBuiltYet`. When the core merges, this file re-exports it under these names.
 */
import { NotBuiltYet } from '../model/notBuilt';

/** 'stub' until the rig core merges. */
export const RIG_CORE: 'stub' | 'real' = 'stub';

// ------------------------------------------------------------------ RigData v1

export type CharacterKind = 'biped' | 'quadruped' | 'flyer' | 'swimmer' | 'blob' | 'object';

export const CHARACTER_KINDS: readonly CharacterKind[] = ['biped', 'quadruped', 'flyer', 'swimmer', 'blob', 'object'];

/** Semantic role of a bone. Procedural clips address roles, never bone names. */
export type BoneRole =
  | 'hips' | 'spine' | 'neck' | 'head'
  | 'armL1' | 'armL2' | 'armR1' | 'armR2'
  | 'legL1' | 'legL2' | 'legR1' | 'legR2'
  | 'legFL1' | 'legFL2' | 'legFR1' | 'legFR2' | 'legBL1' | 'legBL2' | 'legBR1' | 'legBR2'
  | 'tail1' | 'tail2' | 'tail3'
  | 'wingL1' | 'wingL2' | 'wingR1' | 'wingR2'
  | 'body' | 'top'
  | 'extra';

export interface DynamicSpec {
  stiffness: number;
  damping: number;
  gravity: number;
}

export interface RigBone {
  /** Unique within the rig, e.g. "armL1" or "extra3". */
  name: string;
  role: BoneRole;
  /** Index of the parent bone (parents come first); -1 = child of the rig root. */
  parent: number;
  /** Joint (bone head) in art pixels. */
  x: number;
  y: number;
  /** Bone tip in art pixels. */
  x2: number;
  y2: number;
  dynamic?: DynamicSpec;
  rigid?: boolean;
}

export interface RigPart {
  name: string;
  bones: string[];
  order: number;
  /** Editor layer key (`part:<name>`) when the part was drawn on its own layer. */
  layer?: string;
}

/** The Bones view's Bouncy/Speedy sliders, per move. */
export interface AnimTweak {
  speed?: number;
  amount?: number;
  off?: boolean;
}

/** Which way the drawing looks in the rig: 1 = right, -1 = left, 0 = at the viewer. */
export type RigFacing = 1 | -1 | 0;

export interface RigData {
  format: 'amble-rig';
  v: 1;
  kind: CharacterKind;
  facing: RigFacing;
  /** Ground contact and origin of the game object, in art pixels. */
  anchor: [number, number];
  /** Parents before children. */
  bones: RigBone[];
  parts?: RigPart[];
  skin?: { cell?: number; blend?: number };
  /** Hash of the art pixels the rig was fitted to. */
  artHash: string;
  made: 'auto' | 'ai' | 'hand';
  anims?: Record<string, AnimTweak>;
}

export type Point = [number, number];

/** Joint hints from a guide pose or a vision model, in art pixels, by role. */
export type JointHints = Partial<Record<BoneRole, Point>>;

/** RGBA pixels, straight alpha. `ImageData` satisfies this. */
export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export type LayerPixels = Pixels & { x?: number; y?: number };

/** The drawing to rig: the flattened image plus optional editor layers keyed by role (`lines`, `part:<name>`). */
export interface RigInput {
  image: Pixels;
  layers?: Record<string, LayerPixels>;
}

export interface PartRange {
  name: string;
  first: number;
  count: number;
  order: number;
  atlas: { x: number; y: number; w: number; h: number };
  art: { x: number; y: number; w: number; h: number };
  bone: number;
}

export interface BindStats {
  vertices: number;
  triangles: number;
  parts: number;
  atlasW: number;
  atlasH: number;
  cell: number;
  ms: number;
}

/** Everything derived from art plus RigData (never stored as the source of truth). */
export interface BoundRig {
  rig: RigData;
  width: number;
  height: number;
  rest: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array | Uint32Array;
  boneIdx: Uint8Array;
  boneW: Float32Array;
  atlas: Pixels;
  partRanges: PartRange[];
  flat: boolean;
  stats: BindStats;
}

// ------------------------------------------------------------------ parsing

export class RigFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RigFormatError';
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** `(json: unknown) => RigData`; throws `RigFormatError` with a readable reason. */
export function parseRig(json: unknown): RigData {
  if (!isObj(json) || json.format !== 'amble-rig' || json.v !== 1) throw new RigFormatError('This is not an Amble rig (format amble-rig, v 1).');
  if (!CHARACTER_KINDS.includes(json.kind as CharacterKind)) throw new RigFormatError('kind must be one of ' + CHARACTER_KINDS.join(', '));
  if (!Array.isArray(json.bones)) throw new RigFormatError('bones must be a list');
  json.bones.forEach((b, i) => {
    if (!isObj(b) || !isNum(b.x) || !isNum(b.y) || !isNum(b.x2) || !isNum(b.y2)) throw new RigFormatError(`bones[${i}] needs x, y, x2 and y2`);
    if (!Number.isInteger(b.parent) || (b.parent as number) < -1 || (b.parent as number) >= i) throw new RigFormatError(`bones[${i}].parent must be -1 or an earlier bone`);
  });
  const anchor = Array.isArray(json.anchor) && isNum(json.anchor[0]) && isNum(json.anchor[1]) ? (json.anchor as [number, number]) : null;
  if (!anchor) throw new RigFormatError('anchor must be [x, y]');
  return json as unknown as RigData;
}

// ------------------------------------------------------------------ templates

type TemplateBone = [name: string, role: BoneRole, parent: number, x: number, y: number, x2: number, y2: number];

/** Rest-pose skeletons in 0..1 of the drawing's box, feet (or base) at the bottom, facing the viewer or right. */
const TEMPLATES: Record<CharacterKind, TemplateBone[]> = {
  biped: [
    ['hips', 'hips', -1, 0.5, 0.6, 0.5, 0.48],
    ['spine', 'spine', 0, 0.5, 0.48, 0.5, 0.34],
    ['neck', 'neck', 1, 0.5, 0.34, 0.5, 0.28],
    ['head', 'head', 2, 0.5, 0.28, 0.5, 0.04],
    ['armL1', 'armL1', 1, 0.4, 0.36, 0.27, 0.5],
    ['armL2', 'armL2', 4, 0.27, 0.5, 0.17, 0.63],
    ['armR1', 'armR1', 1, 0.6, 0.36, 0.73, 0.5],
    ['armR2', 'armR2', 6, 0.73, 0.5, 0.83, 0.63],
    ['legL1', 'legL1', 0, 0.45, 0.6, 0.42, 0.8],
    ['legL2', 'legL2', 8, 0.42, 0.8, 0.4, 1],
    ['legR1', 'legR1', 0, 0.55, 0.6, 0.58, 0.8],
    ['legR2', 'legR2', 10, 0.58, 0.8, 0.6, 1],
  ],
  quadruped: [
    ['hips', 'hips', -1, 0.28, 0.45, 0.5, 0.44],
    ['spine', 'spine', 0, 0.5, 0.44, 0.7, 0.42],
    ['neck', 'neck', 1, 0.7, 0.42, 0.8, 0.26],
    ['head', 'head', 2, 0.8, 0.26, 0.96, 0.22],
    ['legFL1', 'legFL1', 1, 0.68, 0.48, 0.68, 0.74],
    ['legFL2', 'legFL2', 4, 0.68, 0.74, 0.68, 1],
    ['legFR1', 'legFR1', 1, 0.63, 0.48, 0.63, 0.74],
    ['legFR2', 'legFR2', 6, 0.63, 0.74, 0.63, 1],
    ['legBL1', 'legBL1', 0, 0.32, 0.5, 0.32, 0.75],
    ['legBL2', 'legBL2', 8, 0.32, 0.75, 0.32, 1],
    ['legBR1', 'legBR1', 0, 0.27, 0.5, 0.27, 0.75],
    ['legBR2', 'legBR2', 10, 0.27, 0.75, 0.27, 1],
    ['tail1', 'tail1', 0, 0.28, 0.45, 0.14, 0.36],
    ['tail2', 'tail2', 12, 0.14, 0.36, 0.04, 0.28],
  ],
  flyer: [
    ['body', 'body', -1, 0.5, 0.78, 0.5, 0.42],
    ['head', 'head', 0, 0.5, 0.42, 0.5, 0.14],
    ['wingL1', 'wingL1', 0, 0.44, 0.5, 0.26, 0.38],
    ['wingL2', 'wingL2', 2, 0.26, 0.38, 0.04, 0.3],
    ['wingR1', 'wingR1', 0, 0.56, 0.5, 0.74, 0.38],
    ['wingR2', 'wingR2', 4, 0.74, 0.38, 0.96, 0.3],
    ['tail1', 'tail1', 0, 0.5, 0.78, 0.5, 0.98],
  ],
  swimmer: [
    ['body', 'body', -1, 0.42, 0.5, 0.66, 0.5],
    ['head', 'head', 0, 0.66, 0.5, 0.96, 0.5],
    ['tail1', 'tail1', 0, 0.42, 0.5, 0.26, 0.5],
    ['tail2', 'tail2', 2, 0.26, 0.5, 0.13, 0.5],
    ['tail3', 'tail3', 3, 0.13, 0.5, 0.02, 0.5],
  ],
  blob: [
    ['body', 'body', -1, 0.5, 1, 0.5, 0.48],
    ['top', 'top', 0, 0.5, 0.48, 0.5, 0.04],
  ],
  object: [['body', 'body', -1, 0.5, 1, 0.5, 0]],
};

/** A template skeleton for guides, on-the-bones steps and placeholders, in a w × h box. */
export function templateFor(kind: CharacterKind, w: number, h: number): RigData {
  const bones: RigBone[] = TEMPLATES[kind].map(([name, role, parent, x, y, x2, y2]) => ({
    name,
    role,
    parent,
    x: x * w,
    y: y * h,
    x2: x2 * w,
    y2: y2 * h,
  }));
  if (kind === 'object') bones[0].rigid = true;
  return {
    format: 'amble-rig',
    v: 1,
    kind,
    facing: kind === 'quadruped' || kind === 'swimmer' ? 1 : 0,
    anchor: [w / 2, kind === 'swimmer' || kind === 'flyer' ? h / 2 : h],
    bones,
    artHash: '',
    made: 'auto',
  };
}

/** The moves a kind has (§1.3): Stand, Walk, Run, Jump, Fall, Ouch, Attack, Wave; plus Fly, Swim or Wiggle. */
export function clipsFor(kind: CharacterKind): string[] {
  const base = ['stand', 'walk', 'run', 'jump', 'fall', 'ouch', 'attack', 'wave'];
  if (kind === 'flyer') return [...base, 'fly'];
  if (kind === 'swimmer') return [...base, 'swim'];
  if (kind === 'blob') return [...base, 'wiggle'];
  return base;
}

// ------------------------------------------------------------------ the rig worker

export interface AutoRigOptions {
  kind: CharacterKind;
  hints?: JointHints;
  previous?: RigData;
}

export interface AutoRigResult {
  rig: RigData;
  /** 0..1: how sure the auto-rig is (the Bones view shows "Amble's guess" below 0.6). */
  confidence: number;
  /** Reasons in words ("The boots almost touch, so the legs looked stuck together."). */
  notes: string[];
}

export interface RigWorkerClient {
  autoRig(input: RigInput, opts: AutoRigOptions): Promise<AutoRigResult>;
  bind(input: RigInput, rig: RigData): Promise<BoundRig>;
}

/** Bounding box of the pixels with alpha, or null for an empty image. */
function inkBox(p: Pixels): { x: number; y: number; w: number; h: number } | null {
  let x0 = p.width;
  let y0 = p.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++) {
      if (p.data[(y * p.width + x) * 4 + 3] > 16) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** FOUNDATION-STUB: fits the kind's template to the drawing's box (low confidence); `bind` needs the core. */
export const rigWorker: RigWorkerClient = {
  async autoRig(input, opts) {
    const box = inkBox(input.image) ?? { x: 0, y: 0, w: input.image.width, h: input.image.height };
    const t = templateFor(opts.kind, box.w, box.h);
    const moved = t.bones.map((b) => ({ ...b, x: b.x + box.x, y: b.y + box.y, x2: b.x2 + box.x, y2: b.y2 + box.y }));
    const rig: RigData = { ...t, bones: moved, anchor: [t.anchor[0] + box.x, t.anchor[1] + box.y], made: 'auto' };
    return { rig, confidence: 0.3, notes: ['Amble placed standard bones for now.'] };
  },
  bind() {
    return Promise.reject(new NotBuiltYet('rigWorker.bind (rig core)'));
  },
};

// ------------------------------------------------------------------ the editing API (pure)

function boneIndex(rig: RigData, name: string): number {
  const i = rig.bones.findIndex((b) => b.name === name);
  if (i < 0) throw new RigFormatError(`There is no bone called ${name}.`);
  return i;
}

/** Moves one joint ('head' = where the bone starts, 'tip' = where it ends); connected joints follow. */
export function moveJoint(rig: RigData, bone: string, joint: 'head' | 'tip', x: number, y: number): RigData {
  const i = boneIndex(rig, bone);
  const b = rig.bones[i];
  const from: Point = joint === 'head' ? [b.x, b.y] : [b.x2, b.y2];
  const bones = rig.bones.map((o, k) => {
    const n = { ...o };
    if (k === i) {
      if (joint === 'head') [n.x, n.y] = [x, y];
      else [n.x2, n.y2] = [x, y];
    } else {
      if (joint === 'head' && k === b.parent && o.x2 === from[0] && o.y2 === from[1]) [n.x2, n.y2] = [x, y];
      if (joint === 'tip' && o.parent === i && o.x === from[0] && o.y === from[1]) [n.x, n.y] = [x, y];
    }
    return n;
  });
  return { ...rig, bones, made: 'hand' };
}

const MIRROR_PAIRS: Array<[string, string]> = [
  ['armL', 'armR'], ['legL', 'legR'], ['legFL', 'legFR'], ['legBL', 'legBR'], ['wingL', 'wingR'],
];

/** Copies one side's joints onto the other about the spine (`from` is the side that is kept). */
export function mirrorSides(rig: RigData, from: 'left' | 'right'): RigData {
  const spine = rig.bones.find((b) => b.role === 'spine' || b.role === 'hips' || b.role === 'body');
  const cx = spine ? spine.x : rig.anchor[0];
  const byName = new Map(rig.bones.map((b) => [b.name, b]));
  const bones = rig.bones.map((b) => {
    for (const [l, r] of MIRROR_PAIRS) {
      const [src, dst] = from === 'left' ? [l, r] : [r, l];
      if (b.name.startsWith(dst)) {
        const twin = byName.get(src + b.name.slice(dst.length));
        if (twin) return { ...b, x: 2 * cx - twin.x, y: twin.y, x2: 2 * cx - twin.x2, y2: twin.y2 };
      }
    }
    return b;
  });
  return { ...rig, bones, made: 'hand' };
}

/** Adds a springy chain (tail, ears, hair) from a joint of `parent` through `points`. */
export function addDynamic(rig: RigData, parent: string, points: Point[]): RigData {
  let p = boneIndex(rig, parent);
  const bones = [...rig.bones];
  let n = bones.filter((b) => b.role === 'extra').length;
  for (let k = 1; k < points.length; k++) {
    bones.push({
      name: `extra${++n}`,
      role: 'extra',
      parent: p,
      x: points[k - 1][0],
      y: points[k - 1][1],
      x2: points[k][0],
      y2: points[k][1],
      dynamic: { stiffness: 0.18, damping: 0.86, gravity: 300 },
    });
    p = bones.length - 1;
  }
  return { ...rig, bones, made: 'hand' };
}

/** Changes what the drawing is; the stub keeps the bones (the core re-fits them). */
export function setKind(rig: RigData, kind: CharacterKind): RigData {
  return { ...rig, kind };
}

/** Snaps joints to hints (from a guide pose or the AI's joint hints). */
export function magicBones(rig: RigData, hints: JointHints): RigData {
  const bones = rig.bones.map((b) => {
    const h = hints[b.role];
    return h ? { ...b, x: h[0], y: h[1] } : b;
  });
  return { ...rig, bones };
}

/** Removes a bone and everything hanging from it. */
export function removeBone(rig: RigData, bone: string): RigData {
  const i = boneIndex(rig, bone);
  const gone = new Set<number>([i]);
  rig.bones.forEach((b, k) => {
    if (gone.has(b.parent)) gone.add(k);
  });
  const remap = new Map<number, number>();
  const bones: RigBone[] = [];
  rig.bones.forEach((b, k) => {
    if (gone.has(k)) return;
    remap.set(k, bones.length);
    bones.push({ ...b, parent: b.parent < 0 ? -1 : (remap.get(b.parent) ?? -1) });
  });
  return { ...rig, bones, made: 'hand' };
}

/** "Something I'm holding": the bone's pixels move rigidly. */
export function setRigid(rig: RigData, bone: string, rigid: boolean): RigData {
  const i = boneIndex(rig, bone);
  const bones = rig.bones.map((b, k) => {
    if (k !== i) return b;
    const n = { ...b };
    if (rigid) n.rigid = true;
    else delete n.rigid;
    return n;
  });
  return { ...rig, bones, made: 'hand' };
}

// ------------------------------------------------------------------ the Canvas 2D preview

export interface RigPreviewOptions {
  /** Draw the ground shadow (default true). */
  shadow?: boolean;
  /** Device pixel ratio for the backing store (default window.devicePixelRatio). */
  dpr?: number;
  /** Paused and shown at rest under reduced motion. */
  reducedMotion?: boolean;
}

export interface RigPreview {
  /** The drawing (flat image), its rig, and optional part images (`part:<name>` → image). */
  load(image: CanvasImageSource, rig: RigData, parts?: Record<string, CanvasImageSource>): void;
  /** Loops a move (`walk`, `stand`...) with the student's Bouncy/Speedy tweak. */
  play(clip: string, tweak?: AnimTweak): void;
  /** Hops to (x, y) in canvas CSS px with a squash on landing. */
  hop(x: number, y: number): void;
  /** Shows one pose: `t` is 0..1 through the move. */
  pose(clip: string, t: number): void;
  destroy(): void;
}

/** FOUNDATION-STUB: draws the drawing still, standing on its anchor, centred in the canvas. */
export function createRigPreview(canvas: HTMLCanvasElement, opts: RigPreviewOptions = {}): RigPreview {
  let image: CanvasImageSource | null = null;
  let anchor: [number, number] = [0, 0];
  const draw = (): void => {
    const ctx = canvas.getContext('2d');
    if (!ctx || !image) return;
    const dpr = opts.dpr ?? (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
    const cw = canvas.clientWidth || canvas.width;
    const ch = canvas.clientHeight || canvas.height;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const iw = (image as { width: number }).width || 1;
    const ih = (image as { height: number }).height || 1;
    const scale = Math.min((cw * 0.8) / iw, (ch * 0.8) / ih, 1);
    const x = cw / 2 - anchor[0] * scale;
    const y = ch * 0.9 - anchor[1] * scale;
    ctx.drawImage(image, x, y, iw * scale, ih * scale);
  };
  return {
    load(img, rig) {
      image = img;
      anchor = rig.anchor;
      draw();
    },
    play: () => draw(),
    hop: () => draw(),
    pose: () => draw(),
    destroy() {
      image = null;
    },
  };
}
