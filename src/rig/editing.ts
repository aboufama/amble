/**
 * The Bones view's editing API. Every function is pure: it returns a new `RigData` (or the same one
 * when nothing changed), so an undo stack is just the list of previous rigs. The drawing never moves;
 * only bones do. Anything that moves or adds a joint marks the rig `made: 'hand'`.
 *
 * Joints are the stars a student drags: endpoints of bones that are joined (a bone's start and its
 * parent's tip, roots that start together), each with a stable id (the name of the first bone that
 * starts there, or `<bone>.tip` for a hand, a foot or a head top) and a readable label.
 */
import { autoRig, type AutoRigResult, type RigResult } from './autorig';
import type { Analysis } from './analyze';
import { DEFAULT_SPRING, cloneRig } from './format';
import { hashPixels } from './hash';
import type { AnimTweak, BoneRole, CharacterKind, DynamicSpec, Facing, JointHints, Point, RigBone, RigData, RigInput } from './types';

export type Side = 'L' | 'R' | 'C';

export interface JointEnd {
  bone: number;
  /** 0 = the bone's start (joint), 1 = its tip. */
  end: 0 | 1;
}

export interface Joint {
  id: string;
  x: number;
  y: number;
  side: Side;
  /** A word for what the joint is, for the UI's own words: 'shoulder', 'elbow', 'hand', 'knee'... */
  key: string;
  /** English label: "Left elbow". */
  label: string;
  ends: JointEnd[];
}

const EPS = 0.5;

const same = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by) < EPS;
const endAt = (b: RigBone, end: 0 | 1): Point => (end ? [b.x2, b.y2] : [b.x, b.y]);

/** Which side of the screen a bone is on, by its role (armL1 → L) or, for extras, by where it points. */
export function sideOf(rig: RigData, i: number): Side {
  const b = rig.bones[i];
  const m = /([LR])\d$/.exec(b.role === 'extra' ? '' : b.role);
  if (m) return m[1] as Side;
  if (b.role !== 'extra' || Math.abs(b.x2 - rig.anchor[0]) < 2) return 'C';
  return b.x2 < rig.anchor[0] ? 'L' : 'R';
}

const SIDE_WORD: Record<Side, string> = { L: 'Left', R: 'Right', C: '' };

/** [start word, tip word] per role, by kind where it differs. */
function words(kind: CharacterKind, role: BoneRole): [string, string] {
  switch (role) {
    case 'hips': return ['hips', 'hips'];
    case 'spine': return kind === 'biped' ? ['hips', 'neck'] : ['back', 'shoulders'];
    case 'neck': return ['neck', 'head'];
    case 'head': return kind === 'biped' ? ['neck', 'head top'] : ['head', 'nose'];
    case 'armL1': case 'armR1': return ['shoulder', 'elbow'];
    case 'armL2': case 'armR2': return ['elbow', 'hand'];
    case 'legL1': case 'legR1': return ['hip', 'knee'];
    case 'legL2': case 'legR2': return ['knee', 'foot'];
    case 'legFL1': case 'legFR1': return ['front shoulder', 'front knee'];
    case 'legFL2': case 'legFR2': return ['front knee', 'front paw'];
    case 'legBL1': case 'legBR1': return ['back hip', 'back knee'];
    case 'legBL2': case 'legBR2': return ['back knee', 'back paw'];
    case 'tail1': return ['tail base', 'tail bend'];
    case 'tail2': return ['tail bend', 'tail tip'];
    case 'tail3': return ['tail bend', 'tail tip'];
    case 'wingL1': case 'wingR1': return ['wing root', 'wing bend'];
    case 'wingL2': case 'wingR2': return ['wing bend', 'wing tip'];
    case 'body': return kind === 'swimmer' || kind === 'flyer' ? ['body', 'chest'] : ['bottom', 'middle'];
    case 'top': return ['middle', 'top'];
    default: return ['', ''];
  }
}

