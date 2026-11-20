import { describe, expect, it } from 'vitest';
import { fromLean, LEAN_SCHEMA, leanSchema, watchLean, type LeanReply } from '../src/compiler/lean';

const reply: LeanReply = {
  title: 'Cluckdown',
  howToPlay: 'Arrows to herd.',
  cast: [
    { name: 'Hen', description: 'A plump white hen.', width: 64, height: 60, costumes: [{ name: 'hen', pose: 'standing' }, { name: 'hen_step', pose: 'left foot forward' }], x: 10, y: 20, size: 100, direction: 0, visible: false },
    { name: 'Sprinter', description: 'A thin speedy hen.', width: 60, height: 60, costumes: [{ name: 'hen', pose: '' }], x: 0, y: 0, size: 90, direction: 0, visible: false },
  ],
  backdrops: [{ name: 'Farm', looks: 'A launch pad on a farm.' }],
  sounds: [{ name: 'Cluck', sound: 'a hen clucking' }],
  pieces: [{ id: 'p1', code: 'yield;' }],
  sprites: [
    { name: 'Hen', code: 'class Hen extends Sprite {}' },
    { name: 'Sprinter', code: 'class Sprinter extends Hen {}' },
  ],
  warnings: [],
  questions: [],
};

describe('the lean reply', () => {
  it('asks for the cast before the code, in both orders a model may follow', () => {
    expect(LEAN_SCHEMA.required.slice(0, 5)).toEqual(['title', 'howToPlay', 'cast', 'backdrops', 'sounds']);
    expect(Object.keys(LEAN_SCHEMA.properties).slice(0, 5)).toEqual(['title', 'howToPlay', 'cast', 'backdrops', 'sounds']);
  });

  it('can check its numbers between the cast and the code', () => {
    expect(leanSchema(false)).toBe(LEAN_SCHEMA);
    const s = leanSchema(true);
    expect(s.required).toEqual(['title', 'howToPlay', 'cast', 'backdrops', 'sounds', 'balance', 'pieces', 'sprites', 'warnings', 'questions']);
    expect(Object.keys(s.properties)).toEqual(s.required);
  });

  it("starts each character's drawings as soon as its entry is in, then the backdrops and the sounds", () => {
    const text = JSON.stringify(reply);
    const got: string[][] = [];
    const feed = watchLean((assets, title) => got.push([title, ...assets.map((a) => `${a.kind} ${a.target}/${a.name}: ${a.description}`)]));
    for (let i = 1; i <= text.length; i += 11) feed(text.slice(0, i));
    feed(text);
    expect(got).toEqual([
      ['Cluckdown', 'costume Hen/hen: A plump white hen. Pose: standing.', 'costume Hen/hen_step: A plump white hen. Pose: left foot forward.'],
      ['Cluckdown', 'costume Sprinter/hen: A thin speedy hen.'],
      ['Cluckdown', 'backdrop Stage/Farm: A launch pad on a farm.'],
      ['Cluckdown', 'sound Stage/Cluck: a hen clucking'],
    ]);
  });

  it('hands over each class as soon as it is written, with the art asked for so far', () => {
    const text = JSON.stringify(reply);
    const classes: string[] = [];
    const feed = watchLean(
      () => undefined,
      (name, code, asked, title) => classes.push(`${title}: ${name}: ${code} (${asked.length} asked)`),
    );
    for (let i = 1; i <= text.length; i += 9) feed(text.slice(0, i));
    expect(classes).toEqual(['Cluckdown: Hen: class Hen extends Sprite {} (5 asked)', 'Cluckdown: Sprinter: class Sprinter extends Hen {} (5 asked)']);
  });

  it('becomes an ordinary reply: characters with their code and places, and the asset list', () => {
    const r = fromLean({ ...reply, sprites: [...reply.sprites, { name: 'Egg', code: 'class Egg extends Sprite {}' }] });
    expect(r.sprites.map((s) => [s.name, s.x, s.visible, s.code])).toEqual([
      ['Hen', 10, false, 'class Hen extends Sprite {}'],
      ['Sprinter', 0, false, 'class Sprinter extends Hen {}'],
      // A class the cast left out still comes.
      ['Egg', 0, true, 'class Egg extends Sprite {}'],
    ]);
    expect(r.assets.map((a) => `${a.kind} ${a.target}/${a.name} ${a.width}x${a.height}`)).toEqual(['costume Hen/hen 64x60', 'costume Hen/hen_step 64x60', 'costume Sprinter/hen 60x60', 'backdrop Stage/Farm 480x360', 'sound Stage/Cluck 0x0']);
    expect(r.pieces).toEqual([{ id: 'p1', code: 'yield;' }]);
  });
});

