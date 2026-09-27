import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'acorn';
import { simple } from 'acorn-walk';
import { serializeBlocks } from '../src/compiler/serialize';
import { planTarget, type TargetPlan } from '../src/compiler/codegen';
import { checkPiece } from '../src/compiler/pieces';
import { classNames, piecesSystemPrompt } from '../src/compiler/prompt';
import { compileNeedsRequest, compileProject, inputHash } from '../src/compiler/compile';
import { PIECES_SCHEMA } from '../src/compiler/schema';
import { instrumentTargetCode } from '../src/compiler/transform';
import { encodeWav, renderSynth, SOUND_PRESETS, SAMPLE_RATE } from '../src/audio/synth';
import { DEFAULT_SETTINGS, effectiveSettings, isReasoningModel, parseJsonReply, type Transport } from '../src/compiler/openai';
import { cleanRecipe } from '../src/compiler/assets';
import { buildRunPackage } from '../src/player/package';
import { BLOCKS, type BlockSpec } from '../src/blocks/spec';
import { block, character, newProject, newSprite, variable, workspace, type JsonBlock } from '../src/project/defaults';
import { coinHills, starCatcher } from '../src/project/examples';
import { Sprite, Stage } from '../src/engine/sprite';
import { Game } from '../src/engine/game';
import { CameraRig } from '../src/engine/camera';
import type { Project, Target } from '../src/project/types';

const top = (t: Target) => ((t.blocks?.blocks as { blocks: JsonBlock[] }).blocks);

function plans(p: Project): TargetPlan[] {
  const names = classNames(p);
  return [p.stage, ...p.sprites].map((t) => planTarget(p, t, names.get(t.id)!));
}

function rendered(p: Project, code = new Map<string, string>()): string[] {
  return plans(p).map((plan) => plan.render(code));
}

// -----------------------------------------------------------------------------
// A project with every block in the language, to check the compiled code against the engine
// -----------------------------------------------------------------------------

/** Fills every slot of a block with something: reporters in value slots, conditions in condition slots. */
function sample(spec: BlockSpec): JsonBlock {
  const args: Record<string, string | number | JsonBlock> = {};
  for (const [name, input] of Object.entries(spec.inputs ?? {})) {
    if (input.kind === 'condition') args[name] = block('cd_key', { KEY: 'space' });
  }
  const inner = spec.shape === 'c' || spec.shape === 'c-end' || spec.shape === 'e' ? [block('mv_move', { STEPS: 5 })] : undefined;
  return block(spec.type, args, inner, spec.shape === 'e' ? [block('lo_hide')] : undefined);
}

function everyBlockProject(mode: '2d' | '3d'): Project {
  const p = newProject(mode);
  p.variables = ['score'];
  const amble = p.sprites[0];
  amble.variables = ['my speed'];
  p.sprites.push(newSprite('Fox', mode));
  const stage: Array<JsonBlock | JsonBlock[]> = [];
  const sprite: Array<JsonBlock | JsonBlock[]> = [];
  const add = (spec: BlockSpec, out: Array<JsonBlock | JsonBlock[]>) => {
    const b = sample(spec);
    switch (spec.shape) {
      case 'hat':
        out.push([b, block('lo_show')]);
        break;
      case 'rule':
        out.push(b);
        break;
      case 'reporter':
        out.push([block('ev_start'), block('mem_set', { VARIABLE: 'score', VALUE: b })]);
        out.push([block('ev_start'), block('fl_wait', { SECONDS: b })]);
        break;
      case 'boolean':
        out.push([block('ev_start'), block('fl_if', { COND: b }, [block('ev_broadcast')])]);
        break;
      default:
        out.push([block('ev_start'), b]);
    }
  };
  for (const spec of BLOCKS) {
    if (spec.hidden || (spec.modes && !spec.modes.includes(mode))) continue;
    if (!spec.targets || spec.targets.includes('stage')) add(spec, stage);
    if (!spec.targets || spec.targets.includes('sprite')) add(spec, sprite);
  }
  // Blocks the palette makes: characters, variables and skills.
  sprite.push([block('ev_start'), block('mv_goto', { WHO: character('Fox') }), block('mem_set', { VARIABLE: 'my speed', VALUE: variable('score') })]);
  sprite.push([block('pr_define', { NAME: 'hop' }), block('mv_move', { DIR: 'up', STEPS: 20 })], [block('ev_start'), block('pr_call', { NAME: 'hop' })]);
  p.stage.blocks = workspace(...stage);
  amble.blocks = workspace(...sprite);
  return p;
}

