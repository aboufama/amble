import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { planTarget, projectFreedom } from '../src/compiler/codegen';
import { compileNeedsRequest, compileProject } from '../src/compiler/compile';
import { DEFAULT_SETTINGS } from '../src/compiler/openai';
import { classNames, piecesSystemPrompt, piecesUserPrompt } from '../src/compiler/prompt';
import { BLOCKS, BLOCK_BY_TYPE, SIMPLE_GROUPS, blocksFor, coreBlocksFor } from '../src/blocks/spec';
import { toolboxFor } from '../src/blocks/blockly';
import { block, newProject, workspace } from '../src/project/defaults';
import { ideaProject } from '../src/project/idea';
import type { Project } from '../src/project/types';

const plansOf = (p: Project) => {
  const names = classNames(p);
  return [p.stage, ...p.sprites].map((t) => planTarget(p, t, names.get(t.id)!));
};
const piecesOf = (p: Project) => plansOf(p).flatMap((plan) => plan.pieces);

afterEach(() => vi.unstubAllGlobals());

describe('the imagination dial', () => {
  it('is off without its block: the game: line only says what the game is about, as before', () => {
    const p = newProject();
    expect(projectFreedom(p)).toBe('just what I say');
    expect(piecesOf(p)).toEqual([]);
    expect(compileNeedsRequest(p)).toBe(false);
  });

  it('turns the game: line into the whole game: one piece on the stage, started with the game', () => {
    const p = ideaProject('a T-rex on roller skates dodges meteors at a disco', 'go wild');
    expect(projectFreedom(p)).toBe('go wild');
    expect(p.sprites).toEqual([]);
    const [stage] = plansOf(p);
    expect(stage.warnings).toEqual([]);
    expect(stage.pieces.map((r) => [r.kind, r.words, r.freedom])).toEqual([['game', 'a T-rex on roller skates dodges meteors at a disco', 'go wild']]);
    const piece = stage.pieces[0];
    const source = stage.render(new Map([[piece.key, 'this.game.vars.score = 0;\nyield;']]));
    expect(source).toContain(`this._script("${piece.method}", false, "game: [a T-rex on roller skates dodges meteors at a disco]");`);
    expect(source).toContain(`*${piece.method}() {`);
    expect(compileNeedsRequest(p)).toBe(true);
  });

  it('builds again when the dial or the sentence changes, and not when "just what I say"', () => {
    const key = (p: Project) => piecesOf(p)[0]?.key;
    const wild = ideaProject('a cat delivers pizza', 'go wild');
    const gaps = ideaProject('a cat delivers pizza', 'fill in the gaps');
    expect(key(wild)).toBeDefined();
    expect(key(wild)).not.toBe(key(gaps));
    expect(key(wild)).toBe(key(ideaProject('a cat delivers pizza', 'go wild')));
    expect(key(wild)).not.toBe(key(ideaProject('a dog delivers pizza', 'go wild')));
    expect(piecesOf(ideaProject('a cat delivers pizza', 'just what I say'))).toEqual([]);
    // An empty game: line is nothing to build.
    expect(piecesOf(ideaProject('   ', 'go wild'))).toEqual([]);
  });

  it('gives the model its directing notes only when a game is being written, and more freedom when wild', () => {
    const plain = piecesSystemPrompt('2d');
    const gaps = piecesSystemPrompt('2d', { freedom: 'fill in the gaps' });
    const wild = piecesSystemPrompt('2d', { freedom: 'go wild' });
    expect(plain).not.toContain('# Directing a game');
    expect(piecesSystemPrompt('2d', { freedom: 'just what I say' })).toBe(plain);
    for (const s of [gaps, wild]) {
      expect(s.startsWith(plain)).toBe(true);
      expect(s).toContain('# Directing a game');
      expect(s).toContain('## Keep it fast');
    }
    expect(gaps).toContain('fill in the gaps');
    expect(gaps).not.toContain('The author wants to be amazed');
    expect(wild).toContain('The author wants to be amazed');
  });

  it('asks for the game as one piece, saying how much to invent', () => {
    const p = ideaProject('a cat delivers pizza', 'go wild', 'neon');
    const plans = plansOf(p);
    const tasks = plans.flatMap((plan) => plan.pieces).map((request, i) => ({ id: `p${i + 1}`, request }));
    const prompt = piecesUserPrompt({ project: p, plans, tasks, written: new Map() });
    expect(prompt).toContain('- game: [a cat delivers pizza]');
    expect(prompt).toContain('- imagination: [go wild ▾]');
    expect(prompt).toMatch(/- p\d: game \(the whole game; imagination: go wild\), in "Stage"/);
  });
});

