/**
 * The `config` slice (M7): the resolved AI configuration (the AI core's `resolveAiConfig`: managed config >
 * `VITE_AMBLE_*` > class link > manual settings), the class this Chromebook joined, and what follows from
 * them: the class's AI mode, the content level, the district's ceiling, and the school and shared-device
 * flags. Every write recomputes the derived fields, so `ai` and `classLink` can arrive in any order.
 *
 * Other modules read `aiMode` and `level` for the class; `effectiveAiMode` and `effectiveLevel` also apply a
 * world's assignment, which can lower both but never raise them (§5.13, §5.14).
 */
import { BUILD } from '../app/env';
import { onManagedConfigChange, resolveAiConfig, type AiConfig } from '../cores/ai';
import type { AiMode, Assignment, ClassLinkV1, Level } from '../model/types';
import { getState, setState } from './store';

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

export const LEVELS: readonly Level[] = ['elementary', 'middle', 'high'];
export const AI_MODES: readonly AiMode[] = ['off', 'explain', 'on'];

/** The more careful of two content levels. */
export function lowerLevel(a: Level, b: Level): Level {
  return LEVELS.indexOf(a) <= LEVELS.indexOf(b) ? a : b;
}

/** The more careful of two AI modes (off < explain only < on). */
export function lowerMode(a: AiMode, b: AiMode): AiMode {
  return AI_MODES.indexOf(a) <= AI_MODES.indexOf(b) ? a : b;
}

export function initialConfig(): ConfigSlice {
  return { ai: null, aiMode: 'off', level: 'middle', levelMax: 'high', classLink: null, school: BUILD.school, shared: false };
}

/** Everything the slice derives from the resolved config and the joined class. */
export function deriveConfig(ai: AiConfig | null, classLink: ClassLinkV1 | null, buildSchool: boolean = BUILD.school): Omit<ConfigSlice, 'ai' | 'classLink'> {
  const levelMax = ai?.ageBandMax ?? 'high';
  // The core already folds the class link's level into ageBand (and caps it); before it resolves, the link's.
  const level = lowerLevel(ai?.ageBand ?? classLink?.level ?? 'middle', levelMax);
  let aiMode: AiMode = 'off';
  if (ai?.enabled) {
    // An expired link no longer speaks for the class; the district's endpoint still does.
    const linkMode = classLink && !ai.expired ? classLink.mode : 'on';
    aiMode = lowerMode('on', linkMode);
  }
  return {
    aiMode,
    level,
    levelMax,
    school: buildSchool || Boolean(ai?.schoolMode),
    shared: Boolean(ai?.sharedDevice),
  };
}

/**
 * Writes the slice. When `ai` or `classLink` changes, the derived fields are recomputed from them; a field
 * given explicitly in the same patch wins (tests set a level directly).
 */
export function setConfig(patch: Partial<ConfigSlice>): void {
  setState((s) => {
    const { ai, classLink, ...explicit } = patch;
    if ('ai' in patch) s.config.ai = ai ?? null;
    if ('classLink' in patch) s.config.classLink = classLink ?? null;
    if ('ai' in patch || 'classLink' in patch) Object.assign(s.config, deriveConfig(s.config.ai as AiConfig | null, s.config.classLink as ClassLinkV1 | null));
    Object.assign(s.config, explicit);
  });
}

/** Reads started, and the newest one written: an older read never writes over a newer one. */
let reads = 0;
let written = 0;

/**
 * Reads every configuration source again (at boot, after Join, Leave, a change in Settings, or a new managed
 * configuration). Overlapping reads can finish out of order (Join, then Leave at once): the newest read
 * wins, whichever finishes last.
 */
export async function refreshConfig(): Promise<AiConfig> {
  const read = ++reads;
  const ai = await resolveAiConfig();
  if (read > written) {
    written = read;
    setConfig({ ai });
  }
  return ai;
}

/**
 * Takes a new ChromeOS managed configuration as soon as the admin pushes it (§5.14): the AI helper, the
 * class's mode, the content level and the locks follow without a reload. Returns a function that stops.
 */
export function watchManagedConfig(nav: unknown = globalThis.navigator): () => void {
  return onManagedConfigChange(() => void refreshConfig().catch(() => undefined), nav);
}

/** The AI mode in a world: the class's, lowered by the world's assignment. */
export function effectiveAiMode(assignment: Pick<Assignment, 'ai'> | null | undefined, config: Pick<ConfigSlice, 'aiMode'> = getState().config): AiMode {
  return assignment ? lowerMode(config.aiMode, assignment.ai) : config.aiMode;
}

/** The content level in a world: the class's, lowered by the world's assignment. */
export function effectiveLevel(assignment: Pick<Assignment, 'level'> | null | undefined, config: Pick<ConfigSlice, 'level'> = getState().config): Level {
  return assignment?.level ? lowerLevel(config.level, assignment.level) : config.level;
}
