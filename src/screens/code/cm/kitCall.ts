/**
 * A kit member as the student writes it (`this.fx.shake(intensity?, ms?)`). Kept apart from kitDocs so
 * the screen can show docs without pulling CodeMirror into its first chunk.
 */
import type { KitReferenceMember } from '../../../cores/play';

export interface KitDoc {
  /** '' for scene members (`this.spawnHero`), a namespace ('fx'), or 'actor' for character methods. */
  ns: string;
  member: KitReferenceMember;
}

export function kitCall(doc: KitDoc): string {
  if (doc.ns === '') return `this.${doc.member.signature}`;
  if (doc.ns === 'actor') return `.${doc.member.signature}`;
  return `this.${doc.ns}.${doc.member.signature}`;
}
