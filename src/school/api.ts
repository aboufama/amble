/**
 * Class links, joining a class and assignment checks (§2.13, §2.14, §8.4; M7).
 *
 * The class this Chromebook joined lives in `settings.classLink` (the app's `ClassLinkV1`, with the class's
 * AI mode and assignment) and in localStorage: the AI core's own copy, which is what `resolveAiConfig` reads
 * for the address and the class code, and the app's copy beside it (the core's format has no place for the
 * assignment). Joining and leaving keep them in step, and so does boot, if one of them was lost.
 */
import { classLinkToCore, clearClassLink, loadClassLink, saveClassLink } from '../cores/ai';
import type { GameManifest } from '../cores/play';
import { isClassLinkV1 } from '../model/guards';
import type { CheckResult, ClassLinkIntake, ClassLinkV1, World } from '../model/types';
import { refreshConfig, setConfig } from '../state/config';
import { getState } from '../state/store';
import type { Store } from '../store/api';
import { currentClassName, loadClassCopy, readIntake, restoredClassLink, saveClassCopy } from './classLink';

export interface SchoolApi {
  /** Called by the router at boot with the location hash. */
  readClassLink(fragment: string): ClassLinkIntake | null;
  join(link: ClassLinkV1): Promise<void>;
  leave(): Promise<void>;
  /** Assignment auto-checks (§2.13), with a fresh robot test when a goal asks for one. */
  check(world: World, manifest: GameManifest): Promise<CheckResult[]>;
}

type KeyValue = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function local(): KeyValue | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function saveCoreCopy(link: ClassLinkV1): void {
  const core = classLinkToCore(link);
  try {
    if (core) saveClassLink(core, local());
    else clearClassLink(local());
    saveClassCopy(link, local());
  } catch {
    // Storage blocked: the class lasts for this visit (files-only mode).
  }
}

/** Boot: the joined class into the config slice, repairing whichever copy went missing. */
async function restoreClass(store: Store): Promise<void> {
  const stored = await store.settings.get('classLink').catch(() => null);
  let core = null;
  let copy = null;
  try {
    core = loadClassLink(local());
    copy = loadClassCopy(local());
  } catch {
    // Storage blocked: only the store's copy can be read.
  }
  if (stored && isClassLinkV1(stored)) {
    setConfig({ classLink: stored });
    if ((!core && stored.ai) || !copy) saveCoreCopy(stored);
    if (!core && stored.ai) await refreshConfig().catch(() => undefined);
    return;
  }
  // The store's copy is gone (cleared, or a save that failed): the class comes back, assignment and all.
  const link = restoredClassLink(core, copy);
  if (!link) return;
  setConfig({ classLink: link });
  await store.settings.put('classLink', link).catch(() => undefined);
  if (!core && link.ai) {
    saveCoreCopy(link);
    await refreshConfig().catch(() => undefined);
  }
}

export function createSchool(store: Store): SchoolApi {
  void restoreClass(store);
  return {
    readClassLink(fragment) {
      return readIntake(fragment, currentClassName(getState().config.classLink, local()));
    },
    async join(link) {
      saveCoreCopy(link);
      setConfig({ classLink: link });
      await store.settings.put('classLink', link).catch(() => undefined);
      await refreshConfig().catch(() => undefined);
    },
    async leave() {
      try {
        clearClassLink(local());
        saveClassCopy(null, local());
      } catch {
        // Nothing stored to clear.
      }
      setConfig({ classLink: null });
      await store.settings.remove('classLink').catch(() => undefined);
      await refreshConfig().catch(() => undefined);
    },
    async check(world, manifest) {
      // The checks parse code: loaded on first use, not with the app.
      const [{ checkWorld }, { toCheckResults }] = await Promise.all([import('./handin'), import('./checks')]);
      const { outcomes } = await checkWorld(world, manifest, { robot: true });
      return toCheckResults(outcomes);
    },
  };
}