function describe(rig: RigData, e: JointEnd): { key: string; label: string } {
  const b = rig.bones[e.bone];
  if (b.role === 'extra') {
    const wheel = /^wheel(\d*)$/.exec(b.name);
    if (wheel) return e.end ? { key: 'wheel rim', label: `Wheel ${wheel[1]} rim` } : { key: 'wheel', label: `Wheel ${wheel[1]}` };
    const n = /(\d+)$/.exec(b.name)?.[1] ?? '';
    return e.end ? { key: 'wiggly tip', label: `Wiggly bit ${n} tip`.replace('  ', ' ') } : { key: 'wiggly', label: `Wiggly bit ${n}`.trim() };
  }
  const key = words(rig.kind, b.role)[e.end];
  const side = SIDE_WORD[sideOf(rig, e.bone)];
  const label = side ? `${side} ${key}` : key[0].toUpperCase() + key.slice(1);
  return { key, label };
}

/** The joints of a rig, in bone order: starts first, then tips of bones with no children. */
export function jointList(rig: RigData): Joint[] {
  const bones = rig.bones;
  const n = bones.length;
  // union-find over endpoints (2 per bone): a start joins its parent's tip, roots and siblings that
  // start together join; unrelated bones that merely touch stay apart
  const up = Array.from({ length: 2 * n }, (_, i) => i);
  const find = (i: number): number => (up[i] === i ? i : (up[i] = find(up[i])));
  const join = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) up[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  for (let i = 0; i < n; i++) {
    const b = bones[i];
    if (b.parent >= 0) {
      const p = bones[b.parent];
      if (same(b.x, b.y, p.x2, p.y2)) join(2 * i, 2 * b.parent + 1);
    }
    for (let j = 0; j < i; j++) {
      if (bones[j].parent === b.parent && same(b.x, b.y, bones[j].x, bones[j].y)) join(2 * i, 2 * j);
    }
  }
  const hasChild = new Uint8Array(n);
  for (const b of bones) if (b.parent >= 0) hasChild[b.parent] = 1;
  const groups = new Map<number, JointEnd[]>();
  const order: number[] = [];
  const add = (k: number) => {
    const r = find(k);
    if (!groups.has(r)) {
      groups.set(r, []);
      order.push(r);
    }
    groups.get(r)!.push({ bone: k >> 1, end: (k & 1) as 0 | 1 });
  };
  for (let i = 0; i < n; i++) add(2 * i);
  for (let i = 0; i < n; i++) add(2 * i + 1);
  const out: Joint[] = [];
  for (const r of order) {
    const ends = groups.get(r)!;
    const starts = ends.filter((e) => e.end === 0);
    // a tip only becomes a joint of its own at the end of a chain (hands, feet, head top)
    if (!starts.length && !ends.some((e) => !hasChild[e.bone])) continue;
    const first = starts[0] ?? ends[0];
    const b = bones[first.bone];
    const [x, y] = endAt(b, first.end);
    const labelled = starts.length ? starts[starts.length > 1 && bones[starts[0].bone].role === 'hips' ? 1 : 0] : first;
    const d = describe(rig, labelled);
    const sides = new Set(ends.map((e) => sideOf(rig, e.bone)));
    const side: Side = sides.size === 1 ? [...sides][0] : 'C';
    out.push({ id: first.end ? `${b.name}.tip` : b.name, x, y, side, key: d.key, label: d.label, ends });
  }
  return out;
}

/** Finds a joint by id, or by a bone name and end. */
export function findJoint(rig: RigData, id: string): Joint | null {
  return jointList(rig).find((j) => j.id === id || j.ends.some((e) => `${rig.bones[e.bone].name}${e.end ? '.tip' : ''}` === id)) ?? null;
}

function touched(rig: RigData): RigData {
  const r = cloneRig(rig);
  r.made = 'hand';
  return r;
}

/**
 * Moves a joint (every bone end joined there) to (x, y) in art px: the bones that meet there stretch.
 * `id` is a `Joint.id`, or any `<bone>` / `<bone>.tip` that is part of the joint.
 */
