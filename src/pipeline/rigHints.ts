/**
 * AI joint hints for Magic bones (§5.12), only with district permission, a vision model and the
 * student's consent for that drawing. The only thing sent is a small black-on-white silhouette (no
 * colours, no inner lines); the reply's joints (0..1000 of the image) become `JointHints` in the
 * silhouette's pixels, which the rig snaps to its own skeleton.
 */
import { s, type Infer } from '../cores/ai';
import type { BoneRole, CharacterKind, JointHints, Point } from '../cores/rig';

const JOINT_NAMES = [
  'head_top', 'neck', 'pelvis', 'shoulder_l', 'elbow_l', 'hand_l', 'shoulder_r', 'elbow_r', 'hand_r',
  'hip_l', 'knee_l', 'foot_l', 'hip_r', 'knee_r', 'foot_r', 'tail_base', 'tail_tip',
  'wing_l_root', 'wing_l_tip', 'wing_r_root', 'wing_r_tip', 'nose',
] as const;

export const RIG_SCHEMA = s.object({
  kind: s.enum(['biped', 'quadruped', 'flyer', 'swimmer', 'blob', 'object'] as const),
  facing: s.enum(['viewer', 'left', 'right'] as const),
  joints: s.array(s.object({ name: s.enum(JOINT_NAMES), x: s.number({ min: 0, max: 1000 }), y: s.number({ min: 0, max: 1000 }) }), { max: 30 }),
  extras: s.array(s.object({ what: s.string({ max: 40 }), x: s.number({ min: 0, max: 1000 }), y: s.number({ min: 0, max: 1000 }) }), { max: 6 }),
});

export type RigWire = Infer<typeof RIG_SCHEMA>;

/** Where each named joint starts a bone, by body plan (image-left is Amble's L). */
function rolesFor(name: string, kind: CharacterKind): BoneRole[] {
  const four = kind === 'quadruped';
  switch (name) {
    case 'pelvis':
      return kind === 'biped' ? ['hips', 'spine'] : [];
    case 'neck':
      return kind === 'biped' || kind === 'flyer' ? ['head'] : ['neck'];
    case 'shoulder_l':
      return [four ? 'legFL1' : 'armL1'];
    case 'elbow_l':
      return [four ? 'legFL2' : 'armL2'];
    case 'shoulder_r':
      return [four ? 'legFR1' : 'armR1'];
    case 'elbow_r':
      return [four ? 'legFR2' : 'armR2'];
    case 'hip_l':
      return [four ? 'legBL1' : 'legL1'];
    case 'knee_l':
      return [four ? 'legBL2' : 'legL2'];
    case 'hip_r':
      return [four ? 'legBR1' : 'legR1'];
    case 'knee_r':
      return [four ? 'legBR2' : 'legR2'];
    case 'tail_base':
      return ['tail1'];
    case 'wing_l_root':
      return ['wingL1'];
    case 'wing_r_root':
      return ['wingR1'];
    default:
      return [];
  }
}

/** The reply as hints in the silhouette's pixels (`w` × `h`). Null when nothing usable came back. */
export function hintsOf(reply: RigWire, kind: CharacterKind, w: number, h: number): JointHints | null {
  const hints: JointHints = {};
  for (const j of reply.joints) {
    if (!Number.isFinite(j.x) || !Number.isFinite(j.y)) continue;
    const p: Point = [(Math.max(0, Math.min(1000, j.x)) / 1000) * w, (Math.max(0, Math.min(1000, j.y)) / 1000) * h];
    for (const role of rolesFor(j.name, kind)) hints[role] = p;
  }
  return Object.keys(hints).length ? hints : null;
}

export function rigUserText(kind: CharacterKind): string {
  const words: Record<CharacterKind, string> = { biped: 'a person or creature on two legs', quadruped: 'an animal on four legs', flyer: 'something with wings', swimmer: 'something that swims', blob: 'a blob with no legs', object: 'a thing' };
  return `The student says it is ${words[kind]}. Label its joints.`;
}

/** A PNG blob as a data URL (the only form an image part can take). */
export async function dataUrlOf(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'image/png'};base64,${btoa(bin)}`;
}
