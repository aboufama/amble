import { afterEach, describe, expect, it, vi } from 'vitest';
import { planTarget, projectFreedom } from '../src/compiler/codegen';
import { compileNeedsRequest, compileProject } from '../src/compiler/compile';
import { DEFAULT_SETTINGS } from '../src/compiler/openai';
import { classNames, piecesSystemPrompt, piecesUserPrompt } from '../src/compiler/prompt';
import { BLOCKS, SIMPLE_GROUPS, blocksFor, coreBlocksFor } from '../src/blocks/spec';
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
  const names = (ctx: { isStage: boolean; simple: boolean }) => {
    const box = toolboxFor({ isStage: ctx.isStage, menus: null, simple: ctx.simple }) as unknown as { contents: Array<{ name: string; contents: Array<{ kind: string; type?: string; text?: string }> }> };
    return box.contents.map((c) => ({ name: c.name, blocks: c.contents.filter((i) => i.kind === 'block').map((i) => i.type!), buttons: c.contents.filter((i) => i.kind === 'button').map((i) => i.text!) }));
  };

  it('shows five groups with about a third of the blocks, and the way to the rest', () => {
    for (const isStage of [true, false]) {
      const simple = names({ isStage, simple: true });
      const all = names({ isStage, simple: false });
      expect(simple.map((g) => g.name)).toEqual(SIMPLE_GROUPS.map((g) => g.name));
      const count = (groups: typeof simple) => groups.reduce((n, g) => n + g.blocks.filter((b) => b !== 'char_ref').length, 0);
      expect(count(simple)).toBeLessThanOrEqual(30);
      expect(count(simple)).toBeLessThan(count(all) / 2);
      expect(simple.at(-1)!.buttons).toContain('More blocks');
      expect(all.at(-1)!.buttons).toContain('Fewer blocks');
    }
  });

  it('puts the idea first: the game line, the dial and the look on the stage', () => {
    expect(names({ isStage: true, simple: true })[0]).toMatchObject({ name: 'Idea', blocks: ['br_game', 'br_freedom', 'br_style', 'br_win', 'br_lose', 'ga_rule'] });
    expect(names({ isStage: false, simple: true })[0]).toMatchObject({ name: 'Idea', blocks: ['ga_rule', 'ru_always', 'ru_never'] });
  });

  it('only ever offers blocks that the full palette has', () => {
    for (const target of ['sprite', 'stage'] as const) {
      const all = new Set(blocksFor(target).map((b) => b.type));
      for (const b of coreBlocksFor(target)) expect(all.has(b.type), b.type).toBe(true);
    }
    expect(BLOCKS.filter((b) => b.core && b.hidden)).toEqual([]);
  });
});