export function moveJoint(rig: RigData, id: string, x: number, y: number): RigData {
  const j = findJoint(rig, id);
  if (!j || !Number.isFinite(x) || !Number.isFinite(y) || (j.x === x && j.y === y)) return rig;
  const r = touched(rig);
  for (const e of j.ends) {
    const b = r.bones[e.bone];
    if (e.end) {
      b.x2 = x;
      b.y2 = y;
    } else {
      b.x = x;
      b.y = y;
    }
    // a bone must keep a direction
    if (Math.hypot(b.x2 - b.x, b.y2 - b.y) < 0.5) b.y2 = b.y - 1;
  }
  return r;
}

/** Moves a whole bone (both of its joints) by (dx, dy): dragging a bone's middle. */
export function moveBone(rig: RigData, name: string, dx: number, dy: number): RigData {
  const i = rig.bones.findIndex((b) => b.name === name);
  if (i < 0 || (!dx && !dy)) return rig;
  const b = rig.bones[i];
  const a = moveJoint(rig, b.name, b.x + dx, b.y + dy);
  const moved = a.bones[i];
  return moveJoint(a, `${b.name}.tip`, moved.x2 + dx, moved.y2 + dy);
}

/** The x of the body's middle line (the spine, or the body bone), for mirroring. */
export function spineAxis(rig: RigData): number {
  const centre = rig.bones.filter((b) => ['hips', 'spine', 'neck', 'head', 'body', 'top'].includes(b.role));
  if (!centre.length) return rig.anchor[0];
  const spine = centre.find((b) => b.role === 'spine' || b.role === 'body') ?? centre[0];
  return (spine.x + spine.x2) / 2;
}

const PAIR = /^(arm|leg|legF|legB|wing)([LR])(\d)$/;

function mirrorRole(role: BoneRole): BoneRole | null {
  const m = PAIR.exec(role);
  return m ? (`${m[1]}${m[2] === 'L' ? 'R' : 'L'}${m[3]}` as BoneRole) : null;
}

/**
 * Makes both sides match: copies one side's limbs onto the other, mirrored about the spine for
 * drawings that face the viewer, or at the same place (the far limb behind the near one) for side
 * views, where only missing limbs are added. `from` picks the side to copy (default: the side with
 * more bones, left on a tie).
 */
export function mirrorSides(rig: RigData, from?: 'L' | 'R'): RigData {
  const bones = rig.bones;
  const counts = { L: 0, R: 0 };
  bones.forEach((b) => {
    const m = PAIR.exec(b.role);
    if (m) counts[m[2] as 'L' | 'R']++;
  });
  if (!counts.L && !counts.R) return rig;
  const src = from ?? (counts.R > counts.L ? 'R' : 'L');
  const sideView = rig.facing !== 0 || rig.kind === 'quadruped';
  const axis = spineAxis(rig);
  const r = touched(rig);
  let changed = false;
  const byRole = new Map(r.bones.map((b, i) => [b.role, i] as [string, number]));
  const nameTaken = (n: string) => r.bones.some((b) => b.name === n);
  const mx = (x: number) => (sideView ? x : 2 * axis - x);
  bones.forEach((b) => {
    const m = PAIR.exec(b.role);
    if (!m) return;
    const other = mirrorRole(b.role)!;
    const oi = byRole.get(other);
    const fill = oi === undefined;
    // limbs the other side lacks are always added; existing ones are overwritten from `src` only
    // when the drawing faces the viewer
    if (!fill && (sideView || m[2] !== src)) return;
    const copy: RigBone = { ...b, x: mx(b.x), x2: mx(b.x2), dynamic: b.dynamic ? { ...b.dynamic } : undefined };
    if (!copy.dynamic) delete copy.dynamic;
    if (fill) {
      const pRole = b.parent >= 0 ? rig.bones[b.parent].role : null;
      const pMirror = pRole ? mirrorRole(pRole) : null;
      copy.parent = pMirror && byRole.has(pMirror) ? byRole.get(pMirror)! : b.parent;
      copy.role = other;
      copy.name = nameTaken(other) ? uniqueName(r, other) : other;
      byRole.set(other, r.bones.length);
      r.bones.push(copy);
    } else {
      const t = r.bones[oi];
      t.x = copy.x;
      t.y = copy.y;
      t.x2 = copy.x2;
      t.y2 = copy.y2;
    }
    changed = true;
  });
  return changed ? r : rig;
}

