/**
 * Magic bones with the AI helper (§2.11, §5.12): only when the district lets art go to the AI and a
 * vision model is set up, and only with the student's OK for that one drawing. A yes is remembered per
 * drawing in `Store.settings('consent')` (the time it was given); a "Just do it here" is remembered for
 * this session only, so the question comes back another day but never nags twice in a row.
 */
import type { AiConfig } from '../cores/ai';
import type { AiStatus, ArtId } from '../model/types';
import type { Store } from '../store/api';

/** The slice of the store consent needs (tests pass a fake). */
export type ConsentSettings = Pick<Store['settings'], 'get' | 'put'>;

/** Whether Magic bones may offer to send the outline at all. */
export function aiHintsAllowed(ai: Pick<AiConfig, 'enabled' | 'visionAllowed' | 'visionModel'> | null, status: AiStatus): boolean {
  return !!ai && ai.enabled && ai.visionAllowed && !!ai.visionModel && status === 'ready';
}

export interface ConsentMemory {
  /** 'yes' (remembered on this device), 'no' (said this session) or 'ask'. */
  answer(artId: ArtId): Promise<'yes' | 'no' | 'ask'>;
  /** Records the student's answer for this drawing. */
  remember(artId: ArtId, yes: boolean, now?: number): Promise<void>;
  /** Forgets a drawing's answer (the drawing was deleted). */
  forget(artId: ArtId): Promise<void>;
}

export function createConsentMemory(settings: ConsentSettings): ConsentMemory {
  const saidNo = new Set<ArtId>();
  const read = async (): Promise<Record<ArtId, number>> => {
    try {
      return (await settings.get('consent')) ?? {};
    } catch {
      return {};
    }
  };
  return {
    async answer(artId) {
      if (saidNo.has(artId)) return 'no';
      const all = await read();
      return all[artId] ? 'yes' : 'ask';
    },
    async remember(artId, yes, now = Date.now()) {
      if (!yes) {
        saidNo.add(artId);
        return;
      }
      saidNo.delete(artId);
      const all = await read();
      await settings.put('consent', { ...all, [artId]: now });
    },
    async forget(artId) {
      saidNo.delete(artId);
      const all = await read();
      if (!(artId in all)) return;
      const next = { ...all };
      delete next[artId];
      await settings.put('consent', next);
    },
  };
}
