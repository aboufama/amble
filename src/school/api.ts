/**
 * Class links, joining a class and assignment checks (§2.13, §2.14, §8.4; M7 owns).
 * FOUNDATION-STUB with basics: `readClassLink` decodes the link, `join` stores the class (settings, the
 * core's class-link store that `resolveAiConfig` reads, and the config slice), `leave` forgets it, and
 * `check` returns no results.
 */
import { classLinkToCore, clearClassLink, parseClassLink, resolveAiConfig, saveClassLink } from '../cores/ai';
import type { GameManifest } from '../cores/play';
import type { CheckResult, ClassLinkIntake, ClassLinkV1, World } from '../model/types';
import { setConfig } from '../state/config';
import { getState } from '../state/store';
import type { Store } from '../store/api';

export interface SchoolApi {
  /** Called by the router at boot with the location hash. */
  readClassLink(fragment: string): ClassLinkIntake | null;
  join(link: ClassLinkV1): Promise<void>;
  leave(): Promise<void>;
  /** Assignment auto-checks (§2.13). */
  check(world: World, manifest: GameManifest): Promise<CheckResult[]>;
}

function local(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function createSchoolStub(store: Store): SchoolApi {
  const refresh = async () => setConfig({ ai: await resolveAiConfig() });
  return {
    readClassLink(fragment) {
      const read = parseClassLink(fragment);
      if (!read) return null;
      if (!read.ok) return read;
      const current = getState().config.classLink;
      return { ok: true, link: read.link, switchingFrom: current && current.cls !== read.link.cls ? current.cls : null };
    },
    async join(link) {
      await store.settings.put('classLink', link);
      const core = classLinkToCore(link);
      if (core) saveClassLink(core, local());
      setConfig({ classLink: link, aiMode: link.mode, level: link.level });
      await refresh();
    },
    async leave() {
      await store.settings.remove('classLink');
      clearClassLink(local());
      setConfig({ classLink: null, aiMode: 'off' });
      await refresh();
    },
    check: async () => [],
  };
}
