/**
 * The kit cheat sheet in the build prompt (§5.3): one line per member, grouped by where it lives, made
 * from the kit's own reference (`KIT_REFERENCE`, plus `KIT_API.docs.actor` for what spawn helpers return).
 * Neighbouring properties with the same type and doc share a line (`controls.left, right, up: boolean`).
 * Generated once per app version, so the system prompt stays byte-stable.
 */
import { KIT_API, KIT_REFERENCE, type KitReference } from '../../cores/play';
import { kitDocs, type KitDoc } from '../kit';

/** `name: type` properties (not methods): their type, else null. */
function propertyType(m: KitDoc): string | null {
  const prefix = `${m.name}: `;
  return m.sig.startsWith(prefix) && !m.sig.includes('(') ? m.sig.slice(prefix.length) : null;
}

function lines(prefix: string, members: readonly KitDoc[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    const type = propertyType(m);
    const names = [m.name];
    while (type && i + 1 < members.length && propertyType(members[i + 1]) === type && members[i + 1].doc === m.doc) names.push(members[++i].name);
    const sig = type ? `${names.join(', ')}: ${type}` : m.sig;
    out.push(m.doc ? `${prefix}${sig}  // ${m.doc}` : `${prefix}${sig}`);
  }
  return out;
}

/** Namespaces in the order a game uses them. */
const ORDER = ['fx', 'ui', 'pattern', 'controls', 'music', 'combo', 'twists'];

export function kitSheet(api: KitReference = KIT_REFERENCE, actor: readonly KitDoc[] = KIT_API.docs.actor): string {
  const d = kitDocs(api, actor);
  const out: string[] = ['this (your Game scene):', ...lines('  this.', d.scene)];
  out.push('Actor (what spawn, spawnHero, spawnEnemy, spawnBoss and spawnItem return; behaviours chain):', ...lines('  actor.', d.actor));
  const names = [...ORDER.filter((n) => d.namespaces[n]), ...Object.keys(d.namespaces).filter((n) => !ORDER.includes(n)).sort()];
  for (const ns of names) out.push(`this.${ns}:`, ...lines(`  this.${ns}.`, d.namespaces[ns]));
  return out.join('\n');
}
