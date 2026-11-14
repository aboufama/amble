import { afterEach, describe, expect, it, vi } from 'vitest';
import { costumeSets, isPlaceholder, placeholderAsset, referenceOf, type AssetJob } from '../src/compiler/assets';
import { compileProject } from '../src/compiler/compile';
import { DEFAULT_SETTINGS } from '../src/compiler/openai';
import { imagePrompt, svgPrompt } from '../src/compiler/prompt';
import { block, workspace } from '../src/project/defaults';
import { ideaProject } from '../src/project/idea';
import { sanitizeSvg, svgDataUrl, svgFromDataUrl } from '../src/project/images';
import { STYLE_PRESETS, artBrief, pixelGrid, presetOf, styleWords } from '../src/project/styles';
import type { CompiledAsset, Project } from '../src/project/types';
import { STYLE_SAMPLES } from './style-samples';

afterEach(() => vi.unstubAllGlobals());

const settings = { ...DEFAULT_SETTINGS, apiKey: 'sk-test' };
const sse = (content: unknown) => new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: JSON.stringify(content) }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { status: 200 });
const sprite = (name: string) => ({ name, description: `the ${name}`, x: 0, y: 0, size: 100, direction: 0, visible: true, code: `class ${name} extends Sprite {}` });
/** An asset request whose description is its name, so a drawing request can be told by what it asks for. */
const costume = (target: string, name: string, size = 40) => ({ target, kind: 'costume', name, description: name, width: size, height: size, reuse: false });
const backdrop = (name: string) => ({ target: 'Stage', kind: 'backdrop', name, description: name, width: 480, height: 360, reuse: false });
const sound = (name: string) => ({ target: 'Stage', kind: 'sound', name, description: name, width: 0, height: 0, reuse: false });
/** What the fake artist draws for a picture: told apart by its id. */
const drawing = (name: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><circle id="drawn-${name}" cx="20" cy="20" r="16" fill="#f80"/></svg>`;

interface ArtRequest {
  /** The picture asked for (its description, which is its name here). */
  name: string;
  system: string;
  user: string;
}

/**
 * A fake model. Compile requests get `game(n)` (the cast and the art to make); every drawing
 * request is logged when it starts and when it ends, and answered a moment later with `draw(name)`.
 */
function fakeArtist(game: (n: number) => { sprites?: object[]; assets?: object[] }, draw: (name: string) => string = drawing) {
  const requests: ArtRequest[] = [];
  const log: string[] = [];
  const flight = { now: 0, most: 0 };
  let compiles = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (String(url).endsWith('/api/config')) return new Response('{}', { status: 404 });
      const body = JSON.parse(String(init.body));
      const schema = body.response_format?.json_schema?.name;
      const [system, user] = body.messages.map((m: { content: string }) => m.content) as string[];
      if (schema === 'amble_pieces') {
        const pieces = [...user.matchAll(/^- (p\d+):/gm)].map((m) => ({ id: m[1], code: 'yield;' }));
        return sse({ pieces, sprites: [], assets: [], warnings: [], questions: [], title: '', howToPlay: '', ...game(++compiles) });
      }
      if (schema !== 'svg_art') return sse({ segments: [{ wave: 'square', startFreq: 440, endFreq: 880, duration: 0.1, startVolume: 0.5, endVolume: 0 }] });
      const name = /^Draw a \w+ of \d+ x \d+ px[^:]*: (.*)$/m.exec(user)![1];
      requests.push({ name, system, user });
      log.push(`start ${name}`);
      flight.most = Math.max(flight.most, ++flight.now);
      await new Promise((r) => setTimeout(r, 4));
      flight.now--;
      log.push(`end ${name}`);
      return sse({ svg: draw(name) });
    }),
  );
  const request = (name: string) => requests.find((r) => r.name === name)!;
  return { requests, request, log, flight };
}

const svgOf = (assets: CompiledAsset[], name: string) => svgFromDataUrl(assets.find((a) => a.name === name && a.kind === 'image')!.dataUrl)!;
const before = (log: string[], a: string, b: string) => log.indexOf(a) >= 0 && log.indexOf(a) < log.indexOf(b);

describe('costumes of one character', () => {
  const cast = () => ({
    sprites: [sprite('Rex'), sprite('Meteor')],
    assets: [costume('Rex', 'rex-step1'), costume('Meteor', 'meteor-1'), costume('Rex', 'rex-step2'), backdrop('disco'), costume('Rex', 'rex-blink', 48), costume('Meteor', 'meteor-2'), sound('boom')],
  });

  it('draws the first costume, then draws the others from that drawing, to stay the same character', async () => {
    const artist = fakeArtist(cast);
    const game = await compileProject(ideaProject('a T-rex dodges meteors', 'go wild'), { settings });
    expect(game.warnings).toEqual([]);
    expect(game.assets.map((a) => a.name)).toEqual(['rex-step1', 'meteor-1', 'rex-step2', 'disco', 'rex-blink', 'meteor-2', 'boom']);

    // The first costume was finished before the others were asked for.
    for (const later of ['rex-step2', 'rex-blink']) expect(before(artist.log, 'end rex-step1', `start ${later}`)).toBe(true);
    expect(before(artist.log, 'end meteor-1', 'start meteor-2')).toBe(true);

    // The others are given its finished drawing and told to keep the character and change only what they say.
    const first = svgOf(game.assets, 'rex-step1');
    expect(first).toContain('id="drawn-rex-step1"');
    for (const later of ['rex-step2', 'rex-blink']) {
      const { user } = artist.request(later);
      expect(user).toContain(`"Rex" already has the costume "rex-step1" (40 x 40 px: rex-step1), drawn below.`);
      expect(user).toContain(`Costume "rex-step1":\n${first}`);
      expect(user).toContain('Keep the same character exactly: the same shapes, proportions, colours, gradients and line weight, at the same size and in the same position on the canvas.');
      expect(user).toContain("Change only what the new costume's description asks for (a leg forward, wings down, eyes closed, a mouth open)");
      expect(user).not.toContain('drawn-meteor');
    }
    expect(artist.request('meteor-2').user).toContain(`Costume "meteor-1":\n${svgOf(game.assets, 'meteor-1')}`);
    // A costume on a canvas of another size is told how to fit the character.
    expect(artist.request('rex-blink').user).toContain('This canvas is 48 x 48 px, not 40 x 40');
    expect(artist.request('rex-step2').user).not.toContain('This canvas is');
    // First costumes and backdrops are drawn from nothing.
    for (const alone of ['rex-step1', 'meteor-1', 'disco']) expect(artist.request(alone).user).not.toContain('already has the costume');
  });

  it('draws different characters at the same time, six pictures at once at most', async () => {
    const names = ['Ant', 'Bee', 'Cat', 'Dog'];
    const artist = fakeArtist(() => ({ sprites: names.map(sprite), assets: [1, 2, 3].flatMap((n) => names.map((name) => costume(name, `${name}-${n}`))) }));
    const game = await compileProject(ideaProject('a zoo', 'go wild'), { settings });
    expect(game.assets).toHaveLength(12);
    // Every character's first costume was started before any was finished: nobody waits for another character.
    expect(artist.log.slice(0, 4).sort()).toEqual(['start Ant-1', 'start Bee-1', 'start Cat-1', 'start Dog-1']);
    // Then the eight others, each after its own character's first, and never more than six at once.
    for (const name of names) for (const n of [2, 3]) expect(before(artist.log, `end ${name}-1`, `start ${name}-${n}`)).toBe(true);
    expect(artist.flight.most).toBeGreaterThanOrEqual(4);
    expect(artist.flight.most).toBeLessThanOrEqual(6);
  });

  it('makes six pictures at a time when nothing waits for anything', async () => {
    const names = ['Ant', 'Bee', 'Cat', 'Dog', 'Eel', 'Fox', 'Gnu', 'Hen'];
    const artist = fakeArtist(() => ({ sprites: names.map(sprite), assets: names.map((name) => costume(name, name)) }));
    const game = await compileProject(ideaProject('a zoo', 'go wild'), { settings });
    expect(game.assets.map((a) => a.name)).toEqual(names);
    // Six start at once; the seventh starts when one of them is done.
    expect(artist.log.slice(0, 6)).toEqual(names.slice(0, 6).map((name) => `start ${name}`));
    expect(artist.log[6]).toMatch(/^end /);
    expect(artist.flight.most).toBe(6);
  });

  it('starts the costumes that others wait for before the pictures nobody waits for', () => {
    const jobs = [backdrop('sky'), sound('pop'), costume('Rex', 'a'), costume('Coin', 'coin'), costume('Rex', 'b'), costume('Stage', 'c')].map(
      (a): AssetJob => ({ targetId: a.target, targetName: a.target, kind: a.kind as AssetJob['kind'], name: a.name, description: a.name, width: a.width, height: a.height }),
    );
    expect(costumeSets(jobs)).toEqual([
      { first: 2, rest: [4] },
      { first: 0, rest: [] },
      { first: 1, rest: [] },
      { first: 3, rest: [] },
      { first: 5, rest: [] },
    ]);
  });

  it("doesn't hold up the others when the first costume fails: they are drawn on their own", async () => {
    const artist = fakeArtist(cast, (name) => (name === 'rex-step1' ? 'Sorry, I cannot draw that.' : drawing(name)));
    const game = await compileProject(ideaProject('a T-rex dodges meteors', 'go wild'), { settings });
    expect(game.warnings).toEqual([`Couldn't make costume "rex-step1" (No <svg> element found.); used a placeholder.`]);
    expect(artist.requests.map((r) => r.name).sort()).toEqual(['disco', 'meteor-1', 'meteor-2', 'rex-blink', 'rex-step1', 'rex-step2']);
    for (const later of ['rex-step2', 'rex-blink']) {
      expect(before(artist.log, 'end rex-step1', `start ${later}`)).toBe(true);
      expect(artist.request(later).user).not.toContain('already has the costume');
      expect(svgOf(game.assets, later)).toContain(`id="drawn-${later}"`);
    }
    // The other character is untouched.
    expect(artist.request('meteor-2').user).toContain('id="drawn-meteor-1"');
    // The costume that failed looks like one of its character's others for now, not like a box with a letter.
    expect(game.assets.map((a) => a.name)).toEqual(['rex-step1', 'meteor-1', 'rex-step2', 'disco', 'rex-blink', 'meteor-2', 'boom']);
    expect(svgOf(game.assets, 'rex-step1')).toBe(svgOf(game.assets, 'rex-step2'));
    expect(new Set(game.assets.map((a) => a.id)).size).toBe(7);
  });

  it('uses a letter in a box only when the character has no other costume', async () => {
    fakeArtist(
      () => ({ sprites: [sprite('Rex')], assets: [costume('Rex', 'rex-step1'), costume('Rex', 'rex-step2')] }),
      () => 'no',
    );
    const game = await compileProject(ideaProject('a T-rex', 'go wild'), { settings });
    expect(game.warnings).toHaveLength(2);
    expect(svgOf(game.assets, 'rex-step1')).toContain('>R</text>');
    const job: AssetJob = { targetId: 's1', targetName: 'Rex', kind: 'costume', name: 'rex-blink', description: 'eyes closed', width: 40, height: 40 };
    const like = { ...placeholderAsset({ ...job, name: 'rex-step1' }), dataUrl: svgDataUrl(drawing('rex-step1')) };
    expect(placeholderAsset(job, like)).toMatchObject({ name: 'rex-blink', request: 'eyes closed', dataUrl: like.dataUrl, targetId: 's1' });
    expect(placeholderAsset(job, like).id).not.toBe(like.id);
    // A sound never stands in as a picture.
    expect(placeholderAsset({ ...job, kind: 'sound' }, like).kind).toBe('sound');
  });

  it('draws a new costume of a character made earlier from the costume it has', async () => {
    const artist = fakeArtist((n) => (n === 1 ? { sprites: [sprite('Rex')], assets: [costume('Rex', 'rex-step1')] } : { sprites: n === 3 ? [sprite('Rex')] : [], assets: [costume('Rex', 'rex-jump')] }));
    const p = ideaProject('a T-rex dodges meteors', 'fill in the gaps');
    const first = await compileProject(p, { settings });
    const stage = (p.stage.blocks!.blocks as { blocks: unknown[] }).blocks;
    const withRule: Project = { ...p, compiled: first, stage: { ...p.stage, blocks: workspace(...(stage as never[]), block('ga_rule', { RULE: 'Rex can jump' })) } };
    const second = await compileProject(withRule, { settings });
    expect(second.assets.map((a) => a.name)).toEqual(['rex-step1', 'rex-jump']);
    expect(artist.request('rex-jump').user).toContain(`Costume "rex-step1":\n${svgOf(first.assets, 'rex-step1')}`);
    // Starting over keeps nothing, so nothing is drawn from it.
    const again = await compileProject(withRule, { settings, fresh: true });
    expect(again.assets.map((a) => a.name)).toEqual(['rex-jump']);
    expect(artist.requests.at(-1)!.user).not.toContain('already has the costume');
  });

  it('never draws a character from the box that stands in for a costume that failed', async () => {
    const artist = fakeArtist(
      (n) => (n === 1 ? { sprites: [sprite('Rex')], assets: [costume('Rex', 'rex-step1')] } : { assets: [costume('Rex', 'rex-jump')] }),
      (name) => (name === 'rex-step1' ? 'no' : drawing(name)),
    );
    const p = ideaProject('a T-rex dodges meteors', 'fill in the gaps');
    const first = await compileProject(p, { settings });
    expect(first.assets.map(isPlaceholder)).toEqual([true]);
    const stage = (p.stage.blocks!.blocks as { blocks: unknown[] }).blocks;
    const withRule: Project = { ...p, compiled: first, stage: { ...p.stage, blocks: workspace(...(stage as never[]), block('ga_rule', { RULE: 'Rex can jump' })) } };
    const second = await compileProject(withRule, { settings });
    expect(second.assets.map(isPlaceholder)).toEqual([true, false]);
    expect(artist.request('rex-jump').user).not.toContain('already has the costume');
  });

  it('hands on a drawing only when it is one, and not too long to copy', () => {
    const asset = (svg: string, more: Partial<CompiledAsset> = {}) =>
      ({ id: 'a1', kind: 'image', name: 'rex', dataUrl: svgDataUrl(svg), mime: 'image/svg+xml', width: 40, height: 40, resolution: 1, centerX: 20, centerY: 20, description: 'a green T-rex', targetId: 's1', targetName: 'Rex', request: 'a green T-rex', ...more }) as CompiledAsset;
    expect(referenceOf(asset(drawing('rex')))).toEqual({ name: 'rex', description: 'a green T-rex', width: 40, height: 40, svg: drawing('rex') });
    expect(referenceOf(asset(`<svg>${'<g/>'.repeat(7000)}</svg>`))).toEqual({ name: 'rex', description: 'a green T-rex', width: 40, height: 40 });
    // An image model's picture: only what it shows is passed on (and its size in stage pixels).
    expect(referenceOf(asset('', { dataUrl: 'data:image/png;base64,AAAA', mime: 'image/png', width: 80, height: 80, resolution: 2 }))).toEqual({ name: 'rex', description: 'a green T-rex', width: 40, height: 40 });
    const told = imagePrompt({ kind: 'costume', mode: '2d', description: 'the T-rex with its eyes closed', gameTitle: 'Rex', reference: { name: 'rex', description: 'a green T-rex' } });
    expect(told).toContain('another costume of a sprite that already has the costume "rex", which shows: a green T-rex. Where this one shows the same character or thing, keep its colours, proportions and details the same');
    // A drawing prompt without a drawing to copy asks for the picture on its own.
    expect(svgPrompt({ kind: 'costume', mode: '2d', width: 40, height: 40, description: 'x', spriteName: 'Rex', gameTitle: 'Rex', reference: { name: 'rex', description: 'a green T-rex', width: 40, height: 40 } }).user).not.toContain('already has');
  });
});