function memberNames(C: { prototype: object }): Set<string> {
  const out = new Set<string>();
  for (let proto = C.prototype; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const k of Object.getOwnPropertyNames(proto)) out.add(k);
  }
  return out;
}

/** Every `this.x` and `this.game.x` in a compiled class, except its own methods and fields. */
function engineUses(source: string): { self: Set<string>; game: Set<string>; camera: Set<string> } {
  const self = new Set<string>();
  const game = new Set<string>();
  const camera = new Set<string>();
  const own = new Set<string>();
  const ast = parse(source, { ecmaVersion: 'latest' });
  simple(ast, {
    MethodDefinition(n: any) {
      own.add(n.key.name);
    },
    MemberExpression(n: any) {
      if (n.computed || n.property.type !== 'Identifier') return;
      const o = n.object;
      if (o.type === 'ThisExpression') self.add(n.property.name);
      else if (o.type === 'MemberExpression' && o.object.type === 'ThisExpression' && o.property.name === 'game') game.add(n.property.name);
      else if (o.type === 'MemberExpression' && o.property?.name === 'camera' && o.object.type === 'MemberExpression' && o.object.property?.name === 'game') camera.add(n.property.name);
    },
  });
  for (const name of own) self.delete(name);
  for (const name of [...self]) if (/^_e\d+$/.test(name)) self.delete(name);
  return { self, game, camera };
}

