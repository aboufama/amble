/**
 * Bones edits on top of the rig core's pure editing API (§7.11), with the choices the Bones view makes:
 * which side Mirror sides copies from, where a wiggly bit added from the keyboard points, and how much
 * a Remove takes with it. Pure: `(rig, ...) => RigData`.
 */
import { addDynamic, findJoint, mirrorSides, removeBone, spineAxis, type Point, type RigData, type Side } from '../cores/rig';

/**
 * Mirror sides: copies the side the student fixed last onto the other, about the spine (or, with no
 * such side, the side with more bones). Returns the same rig when there is nothing to copy.
 */
export function mirrorBones(rig: RigData, lastSide: Side | null): RigData {
  return mirrorSides(rig, lastSide === 'L' || lastSide === 'R' ? lastSide : undefined);
}

/** The x of the line Mirror sides reflects about. */
export function mirrorAxis(rig: RigData): number {
  return spineAxis(rig);
}

/** The drawing's middle (between the head top and the feet, on the spine): wiggly bits point away from it. */
export function bodyCentre(rig: RigData): Point {
  let top = Infinity;
  for (const b of rig.bones) top = Math.min(top, b.y, b.y2);
  const bottom = rig.anchor[1];
  return [spineAxis(rig), Number.isFinite(top) ? (top + bottom) / 2 : bottom];
}

/** How tall the bones stand, art px (at least 8). */
export function boneHeight(rig: RigData): number {
  let top = Infinity;
  for (const b of rig.bones) top = Math.min(top, b.y, b.y2);
  return Math.max(8, rig.anchor[1] - (Number.isFinite(top) ? top : rig.anchor[1] - 8));
}

/**
 * A wiggly bit from the keyboard (Enter on a star in wiggly mode): it grows out of the star, away from
 * the body's middle, about a fifth of the character's height long.
 */
export function keyboardWiggly(rig: RigData, jointId: string): RigData {
  const j = findJoint(rig, jointId);
  if (!j) return rig;
  const [cx, cy] = bodyCentre(rig);
  let dx = j.x - cx, dy = j.y - cy;
  const len = Math.hypot(dx, dy);
  if (len < 1) {
    dx = 0;
    dy = -1;
  } else {
    dx /= len;
    dy /= len;
  }
  const reach = 0.2 * boneHeight(rig);
  return addDynamic(rig, jointId, [j.x + dx * reach, j.y + dy * reach]);
}

/** The id of the newest bone's tip star (the end of a wiggly bit just added). */
export function newestTip(rig: RigData): string | null {
  const b = rig.bones[rig.bones.length - 1];
  return b ? `${b.name}.tip` : null;
}

/** Remove: the rig without the bone and what hangs off it, and how many bones went. */
export function removeWithCount(rig: RigData, name: string): { rig: RigData; removed: number } {
  const next = removeBone(rig, name);
  return { rig: next, removed: next === rig ? 0 : rig.bones.length - next.bones.length };
}
