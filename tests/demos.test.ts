import { describe, expect, it } from 'vitest';
import { compileNeedsRequest, inputHash } from '../src/compiler/compile';
import { serializeBlocks } from '../src/compiler/serialize';
import { EXAMPLES } from '../src/project/examples';
import { migrateProject } from '../src/project/migrate';
import { isProject } from '../src/project/persistence';
import type { Project } from '../src/project/types';

/** The shipped demos (public/demos/<id>.amble, made by scripts/precompile-demos.mjs). */
const files = import.meta.glob('../public/demos/*.amble', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const shipped = (id: string): string | undefined => files[`../public/demos/${id}.amble`];

const blocksOf = (p: Project) => Object.fromEntries([p.stage, ...p.sprites].map((t) => [t.kind === 'stage' ? 'Stage' : t.name, serializeBlocks(t.blocks).text]));

describe.each(EXAMPLES.filter((e) => e.prebuilt).map((e) => [e.title, e] as const))('prebuilt demo %s', (_title, example) => {
  it('ships built', () => {
    const raw = shipped(example.id);
    expect(raw, `public/demos/${example.id}.amble is missing: run scripts/precompile-demos.mjs`).toBeDefined();
    const data: unknown = JSON.parse(raw!);
    expect(isProject(data)).toBe(true);
    const project = migrateProject(data as Project);
    const compiled = project.compiled!;
    // Opening it needs no build: the green flag plays at once, with no request and no account.
    expect(compiled.inputHash).toBe(inputHash(project));
    expect(compileNeedsRequest(project)).toBe(false);
    expect(compiled.code.length).toBeGreaterThanOrEqual(1 + project.sprites.length);
    expect(compiled.warnings).toEqual([]);
    expect(raw!.length).toBeLessThan(2_000_000);
  });

  it('is the demo as written (rebuild it after changing the demo)', () => {
    const project = migrateProject(JSON.parse(shipped(example.id) ?? 'null') as Project);
    expect(blocksOf(project)).toEqual(blocksOf(example.make()));
  });
});