describe('the lean reply with a second writer for the cast', () => {
  it("writes the characters' classes from the header while the game piece is written, and builds the game from both", async () => {
    const { vi } = await import('vitest');
    const { compileProject } = await import('../src/compiler/compile');
    const { DEFAULT_SETTINGS } = await import('../src/compiler/openai');
    const { ideaProject } = await import('../src/project/idea');
    const calls: Array<{ name: string; user: string; at: number }> = [];
    let mainDone = -1;
    const sse = (content: string) => {
      const parts = content.match(/[\s\S]{1,40}/g) ?? [];
      return new ReadableStream({
        async start(c) {
          for (const p of parts) {
            c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`));
            await new Promise((r) => setTimeout(r, 1));
          }
          c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
          c.close();
        },
      });
    };
    const main = {
      title: 'Cluckdown',
      howToPlay: 'Arrows to herd.',
      cast: [{ name: 'Hen', description: 'A plump hen.', width: 60, height: 60, costumes: [{ name: 'hen', pose: 'standing' }], x: 0, y: 0, size: 100, direction: 0, visible: false }],
      backdrops: [{ name: 'Farm', looks: 'A farm.' }],
      sounds: [{ name: 'Cluck', sound: 'a cluck' }],
      contract: 'Hen: shoo() makes it run off the pad.',
      balance: 'One wave of 5 hens over 30 s.',
      pieces: [] as Array<{ id: string; code: string }>,
      warnings: [],
      questions: [],
    };
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const name = body.response_format?.json_schema?.name;
      calls.push({ name, user: body.messages[1].content, at: calls.length });
      if (name === 'amble_pieces') {
        const id = /^- (p\d+): game/m.exec(body.messages[1].content)![1];
        const text = JSON.stringify({ ...main, pieces: [{ id, code: 'const hen = this.game.spawn("Hen", { x: 0, y: 0 }); hen.shoo(); this.playSound("Cluck");' }] });
        const stream = sse(text);
        return new Response(stream.pipeThrough(new TransformStream({ flush: () => void (mainDone = calls.length) })), { status: 200 });
      }
      if (name === 'amble_cast') return new Response(sse(JSON.stringify({ sprites: [{ name: 'Hen', code: 'class Hen extends Sprite { start() { this.hide(); } shoo() { this.costume = "hen_run"; } }' }] })), { status: 200 });
      if (name === 'svg_sheet' || name === 'svg_art') {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><circle cx="30" cy="30" r="20" fill="#fff"/></svg>';
        return new Response(sse(JSON.stringify(name === 'svg_art' ? { svg } : { costumes: [{ name: 'x', svg }] })), { status: 200 });
      }
      throw new Error(`unexpected request ${name}`);
    });
    vi.stubGlobal('fetch', fetch);
    (globalThis as { __ambleHarness?: object }).__ambleHarness = { lean: true, castWriter: true, balance: true, streamAssets: true, trialRun: 0, lint: true };
    try {
      const game = await compileProject(ideaProject('a countdown with chickens', 3, ''), { settings: { ...DEFAULT_SETTINGS, apiKey: 'sk-test' } });
      const cast = calls.find((c) => c.name === 'amble_cast')!;
      expect(cast.user).toContain('## The plan (written by the game\'s main writer');
      expect(cast.user).toContain('Hen: shoo() makes it run off the pad.');
      expect(cast.user).toContain('One wave of 5 hens over 30 s.');
      // It started while the main reply was still streaming.
      expect(cast.at).toBeLessThan(mainDone);
      expect(calls.find((c) => c.name === 'amble_pieces')!.user).toContain('## Two writers at once');
      expect(game.code.find((c) => c.targetName === 'Hen')?.source).toContain('shoo()');
      // The costume the cast's class uses that the header left out was drawn too.
      expect(game.assets.map((a) => `${a.targetName}/${a.name}`)).toEqual(expect.arrayContaining(['Hen/hen', 'Hen/hen_run', 'Stage/Farm', 'Stage/Cluck']));
      expect(game.warnings).toEqual([]);
    } finally {
      delete (globalThis as { __ambleHarness?: object }).__ambleHarness;
      vi.unstubAllGlobals();
    }
  });
});
