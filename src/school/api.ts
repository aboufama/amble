/**
 * Class links, joining a class and assignment checks (§2.13, §2.14, §8.4; M7 owns).
 * FOUNDATION-STUB with basics: `readClassLink` decodes the link (the core's reader), `join` and `leave`
 * store the class in settings and the config slice; `check` returns no results.
 */
import { parseClassLink } from '../cores/ai';
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

export function createSchoolStub(store: Store): SchoolApi {
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
      setConfig({ classLink: link, aiMode: link.mode, level: link.level });
    },
    async leave() {
      await store.settings.remove('classLink');
      setConfig({ classLink: null, aiMode: 'off' });
    },
    check: async () => [],
  };
}
