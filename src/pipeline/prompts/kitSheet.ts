/**
 * The kit cheat sheet for the build prompt, generated from the kit's API (§5.3; M5 owns).
 * FOUNDATION-STUB: one line per member of `KIT_REFERENCE` (scene first, then each namespace).
 */
import { KIT_REFERENCE, type KitReference } from '../../cores/play';

export function kitSheet(api: KitReference = KIT_REFERENCE): string {
  return api.namespaces
    .flatMap((ns) => ns.members.map((m) => `${ns.name ? `${ns.name}.` : ''}${m.signature}  // ${m.doc}`))
    .join('\n');
}
