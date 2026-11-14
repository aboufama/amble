import { expect, test, type Frame, type Page } from '@playwright/test';

/**
 * The start screen, the simple palette (one board with every block in view), and a game made
 * from an idea: say what you want in a sentence and Amble makes the whole game (answered here by
 * a mock of the OpenAI API), then change it by saying so.
 */

// A first visit: nothing in this browser yet (the other tests start past the start screen, with every block).
test.use({ storageState: { cookies: [], origins: [] } });

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60"><circle cx="30" cy="30" r="26" fill="#58c66a"/></svg>';

function sse(content: string): string {
  return [`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: 'stop' }] })}\n\n`, 'data: [DONE]\n\n'].join('');
}

interface Call {
  name: string;
  system: string;
  user: string;
}

/** A model that writes a tiny game for the game piece (a Rex who walks), and a jetpack when asked for one. */
async function mockModel(page: Page, calls: Call[]) {
  await page.route('https://api.openai.com/v1/**', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const name: string = body.response_format?.json_schema?.name ?? 'unknown';
    const system: string = body.messages?.[0]?.content ?? '';
    const user: string = body.messages?.[1]?.content ?? '';
    calls.push({ name, system, user });
    const tasks = [...user.matchAll(/^- (p\d+): (\w+)/gm)].map((m) => ({ id: m[1], kind: m[2] }));
    let reply: unknown = {};
    if (name === 'amble_pieces') {
      const game = tasks.some((t) => t.kind === 'game');
      reply = {
        pieces: tasks.map((t) => ({ id: t.id, code: t.kind === 'game' ? 'window.__gameStarted = true;\nthis.game.vars.score = 0;\nfor (;;) { this.game.vars.score++; yield; }' : 'window.__wish = true;\nfor (;;) { yield; }' })),
        sprites: game
          ? [{ name: 'Rex', description: 'A T-rex on roller skates', x: 0, y: -60, size: 100, direction: 0, visible: true, code: 'class Rex extends Sprite {\n  start() {\n    this.walkWith("arrow keys", 220);\n    window.__rex = true;\n  }\n}' }]
          : [{ name: 'Rex', description: 'A T-rex on roller skates, with a jetpack', x: 0, y: -60, size: 100, direction: 0, visible: true, code: 'class Rex extends Sprite {\n  start() {\n    this.walkWith("arrow keys", 220);\n    window.__jetpack = true;\n  }\n}' }],
        assets: game ? [{ target: 'Rex', kind: 'costume', name: 'rex', description: 'a green T-rex on roller skates', width: 60, height: 60, reuse: false }] : [],
        warnings: [],
        questions: [],
        title: game ? 'Meteor Disco Rex' : '',
        howToPlay: game ? 'Arrow keys to skate. Dodge the meteors!' : '',
      };
    } else if (name === 'svg_art') reply = { svg };
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: sse(JSON.stringify(reply)) });
  });
}

async function gameFrame(page: Page): Promise<Frame> {
  const handle = await page.waitForSelector('iframe.player-frame');
  return (await handle.contentFrame())!;
}

const flags = (frame: Frame) =>
  frame.evaluate(() => {
    const w = window as unknown as { __ambleGame?: { state: string }; __gameStarted?: boolean; __rex?: boolean; __jetpack?: boolean; __wish?: boolean };
    return { state: w.__ambleGame?.state ?? '', game: Boolean(w.__gameStarted), rex: Boolean(w.__rex), jetpack: Boolean(w.__jetpack), wish: Boolean(w.__wish) };
  });

const paletteBlocks = (page: Page) =>
  page.evaluate(() => {
    type Ws = { getFlyout(): { getWorkspace(): { getTopBlocks(o: boolean): Array<{ type: string }> } } };
    return (window as unknown as { __ambleWorkspace: Ws }).__ambleWorkspace
      .getFlyout()
      .getWorkspace()
      .getTopBlocks(false)
      .map((b) => b.type);
  });