function uniqueName(rig: RigData, base: string): string {
  const stem = base.replace(/\d+$/, '');
  for (let k = 1; ; k++) if (!rig.bones.some((b) => b.name === `${stem}${k}`)) return `${stem}${k}`;
}

export interface WigglyOptions {
  /** Bones in the chain (default from its length: 1-3). */
  segments?: number;
  spring?: Partial<DynamicSpec>;
  /** Attach to this bone instead of the one at the joint. */
  parent?: string;
}

/**
 * Adds a springy chain (a tail, ears, hair, an antenna, a scarf) from a joint (`Joint.id`) or any point
 * in art px, along the drag to `to`.
 */
export function addDynamic(rig: RigData, from: string | Point, to: Point, opts: WigglyOptions = {}): RigData {
  if (!rig.bones.length) return rig;
  let start: Point;
  let parent = -1;
  if (typeof from === 'string') {
    const j = findJoint(rig, from);
    if (!j) return rig;
    start = [j.x, j.y];
    // at a tip it hangs from that bone; at a start from the bone that starts there
    const tip = j.ends.find((e) => e.end === 1);
    parent = (tip ?? j.ends[0]).bone;
  } else {
    start = from;
    parent = nearestBone(rig, from);
  }
  if (opts.parent) {
    const pi = rig.bones.findIndex((b) => b.name === opts.parent);
    if (pi >= 0) parent = pi;
  }
  const len = Math.hypot(to[0] - start[0], to[1] - start[1]);
  if (len < 2) return rig;
  const height = Math.max(8, rig.anchor[1] - Math.min(...rig.bones.map((b) => Math.min(b.y, b.y2))));
  const n = Math.max(1, Math.min(4, Math.round(opts.segments ?? Math.min(3, Math.max(1, Math.round(len / (0.14 * height)))))));
  const r = touched(rig);
  const spring: DynamicSpec = { ...DEFAULT_SPRING, ...opts.spring };
  let prev = parent;
  for (let k = 0; k < n; k++) {
    const a: Point = [start[0] + ((to[0] - start[0]) * k) / n, start[1] + ((to[1] - start[1]) * k) / n];
    const b: Point = [start[0] + ((to[0] - start[0]) * (k + 1)) / n, start[1] + ((to[1] - start[1]) * (k + 1)) / n];
    const name = uniqueName(r, 'extra1');
    r.bones.push({ name, role: 'extra', parent: prev, x: a[0], y: a[1], x2: b[0], y2: b[1], dynamic: { ...spring } });
    prev = r.bones.length - 1;
  }
  return r;
}

function nearestBone(rig: RigData, p: Point): number {
  let best = 0, bd = Infinity;
  rig.bones.forEach((b, i) => {
    const vx = b.x2 - b.x, vy = b.y2 - b.y;
    const L2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - b.x) * vx + (p[1] - b.y) * vy) / L2));
    const d = Math.hypot(p[0] - b.x - t * vx, p[1] - b.y - t * vy);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/**
 * Removes a bone and everything hanging off it (a sword read as an arm, a wrong wiggly bit). The last
 * root of the skeleton can't be removed.
 */
export function removeBone(rig: RigData, name: string): RigData {
  const i = rig.bones.findIndex((b) => b.name === name);
  if (i < 0) return rig;
  const gone = new Set<number>([i]);
  rig.bones.forEach((b, k) => {
    if (b.parent >= 0 && gone.has(b.parent)) gone.add(k);
  });
  const roots = rig.bones.filter((b, k) => b.parent < 0 && !gone.has(k));
  if (!roots.length) return rig;
  const r = touched(rig);
  const remap = new Map<number, number>();
  const kept: RigBone[] = [];
  r.bones.forEach((b, k) => {
    if (gone.has(k)) return;
    remap.set(k, kept.length);
    kept.push(b);
  });
  for (const b of kept) b.parent = b.parent >= 0 ? remap.get(b.parent) ?? -1 : -1;
  const names = new Set(kept.map((b) => b.name));
  r.bones = kept;
  if (r.parts) {
    r.parts = r.parts.map((p) => ({ ...p, bones: p.bones.filter((n) => names.has(n)) })).filter((p) => p.bones.length || p.layer);
  }
  return r;
}