describe('the compiler (exact blocks)', () => {
  it('compiles the starter project instantly, with no words to compile', () => {
    for (const mode of ['2d', '3d'] as const) {
      const p = newProject(mode);
      for (const plan of plans(p)) {
        expect(plan.pieces).toEqual([]);
        expect(plan.warnings).toEqual([]);
      }
      expect(compileNeedsRequest(p)).toBe(false);
    }
  });

  it('turns scripts into coroutines started by the right hooks', () => {
    const [stage, amble] = rendered(newProject('2d'));
    expect(stage).toContain('class StageScript extends Stage {');
    expect(stage).toContain('this.game.vars["my variable"] = 0;');
    expect(amble).toContain(
      [
        '  start() {',
        '    this._script("_s1", true, "when ⚑ clicked");',
        '  }',
        '  onKeyDown(key) {',
        '    if (key === "space") this._script("_s2", false, "when [space ▾] key pressed");',
        '  }',
        '  onClick() {',
        '    this._script("_s3", true, "when I\'m clicked");',
        '  }',
        '  // when ⚑ clicked',
        '  *_s1() {',
        '    this.fallWithGravity();',
        '    this.walkWith("left and right arrows", 220);',
        '    this.jumpWith("space", 650);',
        '    yield* this.sayFor("Hi! I\'m Amble. Arrows to walk, space to jump!", 3);',
        '  }',
      ].join('\n'),
    );
  });

  it('measures steps in pixels in 2D and in hundredths of a meter in 3D', () => {
    const script = (mode: '2d' | '3d') => {
      const p = newProject(mode);
      p.sprites[0].blocks = workspace([block('ev_start'), block('mv_move', { DIR: 'forward', STEPS: 250 }), block('mv_move', { DIR: 'left', STEPS: 50 }), block('mv_turn', { DIR: 'right', DEGREES: 90 })]);
      return rendered(p)[1];
    };
    expect(script('2d')).toContain('this.moveForward(250);\n    this.x -= 50;\n    this.turn(-(90));');
    expect(script('3d')).toContain('this.moveForward(2.5);\n    this.moveSideways(-0.5);\n    this.turn(90);');
  });

  it('keeps loops to one round per frame and scripts to one run at a time', () => {
    const star = rendered(starCatcher())[2];
    expect(star).toContain('    for (;;) {\n      this.clone();\n      yield* this.wait(this.random(0.6, 1.3));\n      yield;\n    }');
    expect(star).toContain('while (!(this._compare(this.y, "<", -165))) {');
    expect(star).toContain('this.y -= (3 + this._divide((Number(this.game.vars["score"]) || 0), 5));');
    expect(star).toContain('if (this.isClone) { this.destroy(); return; }');
    const amble = rendered(starCatcher())[1];
    // "when I touch" runs once each time the touching starts.
    expect(amble).toContain('{ const now = !!this.touching("Star"); if (now && !this._e1) this._script("_s2", false, "when I touch (Star)"); this._e1 = now; }');
    expect(amble).toContain('if (!(this._compare(this.game.vars["score"], ">", -1))) this.game._checkFailed(this.name, "check: <(score) [> ▾] \\"-1\\">");');
  });

  it('turns the brief into the game rules: you win / you lose', () => {
    const stage = rendered(coinHills())[0];
    expect(stage).toContain('if (this._compare(this.game.vars["coins"], "=", 10)) this.game.win();');
    expect(stage).toContain('if (this._compare(this.game.time, ">", 60)) this.game.over();');
  });

  it('keeps variables for one sprite on each copy, and for all sprites on the game', () => {
    const p = everyBlockProject('2d');
    const amble = rendered(p)[1];
    expect(amble).toContain('this.vars["my speed"] = 0;');
    expect(amble).toContain('this.vars["my speed"] = this.game.vars["score"];');
  });

  it('runs skills where they are used', () => {
    const amble = rendered(everyBlockProject('2d'))[1];
    expect(amble).toMatch(/\/\/ skill \[hop\]\n {2}\*_k1\(\) \{\n {4}this\.y \+= 20;\n {2}\}/);
    expect(amble).toContain('yield* this._k1();');
  });

  for (const mode of ['2d', '3d'] as const) {
    it(`compiles every block to valid code that only uses the engine (${mode.toUpperCase()})`, () => {
      const p = everyBlockProject(mode);
      const spriteApi = new Set([...memberNames(Sprite), 'isClone', 'name', 'vars', 'game']);
      const stageApi = new Set([...memberNames(Stage), 'name', 'game', 'isClone']);
      const gameApi = new Set([...memberNames(Game), 'vars', 'input', 'ui', 'camera', 'effects', 'time', 'lastAnswer', 'dt', 'mode', 'world']);
      const cameraApi = memberNames(CameraRig);
      const all = plans(p);
      for (const plan of all) {
        const source = plan.render(new Map());
        const result = instrumentTargetCode(source, plan.kind);
        expect(result.errors, `${plan.targetName}:\n${source}`).toEqual([]);
        const uses = engineUses(source);
        const api = plan.kind === 'stage' ? stageApi : spriteApi;
        expect([...uses.self].filter((n) => !api.has(n)), `${plan.targetName} uses unknown this.*`).toEqual([]);
        expect([...uses.game].filter((n) => !gameApi.has(n)), `${plan.targetName} uses unknown this.game.*`).toEqual([]);
        expect([...uses.camera].filter((n) => !cameraApi.has(n))).toEqual([]);
      }
      // The words blocks became pieces; nothing else needed the compile request.
      const kinds = all.flatMap((plan) => plan.pieces.map((r) => r.kind)).sort();
      expect(new Set(kinds)).toEqual(new Set(['action', 'timed', 'condition', 'value', 'message', 'behavior', 'rule']));
    });
  }

  it('warns about blocks that need something in a slot, and skips them', () => {
    const p = newProject('2d');
    p.sprites[0].blocks = workspace([block('ev_start'), block('mv_goto', { WHO: character('Nobody') })], block('ru_check'), [block('ev_when'), block('lo_hide')]);
    const [, amble] = plans(p);
    expect(amble.warnings).toEqual([
      'Amble: There\'s no character called "Nobody".',
      'Amble: "check: <>" needs a condition in its slot.',
      'Amble: "when <>" needs a condition in its slot.',
    ]);
    expect(instrumentTargetCode(amble.render(new Map()), 'sprite').errors).toEqual([]);
  });
});

