import { afterEach, describe, expect, it, vi } from 'vitest';
import { planTarget } from '../src/compiler/codegen';
import { classNames, piecesUserPrompt } from '../src/compiler/prompt';
import { compileProject } from '../src/compiler/compile';
import { DEFAULT_SETTINGS } from '../src/compiler/openai';
import { serializeBlocks } from '../src/compiler/serialize';
import { EXAMPLES } from '../src/project/examples';
import { BLOCK_BY_TYPE } from '../src/blocks/spec';
import type { Project } from '../src/project/types';

const plansOf = (p: Project) => {
  const names = classNames(p);
  return [p.stage, ...p.sprites].map((t) => planTarget(p, t, names.get(t.id)!));
};

/** Blocks in a project that hold the author's words, and exact blocks that do something (triggers, characters and shadows aside). */
function census(p: Project): { words: number; exact: number } {
  let words = 0;
  let exact = 0;
  const visit = (b: { type: string; inputs?: Record<string, { block?: unknown }>; next?: { block?: unknown } } | undefined) => {
    if (!b) return;
    const spec = BLOCK_BY_TYPE.get(b.type);
    if (spec && spec.shape !== 'hat' && !['char_ref', 'char_menu', 'mem_var'].includes(b.type)) {
      if (Object.values(spec.inputs ?? {}).some((i) => i.kind === 'text') && !['pr_define'].includes(b.type)) words++;
      else exact++;
    }
    for (const i of Object.values(b.inputs ?? {})) visit(i.block as never);
    visit(b.next?.block as never);
  };
  for (const t of [p.stage, ...p.sprites]) for (const b of (t.blocks?.blocks as { blocks: never[] } | undefined)?.blocks ?? []) visit(b);
  return { words, exact };
}

afterEach(() => vi.unstubAllGlobals());

describe.each(EXAMPLES.map((e) => [e.title, e] as const))('example %s', (_title, example) => {
  it('compiles its exact blocks with no problems', () => {
    const p = example.make();
    for (const plan of plansOf(p)) {
      expect(plan.warnings, plan.targetName).toEqual([]);
      expect(plan.issues, plan.targetName).toEqual([]);
    }
  });

  it('has a brief and a description for every character', () => {
    const p = example.make();
    const brief = plansOf(p).flatMap((plan) => plan.brief);
    expect(brief.some((b) => b.startsWith('game:'))).toBe(true);
    expect(brief.some((b) => b.startsWith('art style:'))).toBe(true);
    for (const s of p.sprites) expect(s.description.trim(), s.name).not.toBe('');
  });

  it('makes a compile request the model can read', () => {
    const p = example.make();
    const plans = plansOf(p);
    const tasks = plans.flatMap((plan) => plan.pieces).map((request, i) => ({ id: `p${i + 1}`, request }));
    const prompt = piecesUserPrompt({ project: p, plans, tasks, written: new Map() });
    for (const t of [p.stage, ...p.sprites]) expect(prompt).toContain(serializeBlocks(t.blocks).text.split('\n')[0]);
    expect(prompt).toContain('## Write these pieces');
    expect(prompt.length).toBeLessThan(20_000);
  });

  it('plays without an account: the words wait, everything else runs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    const game = await compileProject(example.make(), { settings: DEFAULT_SETTINGS, offline: true });
    expect(game.code.length).toBe(1 + example.make().sprites.length);
    expect(game.warnings.filter((w) => !/aren't built yet|isn't built yet/.test(w))).toEqual([]);
  });

  it('builds in one request, with every piece written', async () => {
    const bodies: Array<{ model: string; reasoning_effort?: string; messages: Array<{ content: string }> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (String(url).endsWith('/api/config')) return new Response('{}', { status: 404 });
        const body = JSON.parse(String(init.body));
        bodies.push(body);
        const ids = [...String(body.messages[1].content).matchAll(/^- (p\d+): (\w+)/gm)].map((m) => ({ id: m[1], kind: m[2] }));
        const code = (kind: string) => (kind === 'condition' ? 'return false;' : kind === 'value' ? 'return 1;' : kind === 'message' ? 'return "";' : kind === 'behavior' ? 'for (;;) { yield; }' : '');
        const reply = { pieces: ids.map((t) => ({ id: t.id, code: code(t.kind) })), sprites: [], assets: [], warnings: [], questions: [] };
        const sse = [{ choices: [{ index: 0, delta: { content: JSON.stringify(reply) }, finish_reason: 'stop' }] }, { choices: [], usage: { prompt_tokens: 9000, completion_tokens: 3000 } }];
        return new Response(sse.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n', { status: 200 });
      }),
    );
    const p = example.make();
    const game = await compileProject(p, { settings: { ...DEFAULT_SETTINGS, apiKey: 'sk-test' } });
    expect(bodies.length).toBe(1);
    expect(bodies[0]).toMatchObject({ model: 'gpt-6.1-terra', reasoning_effort: 'high' });
    expect(game.warnings).toEqual([]);
    expect(game.pieces?.length).toBe(new Set(plansOf(p).flatMap((plan) => plan.pieces.map((r) => r.key))).size);
  });
});

describe('the demos', () => {
  it('lean on blocks written in words (Star Catcher is the exact-blocks one)', () => {
    for (const e of EXAMPLES.filter((x) => x.id !== 'star-catcher')) {
      const { words, exact } = census(e.make());
      expect(words, e.title).toBeGreaterThan(exact);
    }
  });
});