test('a first visit starts with "What do you want to make?" and the demos, once', async ({ page }) => {
  await page.goto('/');
  const start = page.getByRole('dialog', { name: 'Make a game' });
  await expect(start).toBeVisible();
  await expect(start.getByLabel('What do you want to make?')).toBeFocused();
  // Every demo is there, the ones made from one sentence first, each with its sentence.
  await expect(start.getByRole('button', { name: /^Demo: / })).toHaveCount(13);
  await expect(start.getByRole('button', { name: 'Demo: Meteor Disco Rex' })).toContainText('a T-rex on roller skates dodges meteors at a disco');
  // Nothing to make yet.
  await expect(start.getByRole('button', { name: 'Make my game' })).toBeDisabled();
  await start.getByRole('button', { name: 'Give me an idea' }).click();
  await expect(start.getByLabel('What do you want to make?')).not.toHaveValue('');
  await expect(start.getByRole('button', { name: 'Make my game' })).toBeEnabled();

  // It doesn't come back by itself; File > New game opens it again.
  await page.keyboard.press('Escape');
  await expect(start).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.blocklyMainBackground')).toBeVisible();
  await expect(start).toHaveCount(0);
  await page.getByRole('button', { name: /File/ }).click();
  await page.getByRole('menuitem', { name: 'New game' }).click();
  await expect(start).toBeVisible();
});