describe('pieces (blocks in the author\'s own words)', () => {
  it('finds the words in the examples, once each', () => {
    const star = plans(starCatcher()).flatMap((plan) => plan.pieces.map((r) => [r.targetName, r.kind, r.words, r.inLoop]));
    expect(star).toEqual([
      ['Amble', 'action', 'a small burst of yellow sparkles', false],
      ['Star', 'behavior', 'twinkle and spin slowly as I fall', false],
    ]);
    const coins = plans(coinHills()).flatMap((plan) => plan.pieces.map((r) => [r.targetName, r.kind, r.words]));
    expect(coins).toEqual([
      ['Stage', 'action', 'build a few rolling green hills, some low-poly trees and rocks around the edges'],
      ['Coin', 'behavior', 'spin and bob gently up and down'],
    ]);
  });

  it('keys pieces by their content, so the same words always get the same code', () => {
    const a = starCatcher();
    const b = starCatcher();
    // Different block ids and positions, same program.
    top(b.sprites[1])[0].x = 500;
    const keys = (p: Project) => plans(p).flatMap((plan) => plan.pieces.map((r) => r.key));
    expect(keys(a)).toEqual(keys(b));
    expect(keys(a)[0]).toMatch(/^[0-9a-f]{16}$/);
    expect(rendered(a)).toEqual(rendered(b));
    // Other words, or the same words somewhere else, are another piece.
    const c = starCatcher();
    top(c.sprites[1])[2].fields!.RULE = 'twinkle fast';
    expect(keys(c)[0]).toBe(keys(a)[0]);
    expect(keys(c)[1]).not.toBe(keys(a)[1]);
  });

  it('marks pieces that run every frame', () => {
    const p = newProject('2d');
    p.sprites[0].blocks = workspace([block('ev_start'), block('co_forever', {}, [block('ga_do', { ACTION: 'drift toward the mouse' })])], [block('ev_hold', { KEY: 'up arrow' }), block('ga_do', { ACTION: 'fly up' })]);
    const [, amble] = plans(p);
    expect(amble.pieces.map((r) => [r.words, r.inLoop])).toEqual([
      ['drift toward the mouse', true],
      ['fly up', true],
    ]);
    expect(amble.render(new Map())).toContain('if (this.game.input.isDown("up")) this._script("_s2", false, "while [up arrow ▾] key is held");');
  });

  it('puts written code into the class and shows the block it came from', () => {
    const p = starCatcher();
    const [, , star] = plans(p);
    const code = new Map([[star.pieces[0].key, 'for (;;) {\n  this.turn(1);\n  yield;\n}']]);
    const source = star.render(code);
    expect(source).toContain(`  // always: [twinkle and spin slowly as I fall]\n  *${star.pieces[0].method}() {\n    for (;;) {\n      this.turn(1);\n      yield;\n    }\n  }`);
    expect(instrumentTargetCode(source, 'sprite').errors).toEqual([]);
  });

  it('checks and tidies the code it gets back', () => {
    expect(checkPiece('action', '```js\nthis.turn(15);\n```')).toEqual({ code: 'this.turn(15);' });
    expect(checkPiece('condition', 'this.distanceTo("Flag") < 50')).toEqual({ code: 'return (this.distanceTo("Flag") < 50);' });
    expect(checkPiece('value', 'return this.game.time * 2;')).toEqual({ code: 'return this.game.time * 2;' });
    expect(checkPiece('timed', '*piece(seconds) {\n  yield* this.wait(seconds);\n}')).toEqual({ code: 'yield* this.wait(seconds);' });
    expect(checkPiece('action', 'this.turn(')).toHaveProperty('error');
    // Conditions are plain methods: no waiting in them.
    expect(checkPiece('condition', 'yield* this.wait(1); return true;')).toHaveProperty('error');
  });
});

