/**
 * The `config` slice (M7 owns; FOUNDATION-STUB): the resolved AI configuration, the class and the build's
 * school flags. M7 resolves it at boot (`resolveAiConfig`) and after Join/Leave.
 */
import { BUILD } from '../app/env';
import type { AiConfig } from '../cores/ai';
import type { AiMode, ClassLinkV1, Level } from '../model/types';
import { setState } from './store';

export interface ConfigSlice {
  ai: AiConfig | null;
  aiMode: AiMode;
  level: Level;
  /** The highest content level the district allows. */
  levelMax: Level;
  classLink: ClassLinkV1 | null;
  /** A school build (managed config or `VITE_AMBLE_SCHOOL_MODE`). */
  school: boolean;
  /** A shared device (carts): nudges to Save to Drive. */
  shared: boolean;
}

export function initialConfig(): ConfigSlice {
  return { ai: null, aiMode: 'off', level: 'middle', levelMax: 'high', classLink: null, school: BUILD.school, shared: false };
}

export function setConfig(patch: Partial<ConfigSlice>): void {
  setState((s) => {
    Object.assign(s.config, patch);
  });
}