/** "Something I'm holding": the bone moves as one stiff piece (no bending, no springiness). */
export function setRigid(rig: RigData, name: string, rigid = true): RigData {
  const i = rig.bones.findIndex((b) => b.name === name);
  if (i < 0 || !!rig.bones[i].rigid === rigid) return rig;
  const r = cloneRig(rig);
  const b = r.bones[i];
  if (rigid) {
    b.rigid = true;
    delete b.dynamic;
  } else delete b.rigid;
  return r;
}

/** Makes a bone springy (a spec), or stiff again (null). */
export function setDynamic(rig: RigData, name: string, spring: Partial<DynamicSpec> | null): RigData {
  const i = rig.bones.findIndex((b) => b.name === name);
  if (i < 0) return rig;
  const r = cloneRig(rig);
  const b = r.bones[i];
  if (spring) {
    b.dynamic = { ...DEFAULT_SPRING, ...b.dynamic, ...spring };
    delete b.rigid;
  } else delete b.dynamic;
  return r;
}

/** Which way the drawing looks: 1 right, -1 left, 0 at the viewer. */
export function setFacing(rig: RigData, facing: Facing): RigData {
  if (rig.facing === facing) return rig;
  const r = cloneRig(rig);
  r.facing = facing;
  return r;
}

/** The ground contact and origin of the game object (the Desk's feet pin), art px. */
export function setAnchor(rig: RigData, x: number, y: number): RigData {
  if (rig.anchor[0] === x && rig.anchor[1] === y) return rig;
  const r = cloneRig(rig);
  r.anchor = [x, y];
  return r;
}

/** Bouncy (`amount`), Speedy (`speed`) or Off for one move; null restores the move's defaults. */
export function setTweak(rig: RigData, clip: string, tweak: AnimTweak | null): RigData {
  const r = cloneRig(rig);
  const anims = { ...(r.anims ?? {}) };
  const t: AnimTweak = { ...(anims[clip] ?? {}), ...(tweak ?? {}) };
  if (!tweak || ((t.amount ?? 1) === 1 && (t.speed ?? 1) === 1 && !t.off)) delete anims[clip];
  else anims[clip] = t;
  if (Object.keys(anims).length) r.anims = anims;
  else delete r.anims;
  return JSON.stringify(r.anims) === JSON.stringify(rig.anims) ? rig : r;
}

/**
 * The rig's joints as hints for a re-fit: where each role starts (`joints`) and where limbs end
 * (`tips`), art px. Extras are left out: a re-fit finds its own.
 */
export function hintsFromRig(rig: RigData): { joints: JointHints; tips: JointHints } {
  const joints: JointHints = {}, tips: JointHints = {};
  const hasChild = new Set(rig.bones.map((b) => b.parent));
  rig.bones.forEach((b, i) => {
    if (b.role === 'extra') return;
    joints[b.role] = [b.x, b.y];
    if (!hasChild.has(i)) tips[b.role] = [b.x2, b.y2];
  });
  return { joints, tips };
}

export interface RefitOptions {
  /** Keep the current joints as hints (hand-placed joints survive a re-fit). */
  keep?: boolean;
  /** Joint hints from a vision model (they win over kept joints). */
  hints?: JointHints;
  tipHints?: JointHints;
  facing?: Facing;
  /** An analysis cache (see `AutoRigOptions.analyze`). */
  analyze?: (workSize: number) => Analysis;
}

