/**
 * Footsteps (§2.9, §4.5, §8.4; M9): one append-only timeline per world. `record` snapshots the world and
 * appends a step (merging dial bursts), `goBack` restores a snapshot and appends a step, `diff` says what
 * a step changed, and `attribute` keeps each code line's author (starter, AI, student or teacher).
 */
import { getServices } from '../app/services';
import { sourceFilesOf } from '../cores/ai';
import { uid } from '../model/ids';
import type { Author, CodeFile, StepDiff, StepId, StepInput, StepSnapshot, World } from '../model/types';
import type { Store } from '../store/api';
import { stepDiff } from './diff';
import { goBack } from './goBack';
import { attribute } from './provenance';
import { ensureHead, parentOf, record, type HistoryDeps } from './record';

export interface HistoryApi {
  /** Snapshots the world (code, cast, art versions, sounds, dials, twists), appends a step, merges dial bursts; returns the new world. */
  record(world: World, step: StepInput): Promise<World>;
  /** Loads the snapshot and appends a 'goback' step. */
  goBack(world: World, to: StepId): Promise<World>;
  /** Per-file unified diff + drawing changes. */
  diff(world: World, step: StepId): Promise<StepDiff>;
  /** Provenance runs (Myers line diff); teacher locks travel with their lines. */
  attribute(prev: CodeFile[], next: CodeFile[], by: Author): CodeFile[];
  /**
   * An addition to the spec's interface: gives the step a world is at a snapshot if it has none (worlds are
   * born with a first step but no snapshot). Call it when a world opens; it is cheap when there is one.
   */
  ensureHead(world: World): Promise<void>;
}

export interface HistoryOptions {
  /** The store (default: the app's, read at call time; without one, steps are only appended). */
  store?: () => Store | null;
  now?: () => number;
  newId?: () => StepId;
}

/** The code tools (the validator) load with the first diff, not with the app. */
type CodeTools = typeof import('../cores/aiCode');

/** The dial defaults a snapshot's code declares (`static dials`), for dials the student never moved. */
function dialDefaults(snap: StepSnapshot, { extractManifest }: CodeTools): Record<string, number> {
  try {
    const dials = extractManifest(sourceFilesOf(snap.code)).statics.dials;
    const out: Record<string, number> = {};
    if (dials && typeof dials === 'object') {
      for (const [key, spec] of Object.entries(dials as Record<string, unknown>)) {
        const value = (spec as { value?: unknown } | null)?.value;
        if (typeof value === 'number') out[key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** The app's store, or null before the services exist (tests that build worlds without an app). */
function appStore(): Store | null {
  try {
    return getServices().store;
  } catch {
    return null;
  }
}

export function createHistory(o: HistoryOptions = {}): HistoryApi {
  const deps: HistoryDeps = {
    store: o.store ?? appStore,
    now: o.now ?? (() => Date.now()),
    newId: o.newId ?? (() => uid('s_')),
  };
  return {
    record: (world, step) => record(deps, world, step),
    goBack: (world, to) => goBack(deps, world, to),
    async diff(world, stepId) {
      const store = deps.store();
      if (!store) return { files: [], drawings: [], dials: [] };
      const parent = parentOf(world, stepId);
      const [after, before] = await Promise.all([store.steps.get(stepId), parent ? store.steps.get(parent.id) : Promise.resolve(null)]);
      if (!after) return { files: [], drawings: [], dials: [] };
      const tools = before ? await import('../cores/aiCode') : null;
      const defaults = before && tools ? { ...dialDefaults(before, tools), ...dialDefaults(after, tools) } : {};
      return stepDiff(before, after, defaults);
    },
    attribute,
    async ensureHead(world) {
      await ensureHead(deps, world);
    },
  };
}

/**
 * services.ts (FOUNDATION) builds the history with this name; it is the real history now, reading the
 * app's store at call time. INTEGRATION can switch the call to `createHistory()`.
 */
export const createHistoryStub = createHistory;
