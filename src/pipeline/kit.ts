/**
 * The kit as the pipeline sees it, from the player core (through the barrels): member docs grouped by
 * where they live (the prompt's cheat sheet and repair requests), and the validator's manifest. The scene
 * and its namespaces come from `KIT_REFERENCE`; what spawn helpers return comes from `KIT_API.docs.actor`.
 */
import { kitManifest, type KitManifest } from '../cores/ai';
import { KIT_API, KIT_REFERENCE, type KitReference } from '../cores/play';

/** One member: its name, a short signature and one line of docs. */
export interface KitDoc {
  name: string;
  sig: string;
  doc: string;
}

/** The kit's docs by where they live: `this.*`, what spawn helpers return, and the `this.<ns>` namespaces. */
export interface KitDocs {
  scene: KitDoc[];
  actor: KitDoc[];
  namespaces: Record<string, KitDoc[]>;
}

/** The kit's docs, grouped. */
export function kitDocs(ref: KitReference = KIT_REFERENCE, actor: readonly KitDoc[] = KIT_API.docs.actor): KitDocs {
  const out: KitDocs = { scene: [], actor: actor.map((m) => ({ name: m.name, sig: m.sig, doc: m.doc })), namespaces: {} };
  for (const ns of ref.namespaces) {
    const members = ns.members.map((m) => ({ name: m.name, sig: m.signature, doc: m.doc }));
    if (ns.name === '') out.scene.push(...members);
    else out.namespaces[ns.name] = members;
  }
  return out;
}

/** The validator's view of the kit (§5.7): the real kit manifest (names on `this`, namespaces, behaviours, synonyms, reserved names). */
export function kitManifestFor(): KitManifest {
  return kitManifest();
}

/** The signature line for `this.<name>`, `this.<ns>.<name>` or an actor's `<name>`, for repair requests. */
export function signatureOf(path: string, d: KitDocs = kitDocs()): string | null {
  const m = /^(?:this\.)?(?:(\w+)\.)?(\w+)$/.exec(path);
  if (!m) return null;
  const [, ns, name] = m;
  if (ns && d.namespaces[ns]) {
    const doc = d.namespaces[ns].find((x) => x.name === name);
    return doc ? `this.${ns}.${doc.sig}  // ${doc.doc}` : null;
  }
  const scene = d.scene.find((x) => x.name === name);
  if (scene) return `this.${scene.sig}  // ${scene.doc}`;
  const actor = d.actor.find((x) => x.name === name);
  return actor ? `actor.${actor.sig}  // ${actor.doc}` : null;
}
