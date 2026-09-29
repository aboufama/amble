/**
 * Footsteps (§2.9, §4.5, §8.4; M9 owns). FOUNDATION-STUB: `record` and `goBack` append a StepSummary and
 * move `head` but store no snapshot; `diff` is empty; `attribute` credits every changed file to `by`.
 */
import { t } from '../i18n';
import { uid } from '../model/ids';
import type { Author, CodeFile, StepDiff, StepId, StepInput, World } from '../model/types';

export interface HistoryApi {
  /** Snapshots the world (code, cast, art versions, sounds, dials, twists), appends a step, merges dial bursts; returns the new world. */
  record(world: World, step: StepInput): Promise<World>;
  /** Loads the snapshot and appends a 'goback' step. */
  goBack(world: World, to: StepId): Promise<World>;
  /** Per-file unified diff + drawing changes. */
  diff(world: World, step: StepId): Promise<StepDiff>;
  /** Provenance runs (Myers line diff). */
  attribute(prev: CodeFile[], next: CodeFile[], by: Author): CodeFile[];
}

function lineCount(source: string): number {
  return source === '' ? 0 : source.split('\n').length;
}

function append(world: World, step: StepInput): World {
  const id = uid('s_');
  const summary = { id, at: Date.now(), ...step };
  return { ...world, steps: [...world.steps, summary], head: id, updatedAt: summary.at };
}

export function createHistoryStub(): HistoryApi {
  return {
    record: async (world, step) => append(world, step),
    goBack: async (world, to) => {
      const target = world.steps.find((s) => s.id === to);
      return append(world, { kind: 'goback', by: 'student', text: target ? t('common.wentBack', { step: target.text }) : t('common.wentBackStep') });
    },
    diff: async () => ({ files: [], drawings: [], dials: [] }),
    attribute: (prev, next, by) =>
      next.map((file) => {
        const before = prev.find((p) => p.path === file.path);
        if (before && before.source === file.source) return { ...file, authors: before.authors };
        return { ...file, authors: lineCount(file.source) ? [[by, lineCount(file.source)]] : [] };
      }),
  };
}