interface PaletteItem {
  name: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** What the palette shows: which blocks and buttons are cut off or lie over another, whether it scrolls, and where its switch is. */
const paletteLayout = (page: Page) =>
  page.evaluate(() => {
    type Block = { type: string; getSvgRoot(): SVGElement };
    type Flyout = { isScrollable(): boolean; getWorkspace(): { scale: number; getTopBlocks(o: boolean): Block[] } };
    const flyout = (window as unknown as { __ambleWorkspace: { getFlyout(): Flyout } }).__ambleWorkspace.getFlyout();
    const box = (name: string, el: Element): PaletteItem => {
      const r = el.getBoundingClientRect();
      return { name, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    const items = [
      ...flyout
        .getWorkspace()
        .getTopBlocks(false)
        .map((b) => box(b.type, b.getSvgRoot())),
      ...[...document.querySelectorAll('.blocklyFlyout .blocklyFlyoutButton')].map((el) => box(el.textContent ?? 'button', el)),
    ];
    const palette = box('palette', document.querySelector('.blocklyFlyout')!);
    const toggle = box('switch', document.querySelector('.amblePaletteSwitch')!);
    const slack = 0.5;
    return {
      count: items.length,
      scale: flyout.getWorkspace().scale,
      scrolls: flyout.isScrollable(),
      cut: items.filter((i) => i.left < palette.left - slack || i.top < palette.top - slack || i.right > palette.right + slack || i.bottom > palette.bottom + slack).map((i) => i.name),
      over: items.flatMap((a, i) => items.filter((b, j) => i < j && a.left < b.right - slack && b.left < a.right - slack && a.top < b.bottom - slack && b.top < a.bottom - slack).map((b) => `${a.name} / ${b.name}`)),
      width: palette.right - palette.left,
      // The switch is under the palette, inside the window.
      switchInView: toggle.top >= palette.bottom - slack && toggle.bottom <= window.innerHeight && toggle.left >= 0 && toggle.right <= palette.right,
    };
  });

/** Where to grab a block: on its own colour at its left end, clear of its fields. */
const grip = (page: Page, type: string) =>
  page.evaluate((type) => {
    type Block = { getSvgRoot(): SVGElement };
    type Ws = { getFlyout(): { getWorkspace(): { getBlocksByType(t: string, o: boolean): Block[] } } };
    const block = (window as unknown as { __ambleWorkspace: Ws }).__ambleWorkspace.getFlyout().getWorkspace().getBlocksByType(type, false)[0];
    const r = block.getSvgRoot().querySelector(':scope > .blocklyPath')!.getBoundingClientRect();
    return { x: r.left + 7, y: r.top + r.height / 2 };
  }, type);

/** The blocks in the code area, by type (sorted). */
const codeBlocks = (page: Page) =>
  page.evaluate(() => {
    type Ws = { getAllBlocks(o: boolean): Array<{ type: string; isShadow(): boolean }> };
    return (window as unknown as { __ambleWorkspace: Ws }).__ambleWorkspace
      .getAllBlocks(false)
      .filter((b) => !b.isShadow())
      .map((b) => b.type)
      .sort();
  });

/** A first visit, past the start screen: the editor as it opens, in a 1280 x 720 window. */
async function openEditor(page: Page) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  const start = page.getByRole('dialog', { name: 'Make a game' });
  await expect(start).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(start).toHaveCount(0);
  await expect(page.locator('.blocklyMainBackground')).toBeVisible();
}

test('the palette starts as one board: every block in view at once, under plain headings', async ({ page }) => {
  await openEditor(page);
  // A card for each thing the author wants to do, and no column of categories.
  await expect(page.locator('.ambleBoardHeading > text:not(.ambleBoardNote)')).toHaveText(['Say what happens', 'When…', 'Check', 'Do', 'Remember']);
  await expect(page.locator('.ambleBoardNote')).toHaveText('in your own words');
  await expect(page.locator('.blocklyToolbox')).toBeHidden();

  // A sprite: 26 blocks and the project's variable, the ones that take words first.
  const sprite = await paletteBlocks(page);
  expect(sprite).toHaveLength(27);
  expect(sprite.slice(0, 2)).toEqual(['ru_always', 'ru_never']);
  expect(sprite).toEqual(expect.arrayContaining(['ev_start', 'ev_touch', 'ga_do', 'kit_walk', 'kit_jump', 'cd_words', 'nm_words', 'mem_set']));
  for (const gone of ['mv_turn', 'br_freedom', 'ga_do_for', 'ga_rule']) expect(sprite).not.toContain(gone);

  // One screen: nothing is cut off, nothing lies over anything else, nothing scrolls, and the blocks still read.
  const fits = async (blocks: number, scale: number) => {
    await expect.poll(async () => (await paletteLayout(page)).count).toBe(blocks);
    const layout = await paletteLayout(page);
    expect(layout).toMatchObject({ cut: [], over: [], scrolls: false, switchInView: true });
    expect(layout.scale).toBeGreaterThanOrEqual(scale);
    return layout;
  };
  await fits(28, 0.58);

  // The stage: its brief in words (no imagination block: the dial is not a block any more), 20 blocks.
  await page.locator('.stage-selector').click();
  await expect.poll(async () => (await paletteBlocks(page)).slice(0, 3)).toEqual(['br_game', 'br_style', 'ga_rule']);
  expect(await paletteBlocks(page)).toHaveLength(20);
  expect(await paletteBlocks(page)).not.toContain('br_freedom');
  await fits(21, 0.62);

  // A larger window: the board follows, with its blocks at the size they have in the code.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(async () => (await paletteLayout(page)).scale).toBeCloseTo(0.675, 3);
  await fits(21, 0.675);
  await page.locator('.sprite-tile').first().click();
  await fits(28, 0.675);

  // More variables: still one screen.
  await page.evaluate(() => {
    type Store = { getState(): { update(fn: (p: { variables: string[] }) => void): void } };
    (window as unknown as { __ambleStore: Store }).__ambleStore.getState().update((p) => {
      p.variables = ['score', 'lives', 'level', 'high score', 'coins'];
    });
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await fits(32, 0.5);
});

test('blocks come off the board by dragging, or with a click', async ({ page }) => {
  await openEditor(page);
  await expect(page.locator('.ambleBoardHeading')).toHaveCount(5);
  const before = await codeBlocks(page);
  expect(before).not.toContain('ru_always');
  const code = (await page.locator('.blocklyMainBackground').boundingBox())!;
  const palette = (await paletteLayout(page)).width;

  // Dragging, the Blockly way: "always:" to an empty spot of the code area.
  const always = await grip(page, 'ru_always');
  await page.mouse.move(always.x, always.y);
  await page.mouse.down();
  await page.mouse.move(always.x + 20, always.y + 12, { steps: 4 });
  await page.mouse.move(palette + 200, code.y + code.height - 120, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => codeBlocks(page)).toEqual([...before, 'ru_always'].sort());

  // Straight down works too: the board doesn't scroll, so every drag picks the block up.
  const wait = await grip(page, 'fl_wait');
  await page.mouse.move(wait.x, wait.y);
  await page.mouse.down();
  await page.mouse.move(wait.x, wait.y + 40, { steps: 4 });
  await page.mouse.move(palette + 220, code.y + code.height - 60, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => codeBlocks(page)).toEqual([...before, 'ru_always', 'fl_wait'].sort());

  // A click adds the block to the code, clear of the scripts that are there, in one step that undoes.
  const gravity = await grip(page, 'kit_gravity');
  await page.mouse.click(gravity.x, gravity.y);
  await expect.poll(() => codeBlocks(page)).toEqual([...before, 'ru_always', 'fl_wait', 'kit_gravity'].sort());
  const landed = await page.evaluate(() => {
    type Rect = { left: number; top: number; right: number; bottom: number };
    type B = { type: string; getParent(): B | null; getBoundingRectangle(): Rect };
    const ws = (window as unknown as { __ambleWorkspace: { getTopBlocks(o: boolean): B[] } }).__ambleWorkspace;
    const tops = ws.getTopBlocks(false);
    const added = tops.filter((b) => b.type === 'kit_gravity');
    const a = added[0]?.getBoundingRectangle();
    const touching = tops.filter((b) => b !== added[0]).filter((b) => {
      const r = b.getBoundingRectangle();
      return a && r.left < a.right && a.left < r.right && r.top < a.bottom && a.top < r.bottom;
    });
    return { loose: added.length, touching: touching.length };
  });
  expect(landed).toEqual({ loose: 1, touching: 0 });
  // The palette still has every block (a click takes a copy).
  expect(await paletteBlocks(page)).toHaveLength(27);
  // Once it has landed (it glows for a moment), undo takes it back.
  await expect(page.locator('.blocklySelected.kit_gravity')).toHaveCount(1);
  await expect(page.locator('.ambleAdded')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => codeBlocks(page)).toEqual([...before, 'ru_always', 'fl_wait'].sort());

  // A click on the words of a block adds it with its words open, to type your own over the example.
  const words = await page.evaluate(() => {
    type Block = { getField(name: string): { getSvgRoot(): SVGElement } };
    type Ws = { getFlyout(): { getWorkspace(): { getBlocksByType(t: string, o: boolean): Block[] } } };
    const block = (window as unknown as { __ambleWorkspace: Ws }).__ambleWorkspace.getFlyout().getWorkspace().getBlocksByType('ga_do', false)[0];
    const r = block.getField('ACTION').getSvgRoot().getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(words.x, words.y);
  const editor = page.locator('.blocklyWidgetDiv textarea');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue('spin around once');
  await page.keyboard.type('wiggle like jelly');
  await page.keyboard.press('Enter');
  const actions = () =>
    page.evaluate(() => {
      type Block = { getFieldValue(name: string): string };
      type Ws = { getBlocksByType(t: string, o: boolean): Block[]; getFlyout(): { getWorkspace(): Ws } };
      const ws = (window as unknown as { __ambleWorkspace: Ws }).__ambleWorkspace;
      const read = (w: Ws) => w.getBlocksByType('ga_do', false).map((b) => b.getFieldValue('ACTION'));
      return { code: read(ws), board: read(ws.getFlyout().getWorkspace()) };
    });
  // The board keeps its example.
  await expect.poll(actions).toEqual({ code: ['wiggle like jelly'], board: ['spin around once'] });
});

test('More blocks shows every block by category, Fewer blocks comes back, and the choice is kept', async ({ page }) => {
  await openEditor(page);
  const categories = page.locator('.blocklyToolboxCategory .blocklyToolboxCategoryLabel');
  const simple = await paletteBlocks(page);

  // The switch is under the palette, in view without scrolling, in both palettes.
  const more = page.getByRole('button', { name: 'More blocks' });
  await expect(more).toBeInViewport({ ratio: 1 });
  await more.click();
  await expect(categories).toHaveText(['Triggers', 'Characters', 'Motion', 'Game', 'Looks', 'Sound', 'Flow', 'Logic', 'Memory', 'Skills', 'Rules']);
  await expect(page.locator('.ambleBoardHeading')).toHaveCount(0);
  const all = await paletteBlocks(page);
  expect(all.length).toBeGreaterThan(simple.length * 3);
  expect(all).toContain('mv_turn');
  expect(all).not.toContain('br_freedom');
  expect(await page.evaluate(() => localStorage.getItem('amble:palette'))).toBe('all');
  const fewer = page.getByRole('button', { name: 'Fewer blocks' });
  await expect(fewer).toBeInViewport({ ratio: 1 });
  expect((await paletteLayout(page)).switchInView).toBe(true);
  // The stage's full palette has its brief, without the imagination block.
  await page.locator('.stage-selector').click();
  await expect(categories.first()).toHaveText('Brief');
  expect(await paletteBlocks(page)).toEqual(expect.arrayContaining(['br_game', 'br_audience', 'br_style', 'br_win', 'br_lose']));
  expect(await paletteBlocks(page)).not.toContain('br_freedom');

  // Kept in this browser.
  await page.reload();
  await expect(page.locator('.blocklyMainBackground')).toBeVisible();
  await expect(categories).toHaveCount(11);
  await expect(fewer).toBeInViewport({ ratio: 1 });

  // And back.
  await fewer.click();
  await expect(page.locator('.ambleBoardHeading')).toHaveCount(5);
  await expect(page.locator('.blocklyToolbox')).toBeHidden();
  expect(await paletteBlocks(page)).toEqual(simple);
  expect(await page.evaluate(() => localStorage.getItem('amble:palette'))).toBe('simple');
  expect(await paletteLayout(page)).toMatchObject({ cut: [], over: [], scrolls: false, switchInView: true });
});

test('a sentence makes a whole game, and "Change something" changes it', async ({ page }) => {
  const calls: Call[] = [];
  await page.addInitScript(() => localStorage.setItem('amble:settings', JSON.stringify({ apiKey: 'sk-test' })));
  await mockModel(page, calls);
  await page.goto('/');
  const start = page.getByRole('dialog', { name: 'Make a game' });
  await start.getByLabel('What do you want to make?').fill('a T-rex on roller skates dodges meteors at a disco');
  // "Go wild" is how it starts.
  await expect(start.getByRole('radio', { name: 'Go wild' })).toHaveAttribute('aria-checked', 'true');
  await start.getByRole('button', { name: 'Make my game' }).click();
  await expect(start).toHaveCount(0);

  // The game is made in one request (with its directing notes), then its art; then it plays.
  const frame = await gameFrame(page);
  await expect.poll(async () => (await flags(frame)).game, { timeout: 40_000 }).toBe(true);
  expect(await flags(frame)).toMatchObject({ state: 'running', rex: true });
  expect(calls.map((c) => c.name)).toEqual(['amble_pieces', 'svg_art']);
  expect(calls[0].system).toContain('# Directing a game');
  expect(calls[0].system).toContain('go wild');
  expect(calls[0].user).toContain('- game: [a T-rex on roller skates dodges meteors at a disco]');
  expect(calls[0].user).toMatch(/- p1: game \(the whole game; imagination: go wild\)/);

  // The idea is the program: two blocks on the stage, no sprites of the author's; the compiler's Rex joined.
  await expect(page.locator('.sprite-tile.compiled', { hasText: 'Rex' })).toBeVisible();
  await expect(page.locator('.sprite-tile:not(.compiled)')).toHaveCount(0);
  // It named the game, and says how to play.
  await expect(page.getByLabel('Project title')).toHaveValue('Meteor Disco Rex');
  await expect(page.locator('.how-to-play')).toHaveText('Arrow keys to skate. Dodge the meteors!');

  // Playing again needs no request.
  await page.getByTitle('Stop').click();
  await page.locator('.green-flag').click();
  await expect.poll(async () => (await flags(await gameFrame(page))).state).toBe('running');
  expect(calls).toHaveLength(2);

  // Change something, in words: it becomes a rule on the stage, and the game is built with it.
  await page.getByLabel('Change something in the game').fill('give Rex a jetpack');
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  await expect.poll(() => calls.length, { timeout: 30_000 }).toBe(3);
  // Only the wish is written; the game and its cast are there to see (with their code) and to change.
  expect(calls[2].system).not.toContain('# Directing a game');
  expect(calls[2].user).toContain('rule: [give Rex a jetpack] ⟨p1⟩');
  expect(calls[2].user).toContain('class Rex extends Sprite {');
  expect([...calls[2].user.matchAll(/^- (p\d+): (\w+)/gm)].map((m) => m[2])).toEqual(['rule']);
  await expect.poll(async () => (await flags(await gameFrame(page)).catch(() => ({ jetpack: false }))).jetpack, { timeout: 30_000 }).toBe(true);
  await page.locator('.stage-selector').click();
  await expect(page.locator('.blocklyMainBackground')).toBeVisible();
  const stageBlocks = await page.evaluate(() => {
    type B = { type: string };
    return (window as unknown as { __ambleWorkspace: { getTopBlocks(o: boolean): B[] } }).__ambleWorkspace.getTopBlocks(true).map((b) => b.type);
  });
  expect(stageBlocks).toEqual(['br_game', 'br_freedom', 'ga_rule']);
});
