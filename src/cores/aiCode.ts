/**
 * The AI core's code tools as the app sees them (§8.2): the spec-named adapters that read a game's code
 * with the validator (acorn), check it against the kit's API (`KIT_API`, with its docs) or parse AMBLE
 * PATCH replies. `./ai` re-exports them under the same names, so modules keep importing from there.
 *
 * They live apart from ./ai because that barrel loads with the app (class links, the AI configuration,
 * the safety floor): an adapter defined in it would bring the validator and the kit's docs into the first
 * load. Here they load with the screens and jobs that use them. Import this module dynamically, never
 * ./ai (a barrel already loaded at boot would drag everything it re-exports into the first load).
 */
// Straight from the modules, not the ../ai and ./play barrels: a group chunk takes what its members
// import, so a barrel import here would pull the whole AI core into this chunk.
import type { GameFile } from '../ai/gameFiles';
import { PatchParser } from '../ai/patch/parse';
import type { KitManifest } from '../ai/validate/types';
import { validateGame } from '../ai/validate/validate';
import { KIT_API, type KitApi } from '../play/kit/manifest';

/** The validator's and applier's file shape (`{ path, content }`); the player's is `GameFile` in ./play. */
export type SourceFile = GameFile;

/** `createPatchParser()`: the core's incremental AMBLE PATCH parser (`feed`, `snapshot`, `end`). */
export function createPatchParser(): PatchParser {
  return new PatchParser();
}

/** What the Game class declares, read without running it: its literal statics and its art keys. */
export interface StaticManifest {
  /** `config`, `art`, `dials`, `sounds`... as literal values (`DialSpec.for` included). */
  statics: Record<string, unknown>;
  art: { declared: string[]; used: string[]; missing: string[] };
}

/** `extractManifest`: the `statics` and `art` parts of `validateGame` (no auto-fixes). */
export function extractManifest(files: readonly SourceFile[], manifest: KitManifest = kitManifest()): StaticManifest {
  const r = validateGame([...files], { manifest, fix: false });
  return { statics: r.statics, art: r.art };
}

/** The kit's API as the validator's manifest: the player core's `KIT_API` (scene, namespaces, actor methods, synonyms, reserved names). */
export function kitManifest(api: KitApi = KIT_API): KitManifest {
  return api;
}