/** A fake model: answers each compile request with `reply(prompt, n)`; art and sounds get stand-ins. */
function fakeModel(reply: (prompt: string, n: number) => Record<string, unknown>) {
  const prompts: Array<{ system: string; user: string }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (String(url).endsWith('/api/config')) return new Response('{}', { status: 404 });
      const body = JSON.parse(String(init.body));
      const name = body.response_format?.json_schema?.name;
      let content: unknown;
      if (name === 'amble_pieces') {
        prompts.push({ system: body.messages[0].content, user: body.messages[1].content });
        content = { sprites: [], assets: [], warnings: [], questions: [], title: '', howToPlay: '', ...reply(body.messages[1].content, prompts.length) };
      } else if (name === 'svg_art') content = { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" fill="#f80"/></svg>' };
      else content = { segments: [{ wave: 'square', startFreq: 440, endFreq: 880, duration: 0.1, startVolume: 0.5, endVolume: 0 }] };
      return new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: JSON.stringify(content) }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { status: 200 });
    }),
  );
  return prompts;
}

const settings = { ...DEFAULT_SETTINGS, apiKey: 'sk-test' };
const sprite = (name: string, code = `class ${name} extends Sprite {\n  update(dt) {\n    this.turn(90 * dt);\n  }\n}`) => ({ name, description: `the ${name}`, x: 0, y: 0, size: 100, direction: 0, visible: true, code });
const art = (target: string, name: string) => ({ target, kind: 'costume', name, description: `a ${name}`, width: 40, height: 40, reuse: false });
const ids = (prompt: string) => [...prompt.matchAll(/^- (p\d+): (\w+)/gm)].map((m) => m[1]);

describe('making a game from an idea', () => {
  // The classic reply, with its asset list (Amble's default now starts with the cast: tests/lean.test.ts).
  beforeEach(() => void ((globalThis as { __ambleHarness?: object }).__ambleHarness = { lean: false }));
  afterEach(() => void delete (globalThis as { __ambleHarness?: object }).__ambleHarness);

  it('builds the game, its cast and its art in one request, and names it', async () => {
    const prompts = fakeModel((prompt) => ({
      pieces: ids(prompt).map((id) => ({ id, code: 'this.game.vars.score = 0;\nfor (;;) { yield; }' })),
      sprites: [sprite('Rex'), sprite('Meteor')],
      assets: [art('Rex', 'rex'), art('Meteor', 'meteor'), { target: 'Stage', kind: 'sound', name: 'disco', description: 'a disco loop', width: 0, height: 0, reuse: false }],
      title: 'Meteor Disco Rex',
      howToPlay: 'Arrow keys to skate. Dodge the meteors!',
    }));
    const p = ideaProject('a T-rex on roller skates dodges meteors at a disco', 'go wild');
    const game = await compileProject(p, { settings });
    expect(prompts).toHaveLength(1);
    expect(prompts[0].system).toContain('# Directing a game');
    expect(prompts[0].system).toContain('go wild');
    expect(game.warnings).toEqual([]);
    expect(game.title).toBe('Meteor Disco Rex');
    expect(game.howToPlay).toBe('Arrow keys to skate. Dodge the meteors!');
    expect(game.sprites.map((s) => s.name)).toEqual(['Rex', 'Meteor']);
    expect(game.code.map((c) => c.targetName)).toEqual(['Stage', 'Rex', 'Meteor']);
    expect(game.assets.map((a) => `${a.targetName}/${a.name}`).sort()).toEqual(['Meteor/meteor', 'Rex/rex', 'Stage/disco']);
    // Built: the flag plays it again with no request.
    expect(compileNeedsRequest({ ...p, compiled: game })).toBe(false);
  });

  it('shows the cast it wrote, with its code, when a later sentence needs to change it', async () => {
    const prompts = fakeModel((prompt, n) =>
      n === 1 ? { pieces: ids(prompt).map((id) => ({ id, code: 'yield;' })), sprites: [sprite('Rex'), sprite('Meteor')], assets: [art('Rex', 'rex'), art('Meteor', 'meteor')], title: 'Rex' } : { pieces: ids(prompt).map((id) => ({ id, code: 'for (;;) { yield; }' })), sprites: [sprite('Rex', 'class Rex extends Sprite {\n  start() {\n    this.jetpack = true;\n  }\n}')] },
    );
    const p = ideaProject('a T-rex dodges meteors', 'fill in the gaps');
    const first = await compileProject(p, { settings });
    // The author adds a rule: only that is written, with the game and its cast there to revise.
    const stage = (p.stage.blocks!.blocks as { blocks: unknown[] }).blocks;
    const withRule: Project = { ...p, compiled: first, stage: { ...p.stage, blocks: workspace(...(stage as never[]), block('ga_rule', { RULE: 'Rex has a jetpack' })) } };
    const second = await compileProject(withRule, { settings });
    expect(prompts).toHaveLength(2);
    expect(prompts[1].system).not.toContain('# Directing a game');
    expect(prompts[1].user).toContain('class Rex extends Sprite {');
    expect(prompts[1].user).toContain('class Meteor extends Sprite {');
    expect(ids(prompts[1].user)).toHaveLength(1);
    // Rex was rewritten; Meteor stays as it was; the name and how to play stay with the game.
    expect(second.sprites.map((s) => s.name)).toEqual(['Rex', 'Meteor']);
    expect(second.code.find((c) => c.targetName === 'Rex')!.source).toContain('this.jetpack = true;');
    expect(second.code.find((c) => c.targetName === 'Meteor')!.source).toContain('this.turn(90 * dt);');
    expect(second.title).toBe('Rex');
  });

  it('a new idea replaces the cast of the game before', async () => {
    fakeModel((prompt, n) => ({ pieces: ids(prompt).map((id) => ({ id, code: 'yield;' })), sprites: n === 1 ? [sprite('Rex'), sprite('Meteor')] : [sprite('Cat')], assets: n === 1 ? [art('Rex', 'rex'), art('Meteor', 'meteor')] : [art('Cat', 'cat')] }));
    const first = await compileProject(ideaProject('a T-rex dodges meteors', 'go wild'), { settings });
    const next = { ...ideaProject('a cat delivers pizza', 'go wild'), compiled: first };
    const second = await compileProject(next, { settings });
    expect(second.sprites.map((s) => s.name)).toEqual(['Cat']);
    expect(second.assets.map((a) => a.targetName)).toEqual(['Cat']);
    expect(second.code.map((c) => c.targetName)).toEqual(['Stage', 'Cat']);
  });

  it('asks again for a character whose class does not parse', async () => {
    const prompts = fakeModel((prompt, n) =>
      n === 1 ? { pieces: ids(prompt).map((id) => ({ id, code: 'yield;' })), sprites: [sprite('Rex', 'class Rex extends Sprite {\n  update(dt) {\n    this.turn(\n  }\n}'), sprite('Meteor')], assets: [art('Rex', 'rex'), art('Meteor', 'meteor')] } : { pieces: [], sprites: [sprite('Rex', 'class Rex extends Sprite {\n  update(dt) {\n    this.turn(5);\n  }\n}')] },
    );
    const game = await compileProject(ideaProject('a T-rex dodges meteors', 'go wild'), { settings });
    expect(prompts).toHaveLength(2);
    expect(prompts[1].user).toContain('- sprite "Rex": ');
    expect(prompts[1].user).toContain('these sprites, each with its whole class: "Rex"');
    expect(game.warnings).toEqual([]);
    expect(game.code.find((c) => c.targetName === 'Rex')!.source).toContain('this.turn(5);');
    expect(game.sprites.map((s) => s.name)).toEqual(['Rex', 'Meteor']);
  });
});