describe('art styles', () => {
  /** The brief: the part of a drawing request that says how the game looks. */
  const briefOf = (system: string) => system.slice(system.indexOf("# The game's art style"), system.indexOf('# Rules'));
  const art = () => ({ sprites: [sprite('Rex'), sprite('Coin')], assets: [costume('Rex', 'rex'), costume('Coin', 'coin', 24), backdrop('cave')] });

  it("draws every picture of a game to one brief: each preset's own drawing guidance", async () => {
    expect(STYLE_PRESETS.map((p) => p.id)).toEqual(['cartoon', 'pixel', 'paper', 'neon', 'storybook', 'doodle', 'clay', 'minimal']);
    for (const preset of STYLE_PRESETS) {
      const artist = fakeArtist(art);
      await compileProject(ideaProject('a T-rex in a cave', 'go wild', preset.words), { settings });
      expect(artist.requests.map((r) => r.name).sort()).toEqual(['cave', 'coin', 'rex']);
      const briefs = artist.requests.map((r) => briefOf(r.system));
      // Sprites and the backdrop get the same brief, word for word.
      expect(new Set(briefs).size, preset.id).toBe(1);
      expect(briefs[0]).toContain(`# The game's art style: ${preset.label} (${preset.words})\n${preset.art}\n`);
      expect(briefs[0]).toContain('keep to this brief in every picture');
      for (const other of STYLE_PRESETS) if (other !== preset) expect(briefs[0]).not.toContain(other.art);
      expect(artist.request('rex').user).toContain(`Draw a costume of 40 x 40 px, in the game's art style (${preset.label}): rex`);
      expect(artist.request('cave').user).toContain(`Draw a backdrop of 480 x 360 px, in the game's art style (${preset.label}): cave`);
      expect(artist.request('cave').system).toContain('Fill the whole canvas (it is a background), in the same style as the sprites.');
      vi.unstubAllGlobals();
    }
  });

  it('says how each preset is drawn in SVG, with the colours and line weight every picture shares', () => {
    for (const preset of STYLE_PRESETS) {
      expect(presetOf(preset.words)).toBe(preset);
      expect(presetOf(preset.label.toUpperCase())).toBe(preset);
      // A palette in hexes, and what backdrops look like, in every one.
      expect((preset.art.match(/#[0-9a-f]{6}\b/g) ?? []).length, preset.id).toBeGreaterThanOrEqual(5);
      expect(preset.art, preset.id).toContain('Backdrops');
      expect(preset.art.length, preset.id).toBeLessThan(1500);
    }
    const by = (id: string) => STYLE_PRESETS.find((p) => p.id === id)!.art;
    expect(by('cartoon')).toContain('4 px wide');
    expect(by('paper')).toContain('<feDropShadow');
    expect(by('neon')).toContain('<feGaussianBlur');
    expect(by('storybook')).toMatch(/linearGradient or radialGradient/);
    expect(by('doodle')).toContain('<feDisplacementMap');
    expect(by('clay')).toContain('radialGradient');
    expect(by('minimal')).toContain('No outlines');
  });

  it('asks pixel art for a pixel grid and crisp edges, and keeps the edges crisp itself', async () => {
    const pixel = STYLE_PRESETS.find((p) => p.id === 'pixel')!;
    expect(pixel.art).toContain('on a grid of square pixels');
    expect(pixel.art).toContain('<rect> elements only');
    expect(pixel.art).toContain('whole multiples of the pixel size');
    expect(pixel.art).toContain('shape-rendering="crispEdges"');
    expect(pixel.art).toMatch(/no <path>, <circle>, <ellipse> or <polygon>, no strokes, gradients/);
    expect(pixelGrid(64, 64)).toEqual({ size: 4, columns: 16, rows: 16 });
    expect(pixelGrid(24, 30)).toEqual({ size: 2, columns: 12, rows: 15 });
    expect(pixelGrid(480, 360, true)).toEqual({ size: 8, columns: 60, rows: 45 });
    expect(pixelGrid(200, 120)).toEqual({ size: 8, columns: 25, rows: 15 });

    // Typed by hand, in other words: the same recipe, and the same grid.
    for (const words of [pixel.words, 'pixel art', '8-bit dungeon crawler', 'like an old Game Boy game']) {
      const artist = fakeArtist(art);
      const game = await compileProject(ideaProject('a T-rex in a cave', 'go wild', words), { settings });
      for (const r of artist.requests) {
        expect(r.system, words).toContain(pixel.art);
        expect(r.system, words).toMatch(/pixel grid/);
        expect(r.system, words).toMatch(/crisp/);
      }
      expect(artist.request('rex').user).toContain('Pixel grid: one pixel is 4 x 4 units, so this picture is 10 x 10 pixels; every x, y, width and height is a multiple of 4.');
      expect(artist.request('coin').user).toContain('Pixel grid: one pixel is 2 x 2 units, so this picture is 12 x 12 pixels');
      expect(artist.request('cave').user).toContain('Pixel grid: one pixel is 8 x 8 units, so this picture is 60 x 45 pixels');
      // The fake artist forgot shape-rendering: the picture has it anyway.
      expect(svgOf(game.assets, 'rex')).toMatch(/^<svg [^>]*shape-rendering="crispEdges"/);
      vi.unstubAllGlobals();
    }
  });

  it("makes a brief out of a style in the author's own words", async () => {
    const artist = fakeArtist(art);
    const game = await compileProject(ideaProject('a T-rex in a cave', 'go wild', 'like a comic book'), { settings });
    expect(game.style).toBe('art style: [like a comic book]');
    const briefs = artist.requests.map((r) => briefOf(r.system));
    expect(new Set(briefs).size).toBe(1);
    expect(briefs[0]).toContain('The author asked for this style, in their own words: "like a comic book".');
    expect(briefs[0]).toContain('Honour it for real. A named style is a set of drawing rules');
    expect(briefs[0]).toContain('pixel art means <rect>s on a pixel grid with crisp edges (shape-rendering="crispEdges"), not smooth curves');
    // What a comic is made of in SVG.
    expect(briefs[0]).toContain('For this style in particular');
    expect(briefs[0]).toContain('halftone dots (define a <pattern id="dots"');
    expect(artist.request('rex').user).toContain("in the game's art style (like a comic book)");
    expect(artist.request('rex').user).not.toContain('Pixel grid');
    expect(svgOf(game.assets, 'rex')).not.toContain('shape-rendering');
  });

  it('finds the technique in typed styles, and manages without one', () => {
    const by = (id: string) => STYLE_PRESETS.find((p) => p.id === id)!.art;
    expect(artBrief('glowing neon signs at night').svg).toContain(by('neon'));
    expect(artBrief('like Minecraft').svg).toContain(by('pixel'));
    expect(artBrief('like Minecraft').svg).not.toContain(by('paper'));
    expect(artBrief('Watercolour, like a picture book').svg).toContain(by('storybook'));
    expect(artBrief('low-poly').svg).toContain('flat triangles and quads');
    expect(artBrief('a newspaper comic strip').svg).not.toContain(by('paper'));
    expect(artBrief('3D, like a toy').svg).toContain('As three-dimensional as SVG gets');
    // A subject or a palette goes with whatever the technique is.
    const noir = artBrief('black and white comic').svg;
    expect(noir).toContain('halftone');
    expect(noir).toContain('only #111111, #ffffff and at most two greys');
    expect(artBrief('pink and sparkly').svg).not.toContain('Black and white');
    // No technique named: the general method, and a mood chooses colours and shapes.
    const spooky = artBrief('  spooky\n  haunted house ');
    expect(spooky).toMatchObject({ words: 'spooky haunted house', name: 'spooky haunted house', preset: null, pixel: false, image: 'spooky haunted house' });
    expect(spooky.svg).not.toContain('For this style in particular');
    expect(spooky.svg).toContain('If the words give a mood or a theme more than a technique');
    expect(spooky.svg).toContain('so that pictures drawn separately come out alike');
    // Quotes in the words can't end the quotation.
    expect(artBrief('the "best" style').svg).toContain(`in their own words: "the 'best' style".`);
    expect(artBrief('x'.repeat(500)).words).toHaveLength(300);
  });

  it("keeps today's look when no style is asked for", async () => {
    const artist = fakeArtist(art);
    const game = await compileProject(ideaProject('a T-rex in a cave', 'go wild'), { settings });
    expect(game.style).toBe('');
    for (const r of artist.requests) {
      expect(r.system).toContain("# The game's art style\nThe friendly flat style of Scratch costumes: bold simple shapes, clean dark outlines, bright cheerful colors, a little shading with one or two darker or lighter shapes.");
      expect(r.user).not.toContain("in the game's art style");
    }
    expect(artist.request('rex').user).toBe('Game: Untitled game\nSprite: Rex\nDraw a costume of 40 x 40 px: rex');
    expect(artBrief('')).toMatchObject({ words: '', preset: null, pixel: false, image: '' });
    expect(svgPrompt({ kind: 'costume', mode: '2d', width: 40, height: 40, description: 'x', spriteName: 'Rex', gameTitle: 'Rex' }).system).toBe(artist.request('rex').system);
  });

  it('reads the style from the art style blocks', () => {
    expect(styleWords('')).toBe('');
    expect(styleWords('art style: [pixel art]')).toBe('pixel art');
    expect(styleWords('art style: […]')).toBe('');
    expect(styleWords('art style: [neon [glow]]\nart style: [neon [glow]]\nart style: [on dark]')).toBe('neon [glow]; on dark');
    expect(styleWords(`art style: [${'y'.repeat(400)}]`)).toHaveLength(300);
    for (const preset of STYLE_PRESETS) expect(artBrief(styleWords(`art style: [${preset.words}]`)).preset).toBe(preset);
  });

  it('asks an image model for the same style', () => {
    const sprite = (words: string) => imagePrompt({ kind: 'costume', mode: '2d', description: 'a green T-rex', gameTitle: 'Rex', style: artBrief(words) });
    const scene = (words: string) => imagePrompt({ kind: 'backdrop', mode: '2d', description: 'a cave', gameTitle: 'Rex', style: artBrief(words) });
    for (const preset of STYLE_PRESETS) {
      for (const prompt of [sprite(preset.words), scene(preset.words)]) {
        expect(prompt).toContain(`Art style: ${preset.words}. Every picture of the game is in this style.`);
        expect(prompt).not.toMatch(/Scratch|cartoon style/);
      }
    }
    expect(sprite('like a comic book')).toBe('A single game sprite for "Rex": a green T-rex. Art style: like a comic book. Every picture of the game is in this style. Centered, side view facing right, isolated on a transparent background, no text, no shadow on the ground.');
    expect(scene('like a comic book')).toBe('A 2D video game background for "Rex": a cave. Art style: like a comic book. Every picture of the game is in this style. No text, no characters in the foreground.');
    // No style: as before.
    expect(sprite('')).toBe('A single game sprite for "Rex": a green T-rex. Flat cartoon style like Scratch costumes, bold clean outlines, bright colors, centered, side view facing right, isolated on a transparent background, no text, no shadow on the ground.');
    expect(scene('')).toBe('A colorful 2D video game background for "Rex": a cave. Flat, friendly cartoon style like Scratch, clean shapes, no text, no characters in the foreground.');
    expect(imagePrompt({ kind: 'costume', mode: '2d', description: 'a green T-rex', gameTitle: 'Rex' })).toBe(sprite(''));
  });
});

describe('making SVG safe', () => {
  const clean = (body: string, root = '') => sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"${root}>${body}</svg>`, 64, 64);
  const inside = (out: string) => out.replace(/^<svg [^>]*>/, '').replace(/<\/svg>$/, '');
  /** Nothing that runs, loads or links is left (the namespaces on the root aside). */
  const expectSafe = (out: string) => expect(inside(out)).not.toMatch(/script|\son\w+\s*=|javascript|https?:|\/\/|data:|foreignobject|<image|<iframe|<animate|<set\b|@import|<a\b/i);

  it('keeps every style sample as it was drawn', () => {
    expect(Object.keys(STYLE_SAMPLES)).toEqual([...STYLE_PRESETS.map((p) => p.id), 'comic', 'chalk']);
    for (const [id, svg] of Object.entries(STYLE_SAMPLES)) {
      const out = sanitizeSvg(svg, 64, 64, { crispEdges: id === 'pixel' });
      expect(out, id).toBe(svg);
      // And again: what was made safe stays as it is (it is what a character's other costumes are drawn from).
      expect(sanitizeSvg(out, 64, 64), id).toBe(svg);
    }
  });

  it('keeps what the styles are made of', () => {
    const kept = [
      '<defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox" gradientTransform="rotate(20)"><stop offset="0" stop-color="#fff" stop-opacity="0.5"/><stop offset="1" stop-color="#f7e3a1"/></linearGradient></defs><rect width="64" height="64" fill="url(#a)"/>',
      '<defs><radialGradient id="b" cx="35%" cy="30%" r="75%"><stop offset="0.55" stop-color="#f7cf3d"/></radialGradient></defs><circle cx="32" cy="32" r="20" fill="url(#b)"/>',
      '<defs><filter id="glow" x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="2.2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><g filter="url(#glow)"><path d="M4 4L60 60" stroke="#22e6ff" stroke-width="3" stroke-linecap="round" fill="none"/></g>',
      '<defs><filter id="paper"><feDropShadow dx="1" dy="1.5" stdDeviation="1" flood-color="#2b1d12" flood-opacity="0.4"/></filter></defs><g filter="url(#paper)"><polygon points="1,2 3,4 5,6" fill="#c8553d"/></g>',
      '<defs><filter id="rough"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="7"/><feDisplacementMap in="SourceGraphic" scale="2" xChannelSelector="R" yChannelSelector="G"/><feColorMatrix type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"/><feOffset dx="1"/><feFlood flood-color="#000"/><feComposite operator="in" in2="SourceAlpha"/></filter></defs>',
      '<defs><pattern id="dots" width="4" height="4" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.1" fill="#1b1b1f"/></pattern><clipPath id="c"><rect width="10" height="10"/></clipPath><mask id="m"><ellipse cx="5" cy="5" rx="4" ry="3" fill="#fff"/></mask></defs><rect width="64" height="64" fill="url(#dots)" clip-path="url(#c)" mask="url(#m)"/>',
      '<defs><g id="leg"><line x1="0" y1="0" x2="0" y2="9" stroke="#000"/></g></defs><use href="#leg" x="20" y="50"/><use href="#leg" transform="translate(30 50)"/><polyline points="1,1 2,2" opacity="0.5" style="fill:none;stroke:red"/>',
      '<text x="4" y="20" font-family="sans-serif" font-size="12" text-anchor="middle">Level <tspan font-weight="bold">2</tspan> &amp; up</text>',
    ];
    for (const body of kept) expect(inside(clean(body))).toBe(body);
    expect(clean('<rect width="4" height="4"/>', ' shape-rendering="crispEdges"')).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" shape-rendering="crispEdges"><rect width="4" height="4"/></svg>');
    // Pixel art gets its crisp edges whatever the artist wrote.
    expect(sanitizeSvg('<svg shape-rendering="auto"><rect width="4" height="4"/></svg>', 8, 8, { crispEdges: true })).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8" shape-rendering="crispEdges"><rect width="4" height="4"/></svg>');
  });

  it('tidies what a model gets slightly wrong, so the picture still draws', () => {
    const sloppy = `Here is your picture!
\`\`\`svg
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<SVG width="100%" height='200' viewbox="0 0 64 64" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape">
  <!-- the glow -->
  <title>A chick</title>
  <defs>
    <lineargradient id="g" gradientunits="userSpaceOnUse"><stop offset=0 stop-color='#fff'/></lineargradient>
    <filter id="glow"><fegaussianblur stddeviation="2"/></filter>
  </defs>
  <g inkscape:label="body" filter="url('#glow')">
    <circle cx="32" cy="32" r="20" fill="url(#g)" hidden/>
    <use xlink:href="#g"/>
  </g>
</SVG>
\`\`\``;
    expect(sanitizeSvg(sloppy, 64, 64)).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="64" height="64" viewBox="0 0 64 64">' +
        '<defs><linearGradient id="g" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/></linearGradient><filter id="glow"><feGaussianBlur stdDeviation="2"/></filter></defs>' +
        '<g filter="url(#glow)"><circle cx="32" cy="32" r="20" fill="url(#g)"/><use xlink:href="#g"/></g></svg>',
    );
    // No size or viewBox of its own: the size it was asked for.
    expect(sanitizeSvg('<svg><rect width="5" height="5"/></svg>', 40, 30)).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30" viewBox="0 0 40 30"><rect width="5" height="5"/></svg>');
  });

  it('removes scripts, however they are written', () => {
    const out = clean('<script>alert(1)</script><script type="text/javascript"><![CDATA[ if (a < b) alert("</svg>") ]]></script><script href="https://evil.example/x.js"/><SCRIPT>alert(2)</SCRIPT><circle r="3"/>');
    expect(inside(out)).toBe('<circle r="3"/>');
    // Text that would become a script once a script inside it was taken out isn't put back together.
    expect(() => clean('<scr<script>x</script>ipt>alert(1)</script><circle r="3"/>')).toThrow('The SVG is malformed.');
    expect(inside(clean('<g><script>if (a<b) alert(1)</script><circle r="3"/></g>'))).toBe('<g><circle r="3"/></g>');
    expectSafe(clean('<style>@import url("https://evil.example/a.css"); @import "b.css"; .a{fill:red}</style><rect class="a" width="5" height="5"/>'));
    // A style sheet holds text: an element in it goes, with what it holds.
    expect(inside(clean('<style>.a{fill:red;stroke:url("javascript:alert(1)")}<g title="x"><circle r="1"/></g></style>'))).toBe('<style>.a{fill:red;stroke:none}</style>');
  });

  it('removes event handlers', () => {
    expect(inside(clean('<rect width="5" height="5" onclick="steal()" ONLOAD=\'x()\' onmouseover=go() fill="red"/>'))).toBe('<rect width="5" height="5" fill="red"/>');
    expect(sanitizeSvg('<svg onload="alert(1)" width="5" height="5"><g onfocusin="x()"/></svg>', 5, 5)).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="5" height="5" viewBox="0 0 5 5"><g/></svg>');
    // A tag an XML parser wouldn't take is not passed on in any form.
    expect(() => sanitizeSvg('<svg/onload=alert(1)><rect/></svg>', 5, 5)).toThrow('The SVG is malformed.');
    expect(() => clean('<rect width="5"onclick="x()"/>')).toThrow('The SVG is malformed.');
    // Animation can set a handler or a link later: it goes whole.
    const animated = clean('<circle r="3"><animate attributeName="r" values="3;6;3" dur="1s" onbegin="x()"/><set attributeName="onclick" to="x()"/></circle><a href="#x"><animate attributeName="href" to="javascript:alert(1)"/><rect width="2" height="2"/></a>');
    expect(inside(animated)).toBe('<circle r="3"></circle><rect width="2" height="2"/>');
  });

  it('removes foreign and embedded content', () => {
    const out = clean(
      '<foreignObject width="64" height="64"><div xmlns="http://www.w3.org/1999/xhtml" onclick="x()">hi<img src="https://evil.example/a.png"/></div></foreignObject>' +
        '<FOREIGNOBJECT><p>x</p></FOREIGNOBJECT><foreignObject/><iframe src="https://evil.example"></iframe><image href="https://evil.example/a.png" width="5" height="5"/>' +
        '<image xlink:href="data:image/png;base64,AAAA"/><embed src="x"/><object data="x"></object><video src="x"/><div>stray <b>html</b></div><circle r="3"/>',
    );
    expect(inside(out)).toBe('<circle r="3"/>');
  });

  it('removes every reference outside the picture', () => {
    const out = clean(
      '<defs><filter id="f"><feImage href="https://evil.example/a.png"/><feGaussianBlur stdDeviation="1"/></filter></defs>' +
        '<use href="https://evil.example/sprites.svg#hero"/><use xlink:href="//evil.example/x.svg#a"/><use href="#ok"/>' +
        '<a href="https://evil.example" xlink:href="javascript:alert(1)"><circle r="3" fill="url(https://evil.example/paint.svg#p)" stroke="url(#ok)"/></a>' +
        '<rect width="1" height="1" style="fill:url(\'https://evil.example/a.svg#b\');mask:url(#m);background:u\\72l(https://evil.example/c)" filter="url(data:image/svg+xml,x)"/>' +
        '<path d="M0 0" xml:base="https://evil.example/" fill="&#117;rl(https://evil.example/p)" clip-path="url( #c )"/>' +
        '<g style="background-image:image-set(\'https://evil.example/a.png\' 1x)" src="https://evil.example"/>' +
        '<style>.a{fill:url(https://evil.example/a.svg#b)} @font-face{font-family:x;src:url("https://evil.example/f.woff")} .b{fill:url(#ok)} .c{background:\\75rl(https://evil.example/c)}</style>',
    );
    expectSafe(out);
    expect(inside(out)).toContain('<filter id="f"><feGaussianBlur stdDeviation="1"/></filter>');
    expect(inside(out)).toContain('<use/><use/><use href="#ok"/>');
    expect(inside(out)).toContain('<circle r="3" fill="none" stroke="url(#ok)"/>');
    expect(inside(out)).toContain('style="fill:none;mask:url(#m);background:none"');
    expect(inside(out)).toContain('<path d="M0 0" fill="none" clip-path="url(#c)"/>');
    expect(inside(out)).toContain('.b{fill:url(#ok)}');
    // An escaped backslash doesn't leave an escape behind for the browser to read.
    expect(inside(clean('<rect width="1" height="1" fill="\\\\75rl(https://evil.example/p)" style="fill:\\\\75rl(https://evil.example/p)"/>'))).not.toContain('\\');
    // Hidden behind entities, case and spaces.
    for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', '&#106;avascript:alert(1)', '&#x6A;avascript:alert(1)', ' java\tscript:alert(1)', 'data:text/html,<script>alert(1)</script>'.replace(/</g, '&lt;'), 'vbscript:x']) {
      expect(inside(clean(`<use href="${href}"/><a xlink:href="${href}"><rect width="1" height="1" fill="${href}"/></a>`)), href).toBe('<use/><rect width="1" height="1"/>');
    }
  });

  it('turns down what is not a well-formed picture', () => {
    expect(() => sanitizeSvg('Sorry, I cannot draw that.', 64, 64)).toThrow('No <svg> element found.');
    expect(() => sanitizeSvg('<svg width="5" height="5"/>', 64, 64)).toThrow('No <svg> element found.');
    expect(() => clean('<g><rect width="5" height="5"></g>')).toThrow('The SVG is malformed.');
    expect(() => clean('<g><circle r="3"/>')).toThrow('The SVG is malformed.');
    expect(() => clean('<script><g></script><circle r="3"/>')).toThrow('The SVG is malformed.');
    // Two pictures in one reply: the first.
    expect(sanitizeSvg('<svg><rect width="1" height="1"/></svg><svg><circle r="1"/></svg>', 4, 4)).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4" viewBox="0 0 4 4"><rect width="1" height="1"/></svg>');
  });

  it('reads a drawing back from its data URL', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><text>é ★ 鳥</text></svg>';
    expect(svgFromDataUrl(svgDataUrl(svg))).toBe(svg);
    expect(svgFromDataUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)).toBe(svg);
    expect(svgFromDataUrl('data:image/png;base64,AAAA')).toBeNull();
    expect(svgFromDataUrl('data:image/svg+xml;base64,@@@')).toBeNull();
  });
});