describe('serializeBlocks', () => {
  it('writes the program in the block notation, standalone blocks first', () => {
    const p = starCatcher();
    expect(serializeBlocks(p.sprites[0].blocks).text).toBe(
      [
        'check: <(score) [> ▾] "-1">',
        'Script 1:',
        '  when ⚑ clicked',
        '    go to x: (0) y: (-130)',
        '    walk with [left and right arrows ▾] at speed (280)',
        '    animate costumes at (8) per second',
        'Script 2:',
        '  when I touch (Star)',
        '    play sound [pop ▾]',
        '    particles: [a small burst of yellow sparkles]',
      ].join('\n'),
    );
  });

  it('leaves out loose blocks and disabled blocks, like Scratch, and keeps notes', () => {
    const state = workspace([block('ev_start'), block('lk_say', { TEXT: 'hi\nthere' })], [block('lo_hide'), block('lo_show')], block('ga_rule', { RULE: 'three lives' }));
    const tops = (state.blocks as { blocks: JsonBlock[] }).blocks;
    tops.push({ ...block('ev_click'), enabled: false } as JsonBlock);
    (state as Record<string, unknown>).workspaceComments = [{ text: 'Make it fast' }];
    expect(serializeBlocks(state)).toEqual({
      text: ['rule: [three lives]', 'Script 1:', '  when ⚑ clicked', '    say "hi / there"', 'Note from the author: Make it fast'].join('\n'),
      scripts: 1,
    });
    expect(serializeBlocks(null).text).toBe('');
  });

  it("doesn't ask for a compile when only positions or loose blocks change", () => {
    const p = starCatcher();
    const before = inputHash(p);
    top(p.sprites[0])[0].x = 400;
    top(p.sprites[0]).push(block('lo_hide'));
    expect(inputHash(p)).toBe(before);
    top(p.sprites[0]).push((workspace([block('ev_key'), block('lo_hide')]).blocks as { blocks: JsonBlock[] }).blocks[0]);
    expect(inputHash(p)).not.toBe(before);
  });
});

// -----------------------------------------------------------------------------
// compileProject, with the compile request answered by a fake server
// -----------------------------------------------------------------------------

interface Call {
  url: string;
  body: { model: string; messages: Array<{ role: string; content: string }>; response_format: { json_schema?: { name: string } }; stream: boolean };
}

