/**
 * The kit cheat sheet for the build prompt, generated from `KIT_API` (§5.3; M5 owns).
 * FOUNDATION-STUB: one line per member.
 */
import type { KitApi } from '../../cores/play';

export function kitSheet(api: KitApi): string {
  return api.namespaces
    .flatMap((ns) => ns.members.map((m) => `${ns.name ? `${ns.name}.` : ''}${m.signature}  // ${m.doc}`))
    .join('\n');
}
