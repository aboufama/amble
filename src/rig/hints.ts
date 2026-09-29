/**
 * Joint hints from outside the drawing: a vision model's joints (the `amble_rig` reply, 0..1000
 * coordinates of the silhouette it was shown) and the plain silhouette that is the only thing ever
 * sent. Hints go through the same snapping as the star-pose guide; limbs that don't snap are dropped.
 */
import { layerAlpha } from './analyze';
import type { BoneRole, CharacterKind, Facing, JointHints, Pixels, Point, RigInput } from './types';

/** Joint names in the vision reply. `_l` means the left side of the IMAGE (Amble's L). */
export type VisionJointName =
  | 'head_top' | 'neck' | 'pelvis' | 'shoulder_l' | 'elbow_l' | 'hand_l' | 'shoulder_r' | 'elbow_r' | 'hand_r'
  | 'hip_l' | 'knee_l' | 'foot_l' | 'hip_r' | 'knee_r' | 'foot_r' | 'tail_base' | 'tail_tip'
  | 'wing_l_root' | 'wing_l_tip' | 'wing_r_root' | 'wing_r_tip' | 'nose';

export interface VisionReply {
  kind?: string;
  facing?: 'viewer' | 'left' | 'right';
  joints: { name: VisionJointName | string; x: number; y: number }[];
  extras?: { what: string; x: number; y: number }[];
}

export interface HintSet {
  /** Where bones start, art px. */
  hints: JointHints;
  /** Where limbs end, art px. */
  tipHints: JointHints;
  facing?: Facing;
}

/**
 * A vision reply → hints for `autoRig` (with `unsnapped: 'drop'`), in the art px of a drawing
 * `w` × `h` (the silhouette sent had the same aspect, see `visionSilhouette`).
 */
export function hintsFromVision(reply: VisionReply, kind: CharacterKind, w: number, h: number): HintSet {
  const hints: JointHints = {}, tipHints: JointHints = {};
  const at = (x: number, y: number): Point | null =>
    Number.isFinite(x) && Number.isFinite(y) ? [Math.max(0, Math.min(1000, x)) * (w / 1000), Math.max(0, Math.min(1000, y)) * (h / 1000)] : null;
  const four = kind === 'quadruped';
  const J: Record<string, BoneRole[]> = {
    pelvis: kind === 'biped' ? ['hips', 'spine'] : [],
    neck: kind === 'biped' || kind === 'flyer' ? ['head'] : ['neck'],
    shoulder_l: four ? ['legFL1'] : ['armL1'],
    elbow_l: four ? ['legFL2'] : ['armL2'],
    shoulder_r: four ? ['legFR1'] : ['armR1'],
    elbow_r: four ? ['legFR2'] : ['armR2'],
    hip_l: four ? ['legBL1'] : ['legL1'],
    knee_l: four ? ['legBL2'] : ['legL2'],
    hip_r: four ? ['legBR1'] : ['legR1'],
    knee_r: four ? ['legBR2'] : ['legR2'],
    tail_base: ['tail1'],
    wing_l_root: ['wingL1'],
    wing_r_root: ['wingR1'],
  };
  const T: Record<string, BoneRole> = {
    head_top: 'head',
    hand_l: four ? 'legFL2' : 'armL2',
    hand_r: four ? 'legFR2' : 'armR2',
    foot_l: four ? 'legBL2' : 'legL2',
    foot_r: four ? 'legBR2' : 'legR2',
    tail_tip: 'tail3',
    wing_l_tip: 'wingL2',
    wing_r_tip: 'wingR2',
  };
  for (const j of reply.joints ?? []) {
    const p = at(j.x, j.y);
    if (!p) continue;
    for (const role of J[j.name] ?? []) hints[role] = p;
    const tip = T[j.name];
    if (tip) tipHints[tip] = p;
    if (j.name === 'tail_tip') tipHints.tail2 = p;
    // animals and fish look along their nose; people's heads end at the top
    if (j.name === 'nose' && kind !== 'biped') tipHints.head = p;
  }
  const facing: Facing | undefined = reply.facing === 'left' ? -1 : reply.facing === 'right' ? 1 : reply.facing === 'viewer' ? 0 : undefined;
  return { hints, tipHints, facing };
}

/**
 * The only thing ever sent to a vision model: the drawing's alpha as a black-on-white silhouette (no
 * colours, no inner lines), at most `maxSide` px on its long side, same aspect as the drawing.
 */
export function visionSilhouette(input: RigInput | Pixels, maxSide = 256): Pixels {
  const img = 'image' in input ? input.image : input;
  const k = Math.min(1, maxSide / Math.max(img.width, img.height));
  const W = Math.max(1, Math.round(img.width * k)), H = Math.max(1, Math.round(img.height * k));
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    // coverage of the source pixels under this output pixel
    const x0 = Math.floor(x / k), x1 = Math.max(x0 + 1, Math.floor((x + 1) / k));
    const y0 = Math.floor(y / k), y1 = Math.max(y0 + 1, Math.floor((y + 1) / k));
    let sum = 0, n = 0;
    for (let yy = y0; yy < Math.min(img.height, y1); yy++) for (let xx = x0; xx < Math.min(img.width, x1); xx++) {
      sum += layerAlpha(img, xx, yy);
      n++;
    }
    const v = 255 - Math.round(n ? sum / n : 0);
    const o = (y * W + x) * 4;
    data[o] = data[o + 1] = data[o + 2] = v;
    data[o + 3] = 255;
  }
  return { data, width: W, height: H };
}
