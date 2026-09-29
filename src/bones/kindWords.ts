/**
 * Kinds and facing in words, and the rig's facing number ↔ the app's facing word. Kept apart from the
 * rest of Bones' words so the kind picker (used on the First page) pulls in nothing of the rig engine.
 */
import { t, type MessageKey } from '../i18n';
import type { CharacterKind } from '../cores/rig';
import type { Facing } from '../model/types';

const KIND_PHRASES: Record<CharacterKind, MessageKey> = {
  biped: 'bones.kindBiped',
  quadruped: 'bones.kindQuadruped',
  flyer: 'bones.kindFlyer',
  swimmer: 'bones.kindSwimmer',
  blob: 'bones.kindBlob',
  object: 'bones.kindObject',
};

/** "A person", "Something that flies". */
export function kindPhrase(kind: CharacterKind): string {
  return t(KIND_PHRASES[kind]);
}

/** "facing you", "facing left". */
export function facingPhrase(facing: Facing): string {
  return t(facing === 'right' ? 'bones.facingRight' : facing === 'left' ? 'bones.facingLeft' : 'bones.facingYou');
}

/** The rig's facing (1 right, -1 left, 0 at you) as the app's word. */
export function facingWord(f: number): Facing {
  return f > 0 ? 'right' : f < 0 ? 'left' : 'viewer';
}

/** The app's facing word as the rig's number. */
export function rigFacing(f: Facing): 1 | -1 | 0 {
  return f === 'right' ? 1 : f === 'left' ? -1 : 0;
}