/** Answers compile requests like the Chat Completions API does (streamed), one reply per call. */
function fakeServer(replies: Array<(prompt: string) => object>) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (!String(url).endsWith('/chat/completions')) return new Response('not here', { status: 404 });
    const body = JSON.parse(String(init?.body)) as Call['body'];
    calls.push({ url: String(url), body });
    const reply = replies[calls.length - 1];
    if (!reply) throw new Error(`unexpected request #${calls.length}`);
    const content = JSON.stringify(reply(body.messages[1].content));
    const chunks = [content.slice(0, 20), content.slice(20)].map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`);
    const stream = new ReadableStream({
      start(controller) {
        for (const c of [...chunks, 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n', 'data: [DONE]\n\n']) controller.enqueue(new TextEncoder().encode(c));
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  });
  vi.stubGlobal('fetch', fetch);
  return { calls, fetch };
}

const settings = { ...DEFAULT_SETTINGS, apiKey: 'sk-test', model: 'gpt-test' };
const reply = (pieces: Record<string, string>) => () => ({ pieces: Object.entries(pieces).map(([id, code]) => ({ id, code })), sprites: [], assets: [], warnings: [] });
const idsIn = (prompt: string) => [...prompt.matchAll(/^- (p\d+): /gm)].map((m) => m[1]);

describe('compileProject', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('compiles exact blocks without any request, the same way every time', async () => {
    const { fetch } = fakeServer([]);
    for (const mode of ['2d', '3d'] as const) {
      const p = newProject(mode);
      const game = await compileProject(p, { settings: DEFAULT_SETTINGS });
      expect(game.warnings).toEqual([]);
      expect(game.code.map((c) => c.targetName)).toEqual(['Stage', 'Amble']);
      expect(game.pieces).toEqual([]);
      const again = await compileProject({ ...p, compiled: game }, { settings: DEFAULT_SETTINGS });
      expect(again.code).toEqual(game.code);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends only the new words, once, and reuses them after', async () => {
    const server = fakeServer([reply({ p1: 'this.game.effects.burst({ x: this.x, y: this.y, color: "#ffd84d", count: 12 });', p2: 'for (;;) {\n  this.turn(2);\n  yield;\n}' })]);
    const p = starCatcher();
    expect(compileNeedsRequest(p)).toBe(true);
    const first = await compileProject(p, { settings });
    expect(server.calls).toHaveLength(1);
    const call = server.calls[0];
    expect(call.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(call.body.response_format.json_schema?.name).toBe('amble_pieces');
    expect(call.body.messages[0].content).toContain('# 2D world');
    const prompt = call.body.messages[1].content;
    expect(idsIn(prompt)).toEqual(['p1', 'p2']);
    expect(prompt).toContain('particles: [a small burst of yellow sparkles] ⟨p1⟩');
    expect(prompt).toContain('- p2: behavior, in "Star" (always: [twinkle and spin slowly as I fall]): always: [twinkle and spin slowly as I fall]');
    expect(first.warnings).toEqual([]);
    expect(first.pieces?.map((x) => [x.target, x.kind])).toEqual([
      ['Amble', 'action'],
      ['Star', 'behavior'],
    ]);
    expect(first.code.find((c) => c.targetName === 'Star')!.source).toContain('this.turn(2);');

    // Compiled: nothing new to send.
    const compiled = { ...p, compiled: first };
    expect(compileNeedsRequest(compiled)).toBe(false);
    const second = await compileProject(compiled, { settings });
    expect(server.calls).toHaveLength(1);
    expect(second.code).toEqual(first.code);

    // Moving scripts around and loose blocks change nothing either.
    top(compiled.sprites[1])[0].y = 900;
    top(compiled.sprites[1]).push(block('ga_do', { ACTION: 'a loose idea' }));
    expect(compileNeedsRequest(compiled)).toBe(false);
    expect((await compileProject(compiled, { settings })).code).toEqual(first.code);
    expect(server.calls).toHaveLength(1);
  });

  it('sends one changed sentence alone, with the code already written for context', async () => {
    const p = starCatcher();
    const server = fakeServer([reply({ p1: 'this.turn(5);', p2: 'for (;;) { this.turn(2); yield; }' }), reply({ p1: 'for (;;) { this.size = 100 + 10 * Math.sin(this.game.time * 8); yield; }' })]);
    const first = await compileProject(p, { settings });
    const changed = { ...p, compiled: first };
    top(changed.sprites[1])[2].fields!.RULE = 'pulse bigger and smaller';
    expect(compileNeedsRequest(changed)).toBe(true);
    const second = await compileProject(changed, { settings });
    expect(server.calls).toHaveLength(2);
    const prompt = server.calls[1].body.messages[1].content;
    expect(idsIn(prompt)).toEqual(['p1']);
    expect(prompt).toContain('always: [pulse bigger and smaller] ⟨p1⟩');
    // The sparkles were written before: shown, not asked for again.
    expect(prompt).toContain('Code already written for this target\'s words');
    expect(prompt).toContain('this.turn(5);');
    const amble = (g: typeof first) => g.code.find((c) => c.targetName === 'Amble')!.source;
    expect(amble(second)).toBe(amble(first));
    expect(second.code.find((c) => c.targetName === 'Star')!.source).toContain('Math.sin(this.game.time * 8)');
    // Undoing the edit compiles instantly: the old code is still there.
    top(changed.sprites[1])[2].fields!.RULE = 'twinkle and spin slowly as I fall';
    expect(compileNeedsRequest({ ...changed, compiled: second })).toBe(false);
  });

  it('asks again only for code that did not check out', async () => {
    const server = fakeServer([reply({ p1: 'this.turn(', p2: 'for (;;) { yield; }' }), reply({ p1: 'this.turn(15);' })]);
    const game = await compileProject(starCatcher(), { settings });
    expect(server.calls).toHaveLength(2);
    const retry = server.calls[1].body.messages[1].content;
    expect(retry).toContain("## Your previous code for these pieces didn't work\n- p1: ");
    expect(retry).toContain('Reply again with only these pieces: p1');
    expect(game.warnings).toEqual([]);
    expect(game.code.find((c) => c.targetName === 'Amble')!.source).toContain('this.turn(15);');
  });

  it('leaves a piece doing nothing, with a warning, when it never checks out', async () => {
    fakeServer([reply({ p1: 'this.turn(', p2: 'for (;;) { yield; }' }), reply({ p1: 'still (broken' })]);
    const game = await compileProject(starCatcher(), { settings });
    expect(game.warnings).toHaveLength(1);
    expect(game.warnings[0]).toMatch(/^Amble: couldn't compile "particles: \[a small burst of yellow sparkles\]" \(.+\)\. It does nothing for now\.$/);
    expect(game.code.map((c) => c.targetName)).toEqual(['Stage', 'Amble', 'Star']);
    expect(game.pieces?.map((x) => x.target)).toEqual(['Star']);
  });

  it('writes the pieces of the sprites with problems again when fixing', async () => {
    const server = fakeServer([reply({ p1: 'this.turn(5);', p2: 'for (;;) { yield; }' }), reply({ p1: 'for (;;) { this.turn(3); yield; }' })]);
    const p = starCatcher();
    const first = await compileProject(p, { settings });
    await compileProject({ ...p, compiled: first }, { settings, fixProblems: ['Star (always): this.spin is not a function'] });
    const prompt = server.calls[1].body.messages[1].content;
    expect(idsIn(prompt)).toEqual(['p1']);
    expect(prompt).toContain('- p1: behavior, in "Star"');
    expect(prompt).toContain('## The last run had these problems (fix them in the pieces below)\n- Star (always): this.spin is not a function');
  });

  it('needs an account only for words', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 404 })),
    );
    await expect(compileProject(starCatcher(), { settings: DEFAULT_SETTINGS })).rejects.toThrow(/^Some blocks use your own words, and compiling them needs an account/);
    await expect(compileProject(newProject('2d'), { settings: DEFAULT_SETTINGS })).resolves.toMatchObject({ warnings: [] });
  });

  it('can play without an account: words that are not compiled yet do nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 404 })),
    );
    const game = await compileProject(starCatcher(), { settings: DEFAULT_SETTINGS, offline: true });
    expect(game.warnings).toEqual([
      "2 blocks in your own words aren't compiled yet, so they do nothing for now. Sign in with ChatGPT or add an OpenAI API key in Settings, then press Compile.",
    ]);
    expect(game.code.map((c) => c.targetName)).toEqual(['Stage', 'Amble', 'Star']);
    expect(game.pieces).toEqual([]);
    expect(compileNeedsRequest({ ...starCatcher(), compiled: game })).toBe(true);
  });

  it('starts over for games compiled before pieces existed', async () => {
    const server = fakeServer([reply({ p1: 'this.turn(5);', p2: 'for (;;) { yield; }' })]);
    const p = starCatcher();
    const old = { createdAt: 0, model: 'm', mode: '2d' as const, inputHash: 'x', summary: '', howToPlay: '', warnings: [], code: [], sprites: [], assets: [] };
    expect(compileNeedsRequest({ ...p, compiled: old })).toBe(true);
    await compileProject({ ...p, compiled: old }, { settings });
    expect(idsIn(server.calls[0].body.messages[1].content)).toEqual(['p1', 'p2']);
  });
});

describe('prompts', () => {
  it('gives every target a unique, safe class name', () => {
    const p = newProject('2d');
    p.sprites.push({ ...newSprite('amble', '2d') }, { ...newSprite('Sprite', '2d') }, { ...newSprite('3 cats', '2d') });
    const names = [...classNames(p).values()];
    expect(names).toEqual(['StageScript', 'Amble', 'Amble2', 'SpriteScript', 'S3Cats']);
  });

  it('switches the engine notes by world mode', () => {
    expect(piecesSystemPrompt('2d')).toContain('# 2D world');
    expect(piecesSystemPrompt('3d')).toContain('# 3D world');
    expect(piecesSystemPrompt('3d')).not.toContain('# 2D world');
  });

  it('uses a strict schema', () => {
    const check = (schema: Record<string, unknown>) => {
      if (schema.type === 'object') {
        const props = Object.keys(schema.properties as object);
        expect(schema.additionalProperties).toBe(false);
        expect([...(schema.required as string[])].sort()).toEqual(props.sort());
        for (const p of Object.values(schema.properties as object)) check(p as Record<string, unknown>);
      }
      if (schema.type === 'array') check(schema.items as Record<string, unknown>);
    };
    check(PIECES_SCHEMA as unknown as Record<string, unknown>);
  });
});

describe('synth', () => {
  it('renders presets to bounded samples and valid WAV', () => {
    for (const [name, recipe] of Object.entries(SOUND_PRESETS)) {
      const samples = renderSynth(recipe);
      expect(samples.length, name).toBeGreaterThan(SAMPLE_RATE * 0.05);
      expect(Math.max(...samples.map(Math.abs)), name).toBeLessThanOrEqual(0.91);
      const wav = encodeWav(samples);
      expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
      expect(wav.length).toBe(44 + samples.length * 2);
    }
  });

  it('survives bad input', () => {
    const s = renderSynth({ segments: [{ wave: 'noise', startFreq: -5, endFreq: NaN, duration: 99, startVolume: 3, endVolume: -1 }] });
    expect(s.length).toBe(8 * SAMPLE_RATE);
    expect(s.every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe('misc', () => {
  it('compiles with GPT-6 Astra Light when signed in with ChatGPT', () => {
    const chatgpt: Transport = { baseUrl: '/api/codex', headers: {}, via: 'chatgpt' };
    const key: Transport = { baseUrl: 'https://api.openai.com/v1', headers: {}, via: 'browser' };
    const s = { ...DEFAULT_SETTINGS, artMode: 'image' as const };
    expect(effectiveSettings(s, chatgpt)).toMatchObject({ model: 'gpt-6-astra', reasoningEffort: 'low', assetModel: 'gpt-6-astra', artMode: 'svg' });
    expect(effectiveSettings(s, key)).toBe(s);
    expect(isReasoningModel('gpt-6-astra')).toBe(true);
    expect(isReasoningModel('gpt-4.1')).toBe(false);
  });

  it('parses JSON replies with fences', () => {
    expect(parseJsonReply<{ a: number }>('```json\n{"a": 1}\n```').a).toBe(1);
    expect(parseJsonReply<{ a: number }>('Here you go: {"a": 2}').a).toBe(2);
  });

  it('cleans model recipes', () => {
    const r = cleanRecipe({ parts: [{ shape: 'blob', size: [-2], position: 'x', color: 'red', opacity: 9 }] });
    expect(r.parts[0]).toEqual({
      shape: 'box',
      size: [2, 1, 1],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      color: '#cccccc',
      roughness: 0.7,
      metalness: 0,
      emissive: 0,
      opacity: 1,
    });
    expect(cleanRecipe({}).parts).toHaveLength(1);
  });

  it('builds a run package with compiled code, sprites and assets', async () => {
    const p = starCatcher();
    fakeServer([reply({ p1: 'this.turn(5);', p2: 'for (;;) { yield; }' })]);
    p.compiled = await compileProject(p, { settings });
    vi.unstubAllGlobals();
    p.compiled.sprites.push({ id: 'c1', name: 'Moon', description: 'a moon', x: 10, y: 20, z: 0, size: 100, direction: 0, visible: true, rotationStyle: 'all around' });
    p.compiled.code.push({ targetId: 'c1', targetName: 'Moon', className: 'Moon', source: 'class Moon extends Sprite {}', runSource: 'class Moon extends Sprite {}' });
    const pkg = buildRunPackage(p);
    expect(pkg.targets.map((t) => t.name)).toEqual(['Stage', 'Amble', 'Star', 'Moon']);
    expect(pkg.targets[2].className).toBe('Star');
    expect(pkg.targets[2].code).toContain('class Star extends Sprite');
    expect(pkg.targets[1].code).toContain('this.turn(5);');
  });

  it('ignores compiled code when the world mode changed', () => {
    const p = starCatcher();
    p.compiled = { createdAt: 0, model: '', mode: '3d', inputHash: 'x', summary: '', howToPlay: '', warnings: [], code: [{ targetId: p.sprites[0].id, targetName: 'Amble', className: 'Amble', source: '', runSource: 'class Amble extends Sprite {}' }], sprites: [], assets: [], pieces: [] };
    const pkg = buildRunPackage(p);
    expect(pkg.targets[1].code).toBeNull();
  });
});