describe('the simple palette', () => {
  interface Group {
    name: string;
    column?: number | null;
    rows?: string[][];
    contents: Array<{ kind: string; type?: string; text?: string }>;
  }
  /** The palette of a project with one variable, for its stage or its sprite. */
  const palette = (ctx: { isStage: boolean; simple: boolean }) => {
    const p = newProject();
    const menus = { project: p, target: ctx.isStage ? p.stage : p.sprites[0], newMessages: [] };
    return toolboxFor({ isStage: ctx.isStage, menus, simple: ctx.simple }) as unknown as { layout?: string; contents: Group[] };
  };
  const names = (ctx: { isStage: boolean; simple: boolean }) =>
    palette(ctx).contents.map((c) => ({ name: c.name, blocks: c.contents.filter((i) => i.kind === 'block').map((i) => i.type!), buttons: c.contents.filter((i) => i.kind === 'button').map((i) => i.text!) }));
  const count = (groups: ReturnType<typeof names>) => groups.reduce((n, g) => n + g.blocks.filter((b) => b !== 'char_ref').length, 0);

  it('is one board: a card for each thing the author wants to do, under plain headings', () => {
    for (const isStage of [true, false]) {
      const simple = palette({ isStage, simple: true });
      expect(simple.layout).toBe('board');
      expect(simple.contents.map((g) => g.name)).toEqual(['Say what happens', 'When…', 'Check', 'Do', 'Remember']);
      expect(simple.contents.map((g) => g.name)).toEqual(SIMPLE_GROUPS.map((g) => g.name));
      // "Say what happens" lies across the top; When… and Check stand in the left column, Do and Remember in the right one.
      expect(simple.contents.map((g) => g.column)).toEqual([null, 0, 0, 1, 1]);
      // The full palette is a list by category, as before.
      const all = palette({ isStage, simple: false });
      expect(all.layout).toBeUndefined();
      expect(all.contents).toHaveLength(11);
    }
  });

  it('holds few enough blocks to show them all at once: about a third of the language', () => {
    const stage = names({ isStage: true, simple: true });
    const sprite = names({ isStage: false, simple: true });
    // 19 blocks on the stage and 26 on a sprite, and a block for the project's one variable.
    expect(count(stage)).toBe(20);
    expect(count(sprite)).toBe(27);
    expect(count(stage) / count(names({ isStage: true, simple: false }))).toBeLessThan(0.36);
    expect(count(sprite) / count(names({ isStage: false, simple: false }))).toBeLessThan(0.33);
    // The exact basics are there; what a sentence does better is in the full palette.
    const blocks = sprite.flatMap((g) => g.blocks);
    expect(blocks).toEqual(expect.arrayContaining(['kit_walk', 'kit_jump', 'kit_gravity', 'lk_say_for', 'so_play', 'fl_wait', 'co_forever', 'fl_if', 'lo_show', 'lo_hide', 'mem_set', 'mem_change']));
    for (const rare of ['ga_do_for', 'nm_random', 'br_win', 'br_lose', 'mv_turn']) expect(blocks, rare).not.toContain(rare);
    expect(stage.flatMap((g) => g.blocks)).not.toContain('br_win');
  });

  it('puts the blocks that take words first', () => {
    const stage = names({ isStage: true, simple: true });
    const sprite = names({ isStage: false, simple: true });
    // The top card is all words: the game, its look and its rules on the stage; what a sprite always and never does.
    expect(stage[0]).toMatchObject({ name: 'Say what happens', blocks: ['br_game', 'br_style', 'ga_rule'] });
    expect(sprite[0]).toMatchObject({ name: 'Say what happens', blocks: ['ru_always', 'ru_never'] });
    for (const groups of [stage, sprite]) {
      expect(groups.find((g) => g.name === 'Do')!.blocks[0]).toBe('ga_do');
      expect(groups.find((g) => g.name === 'Check')!.blocks.slice(0, 2)).toEqual(['cd_words', 'nm_words']);
    }
    expect(sprite.find((g) => g.name === 'Do')!.blocks).toEqual(['ga_do', 'kit_walk', 'kit_jump', 'kit_gravity', 'lo_show', 'lo_hide', 'lk_say_for', 'so_play', 'fl_wait', 'co_forever', 'fl_if']);
    expect(stage.find((g) => g.name === 'Do')!.blocks).toEqual(['ga_do', 'so_play', 'fl_wait', 'co_forever', 'fl_if']);
    expect(sprite.find((g) => g.name === 'When…')!.blocks).toEqual(['ev_start', 'ev_key', 'ev_click', 'ev_touch', 'ev_every']);
    expect(stage.find((g) => g.name === 'When…')!.blocks).toEqual(['ev_start', 'ev_key', 'ev_stage_click', 'ev_every']);
  });

  it('offers variables once there is one, and no switch among the blocks (it sits under the palette, always in view)', () => {
    for (const isStage of [true, false]) {
      const simple = names({ isStage, simple: true });
      expect(simple.at(-1)).toMatchObject({ name: 'Remember', blocks: ['mem_var', 'mem_set', 'mem_change', 'va_show'], buttons: ['Make a Variable'] });
      expect(simple.flatMap((g) => g.buttons)).toEqual(['Make a Variable']);
      expect(names({ isStage, simple: false }).flatMap((g) => g.buttons)).toEqual(['Make a Variable', 'Make a Skill']);
    }
    const bare = toolboxFor({ isStage: false, menus: null, simple: true }) as unknown as { contents: Group[] };
    expect(bare.contents.at(-1)!.contents.map((i) => i.kind)).toEqual(['button']);
  });

  it('leaves the imagination dial out of both palettes, and keeps its block for old projects', () => {
    for (const isStage of [true, false]) {
      for (const simple of [true, false]) expect(names({ isStage, simple }).flatMap((g) => g.blocks)).not.toContain('br_freedom');
    }
    expect(BLOCK_BY_TYPE.get('br_freedom')).toMatchObject({ hidden: true, category: 'brief', shape: 'rule', label: 'imagination: {LEVEL}' });
  });

  it('only ever offers blocks that the full palette has', () => {
    for (const target of ['sprite', 'stage'] as const) {
      const all = new Set(blocksFor(target).map((b) => b.type));
      for (const b of coreBlocksFor(target)) expect(all.has(b.type), b.type).toBe(true);
    }
    expect(BLOCKS.filter((b) => b.core && b.hidden)).toEqual([]);
    // The rows a group arranges are its own blocks.
    for (const g of SIMPLE_GROUPS) for (const type of g.rows?.flat() ?? []) expect(BLOCK_BY_TYPE.get(type)?.core, type).toBe(g.id);
  });
});
