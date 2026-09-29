/**
 * Amble rig format v1: "bones under the art".
 *
 * `RigData` is the only thing that is stored (a few hundred bytes to ~2 KB of JSON next to the drawing).
 * Everything else (`BoundRig`: part atlas, lattice mesh, bone weights) is derived deterministically from
 * the drawing's pixels plus the bones, and can be cached or baked by `bindKey()`.
 *
 * Coordinates are art pixels of the flattened drawing: x right, y down, angles in radians (positive =
 * clockwise on screen).
 */

export type CharacterKind =
  | 'biped' // people, robots, anything standing on two legs
  | 'quadruped' // dogs, horses, cats (side view)
  | 'flyer' // birds, bats, dragons (wings)
  | 'swimmer' // fish, sharks, snakes, worms (a wavy spine)
  | 'blob' // slimes, ghosts, jelly: no limbs, squash and wobble
  | 'object'; // vehicles, items, props: rigid, maybe a few hinged bits

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

export const BONE_ROLES: readonly BoneRole[] = [
  'hips', 'spine', 'neck', 'head',
  'armL1', 'armL2', 'armR1', 'armR2',
  'legL1', 'legL2', 'legR1', 'legR2',
  'legFL1', 'legFL2', 'legFR1', 'legFR2', 'legBL1', 'legBL2', 'legBR1', 'legBR2',
  'tail1', 'tail2', 'tail3',
  'wingL1', 'wingL2', 'wingR1', 'wingR2',
  'body', 'top',
  'extra',
];

export interface DynamicSpec {
  /** 0..1: how strongly the bone returns to its animated pose each frame. */
  stiffness: number;
  /** 0..1: velocity kept per frame (1 = no damping). */
  damping: number;
  /** px/s² in art space pulling the tip down (hair and tails droop, antennas don't). */
  gravity: number;
}

export interface RigBone {
  /** Unique within the rig, e.g. "armL1" or "extra3". */
  name: string;
  role: BoneRole;
  /** Index of the parent bone in `bones` (parents come first); -1 = child of the rig root. */
  parent: number;
  /** Joint (bone head) in art pixels; the rest pose is the drawing as drawn. */
  x: number;
  y: number;
  /** Bone tip in art pixels. */
  x2: number;
  y2: number;
  /** Secondary motion: the bone lags and swings (tails, ears, hair, antennas, capes). */
  dynamic?: DynamicSpec;
  /** Vertices of this bone follow it rigidly (no blending with neighbours): hats, swords, wheels. */
  rigid?: boolean;
}

/** A drawable piece. Comes from an editor layer (exact) or from the auto-cut of a flat drawing. */
export interface RigPart {
  name: string;
  /** Bones whose region makes up this part (auto-cut) or that the layer is bound to. */
  bones: string[];
  /** Draw order, low = behind. */
  order: number;
  /** Editor layer key (`part:<name>`) when the part was drawn on its own layer. */
  layer?: string;
}

/** Student tweaks to a procedural clip ("walk bouncier"): the Bones view's Bouncy/Speedy sliders. */
export interface AnimTweak {
  /** Playback rate multiplier. */
  speed?: number;
  /** Amplitude multiplier. */
  amount?: number;
  off?: boolean;
}

export type Facing = 1 | -1 | 0;

export interface RigData {
  format: 'amble-rig';
  v: 1;
  kind: CharacterKind;
  /** Which way the drawing looks: 1 = right, -1 = left, 0 = at the viewer. */
  facing: Facing;
  /** Ground contact and origin of the game object, in art pixels. */
  anchor: [number, number];
  /** Parents before children. */
  bones: RigBone[];
  /** Omitted = auto-cut by bone chains. */
  parts?: RigPart[];
  /** Mesh cell size in art px and blend width (fraction of the limb radius at each joint). */
  skin?: { cell?: number; blend?: number };
  /** Hash of the art pixels the rig was fitted to (`hashPixels`). If the art changes, re-bind (bones kept). */
  artHash: string;
  /** Who placed the joints last. */
  made: 'auto' | 'ai' | 'hand';
  anims?: Record<string, AnimTweak>;
}

export type Point = [number, number];

/**
 * Joint hints from a guide pose or a vision model, in art pixels: each role maps to where that bone
 * STARTS (its joint): hips/spine = pelvis, head = neck, armL1 = left shoulder, armL2 = left elbow,
 * legL1 = left hip, legL2 = left knee, tail1 = tail base, wingL1 = wing root...
 */
export type JointHints = Partial<Record<BoneRole, Point>>;

/** RGBA pixels, straight (non-premultiplied) alpha. `ImageData` satisfies this. */
export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** An editor layer: same pixel space as the flattened drawing, optionally offset (trimmed cels). */
export type LayerPixels = Pixels & { x?: number; y?: number };

/**
 * The drawing to rig. `layers` are optional editor layers keyed by role:
 * - `lines`: the ink. When present it is the exact ink mask (no dark-colour guessing).
 * - `part:<name>` (`part:armL`, `part:head`, ...): exact parts with their hidden areas drawn.
 * - `shading`, `sketch`, `guide`, `reference`: never used to find bones.
 * - anything else (`colors`, ...) is ignored; the flattened `image` is what the game shows.
 */
export interface RigInput {
  image: Pixels;
  layers?: Record<string, LayerPixels>;
}

export interface PartRange {
  name: string;
  /** First triangle and triangle count in `indices` (triangles are sorted back to front). */
  first: number;
  count: number;
  order: number;
  /** Axis-aligned box of the part in the atlas (px) and on the drawing (art px). */
  atlas: { x: number; y: number; w: number; h: number };
  art: { x: number; y: number; w: number; h: number };
  /** Index of the bone that owns most of this part (its pivot for cut-out renderers). */
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

/** Everything derived from art + `RigData` (never stored as the source of truth). */
export interface BoundRig {
  rig: RigData;
  /** Size of the drawing in art px. */
  width: number;
  height: number;
  /** Rest vertex positions in art px (x0, y0, x1, y1...). */
  rest: Float32Array;
  /** Atlas UVs, 0..1. */
  uvs: Float32Array;
  /** Triangles (3 indices each), sorted back to front by part order. */
  indices: Uint16Array | Uint32Array;
  /** Up to 4 influences per vertex. */
  boneIdx: Uint8Array;
  boneW: Float32Array;
  /** The part atlas: each part's pixels, cut out, with synthesized hidden areas and seam bleed. */
  atlas: Pixels;
  partRanges: PartRange[];
  /** True when the parts were cut from a single flat drawing (hidden areas are guesses). */
  flat: boolean;
  stats: BindStats;
}