function refit(input: RigInput, rig: RigData, kind: CharacterKind, opts: RefitOptions): AutoRigResult {
  const kept = opts.keep ? hintsFromRig(rig) : { joints: {}, tips: {} };
  const joints = { ...kept.joints, ...opts.hints };
  const tips = { ...kept.tips, ...opts.tipHints };
  const hinted = Object.keys(joints).length > 0 || Object.keys(tips).length > 0;
  const res = autoRig(input, kind, {
    hints: hinted ? joints : undefined,
    tipHints: hinted ? tips : undefined,
    unsnapped: opts.keep ? 'keep' : 'drop',
    facing: opts.facing ?? (kind === rig.kind ? rig.facing : undefined),
    made: opts.hints ? 'ai' : opts.keep && rig.made === 'hand' ? 'hand' : 'auto',
    analyze: opts.analyze,
  });
  if (rig.anims) res.rig.anims = { ...rig.anims };
  return res;
}

/**
 * "What is it?": re-fits the drawing as another kind. Joints placed by hand are kept as hints where
 * the new kind has the same limbs.
 */
export function setKind(input: RigInput, rig: RigData, kind: CharacterKind, opts: RefitOptions = {}): AutoRigResult {
  return refit(input, rig, kind, { keep: rig.made === 'hand', ...opts });
}

/**
 * "Magic bones": a fresh local auto-rig of the same kind (`keep` holds on to the current joints as
 * hints, e.g. after a redraw; `hints` are a vision model's joints).
 */
export function magicBones(input: RigInput, rig: RigData, opts: RefitOptions = {}): AutoRigResult {
  return refit(input, rig, rig.kind, opts);
}

/** Width and height of the art a rig was fitted to, from its `artHash` (`<w>x<h>:<hash>`). */
export function artSizeOf(rig: RigData): [number, number] | null {
  const m = /^(\d+)x(\d+):/.exec(rig.artHash);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/**
 * A rig fitted to the same drawing at another size (a 2x export, a downscaled texture). The player binds
 * with this, so a bake made ahead of time (the editor's) must be made with it too.
 */
export function scaleRigTo(rig: RigData, w: number, h: number): RigData {
  const size = artSizeOf(rig);
  if (!size || (size[0] === w && size[1] === h)) return rig;
  const kx = w / size[0], ky = h / size[1];
  const r = cloneRig(rig);
  for (const b of r.bones) {
    b.x *= kx;
    b.y *= ky;
    b.x2 *= kx;
    b.y2 *= ky;
  }
  r.anchor = [r.anchor[0] * kx, r.anchor[1] * ky];
  if (r.skin?.cell) r.skin = { ...r.skin, cell: r.skin.cell * Math.sqrt(kx * ky) };
  return r;
}

/**
 * Bones for a redrawn drawing that already had some. The same box (colouring in, small fixes) keeps
 * the bones as they are; a different box (exports are trimmed, so coordinates move) re-fits, keeping
 * joints placed by hand as hints, shifted with the drawing's feet.
 */
export function rigForRedraw(input: RigInput, previous: RigData, kind: CharacterKind = previous.kind, opts: RefitOptions = {}): RigResult & { kept: boolean } {
  const size = artSizeOf(previous);
  const img = input.image;
  if (kind === previous.kind && size && size[0] === img.width && size[1] === img.height) {
    return { rig: { ...cloneRig(previous), artHash: hashPixels(img) }, confidence: 1, notes: [], issues: [], kept: true };
  }
  const fresh = autoRig(input, kind, { facing: kind === previous.kind ? previous.facing : undefined, analyze: opts.analyze });
  if (previous.made !== 'hand' || kind !== previous.kind) {
    if (previous.anims) fresh.rig.anims = { ...previous.anims };
    return { ...fresh, kept: false };
  }
  const dx = fresh.rig.anchor[0] - previous.anchor[0], dy = fresh.rig.anchor[1] - previous.anchor[1];
  const moved = cloneRig(previous);
  for (const b of moved.bones) {
    b.x += dx;
    b.y += dy;
    b.x2 += dx;
    b.y2 += dy;
  }
  const res = refit(input, moved, kind, { keep: true, ...opts });
  return { ...res, kept: false };
}
