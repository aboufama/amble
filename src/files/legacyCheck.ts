/**
 * The light half of the old-Amble rescue (§4.7), run at every boot: is there an old autosave that was
 * never brought in nor dismissed? And "Not now". The rescue itself (pictures, sounds, a new world) is in
 * legacy.ts, loaded only when a student says Bring them. The old save is only ever read.
 */
import { legacyImportFrom, readLegacyAutosave, type LegacyImport } from '../legacy/reader';
import { sha256Hex } from '../model/ids';
import type { Store } from '../store/api';

/** A stable fingerprint of an old project's drawings and sounds (what `settings.legacy.hash` keeps). */
export async function legacyHash(l: LegacyImport): Promise<string> {
  const text = JSON.stringify([l.title, l.drawings.map((d) => d.dataUrl), l.sounds.map((s) => s.dataUrl)]);
  return sha256Hex(new TextEncoder().encode(text));
}

export async function findLegacy(deps: { store: Store; read?: (key: string) => Promise<unknown> }): Promise<LegacyImport | null> {
  try {
    if (await deps.store.settings.get('legacy')) return null;
  } catch {
    return null;
  }
  const found = await readLegacyAutosave(deps.read);
  return found && (found.drawings.length || found.sounds.length) ? found : null;
}

export async function dismissLegacy(deps: { store: Store; now?: () => number }, l: LegacyImport | null): Promise<void> {
  const hash = l ? await legacyHash(l) : '';
  await deps.store.settings.put('legacy', { hash, at: (deps.now ?? Date.now)(), choice: 'dismissed' });
}

/** An old `.amble` JSON file (format 'amble', version 1) goes through the same rescue. */
export function legacyFromFileText(text: string): LegacyImport | null {
  try {
    return legacyImportFrom(JSON.parse(text));
  } catch {
    return null;
  }
}
