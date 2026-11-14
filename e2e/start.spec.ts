import { expect, test, type Frame, type Page } from '@playwright/test';

/**
 * Home (a page of its own, where a first visit starts), the simple palette (one board with every
 * block in view), and a game made from an idea: say what you want in a sentence and Amble makes
 * the whole game (answered here by a mock of the OpenAI API), then change it by saying so.
 */

// A first visit: nothing in this browser yet (the other tests start in the editor, with every block).
test.use({ storageState: { cookies: [], origins: [] } });

/** Home: the page with "What do you want to make?", the demos, a saved game and an empty project. */
const homePage = (page: Page) => page.getByRole('region', { name: 'Home' });

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

test('a first visit starts on Home, a page of its own, once', async ({ page }) => {
  await page.goto('/');
  const home = homePage(page);
  await expect(home).toBeVisible();
  // A page, not a dialog over the editor: the editor is out of sight and out of reach, with its blocks as they are.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.menubar')).toBeHidden();
  await expect(page.locator('.blocklyMainBackground')).toBeHidden();
  await expect(page.locator('.app')).toHaveAttribute('inert');
  await expect(async () => expect(await codeBlocks(page)).not.toHaveLength(0)).toPass();
  // Its own top bar: the logo and the way back.
  await expect(home.getByRole('heading', { level: 1 })).toHaveText('amble');
  await expect(home.getByRole('button', { name: 'Back to editor' })).toBeVisible();

  // What to make: an empty box. No idea is put in it and none is on offer.
  const idea = home.getByLabel('What do you want to make?');
  await expect(idea).toBeFocused();
  await expect(idea).toHaveValue('');
  await expect(idea).not.toHaveAttribute('placeholder');
  await expect(home.getByRole('button', { name: /idea/i })).toHaveCount(0);
  // Nothing to make yet.
  await expect(home.getByRole('button', { name: 'Make my game' })).toBeDisabled();
  await idea.fill('a game of my own');
  await expect(home.getByRole('button', { name: 'Make my game' })).toBeEnabled();
  // Every demo is there, the ones made from one sentence first: a picture, a title and one line each.
  await expect(home.getByRole('button', { name: /^Demo: / })).toHaveCount(13);
  await expect(home.getByRole('button', { name: 'Demo: Meteor Disco Rex' })).toContainText('a T-rex on roller skates dodges meteors at a disco');
  await expect.poll(() => home.getByRole('button', { name: 'Demo: Meteor Disco Rex' }).locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(home.getByRole('button', { name: 'Open a saved game' })).toBeVisible();
  await expect(home.getByRole('button', { name: 'Empty project' })).toBeVisible();

  // It doesn't come back by itself; File > New game opens it again.
  await home.getByRole('button', { name: 'Back to editor' }).click();
  await expect(home).toHaveCount(0);
  await expect(page.locator('.blocklyMainBackground')).toBeVisible();
  await page.reload();
  await expect(page.locator('.blocklyMainBackground')).toBeVisible();
  await expect(home).toHaveCount(0);
  await page.getByRole('button', { name: /File/ }).click();
  await page.getByRole('menuitem', { name: 'New game' }).click();
  await expect(home).toBeVisible();
  await expect(page.locator('.menubar')).toBeHidden();
});

test('Home fits a desktop, a laptop and a phone: the page scrolls down, never sideways', async ({ page }) => {
  await page.goto('/');
  const home = homePage(page);
  await expect(home).toBeVisible();
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    const fit = () =>
      home.evaluate((el) => ({
        // Neither the window nor the page in it is wider than the screen; the page is longer, and scrolls.
        window: document.documentElement.scrollWidth,
        sideways: el.scrollWidth - el.clientWidth,
        scrolls: el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY === 'auto',
        // The bar, the box, every card and every control are inside the screen.
        cut: [...el.querySelectorAll('.home-bar > *, .home-make, .home-make textarea, .dial, .style-knob, .home-make-button, .home-demo, .home-foot > *')].filter((c) => {
          const r = c.getBoundingClientRect();
          return r.width === 0 || r.left < 0 || r.right > window.innerWidth + 0.5;
        }).length,
      }));
    await expect.poll(fit, { message: `${width}x${height}` }).toEqual({ window: width, sideways: 0, scrolls: true, cut: 0 });
    // The demos are a grid of cards (two across on a phone, more on a wider screen), each with a large picture.
    const cards = await home.locator('.home-demo').evaluateAll((els) => els.map((c) => ({ top: Math.round(c.getBoundingClientRect().top), picture: c.querySelector('.home-thumb')!.getBoundingClientRect().width })));
    const across = cards.filter((c) => c.top === cards[0].top).length;
    expect(across).toBe(width < 600 ? 2 : 4);
    expect(Math.min(...cards.map((c) => c.picture))).toBeGreaterThanOrEqual(width < 600 ? 160 : 240);
    // The end of the page is reached by scrolling down; the top bar stays.
    await home.getByRole('button', { name: 'Empty project' }).scrollIntoViewIfNeeded();
    await expect(home.getByRole('button', { name: 'Empty project' })).toBeInViewport({ ratio: 1 });
    await expect(home.getByRole('button', { name: 'Back to editor' })).toBeInViewport({ ratio: 1 });
    await home.evaluate((el) => el.scrollTo(0, 0));
  }
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

/** A first visit, past Home: the editor as it opens, in a 1280 x 720 window. */
async function openEditor(page: Page) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  const start = homePage(page);
  await expect(start).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(start).toHaveCount(0);
  await expect(page.locator('.blocklyMainBackground')).toBeVisible();
}

test('the palette starts as one board: every block in view at once, under plain headings', async ({ page }) => {
  await openEditor(page);
  // A card for each thing the author wants to do, and no column of categories.
  await expect(page.locator('.ambleBoardHeading > text:not(.ambleBoardNote)')).toHaveText(['Say what happens', 'When…', 'Check', 'Do', 'Remember']);
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
  const start = homePage(page);
  await start.getByLabel('What do you want to make?').fill('a T-rex on roller skates dodges meteors at a disco');
  // The dial starts on "Wild" (go wild).
  await expect(start.getByRole('radio', { name: 'Wild' })).toHaveAttribute('aria-checked', 'true');
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
  // The size: block sits under the game: line; the wish joins below it.
  expect(stageBlocks).toEqual(['br_game', 'br_dial', 'ga_rule']);
});

type StoreWindow = { __ambleStore: { getState(): { project: { dial?: number; title: string; stage: { blocks: { blocks: { blocks: Array<{ type: string; fields?: Record<string, string> }> } } | null } }; select(id: string): void } } };

/** The project's dial, and the stage's blocks as saved in the project (type and words). */
const projectControls = (page: Page) =>
  page.evaluate(() => {
    const p = (window as unknown as StoreWindow).__ambleStore.getState().project;
    return { dial: p.dial, stage: (p.stage.blocks?.blocks.blocks ?? []).map((b) => `${b.type}${b.fields?.STYLE ? `: ${b.fields.STYLE}` : ''}`) };
  });

/** The stage's blocks as the editor shows them. */
const blocksOnScreen = (page: Page) =>
  page.evaluate(() => {
    type B = { type: string; getFieldValue(name: string): string | null };
    return (window as unknown as { __ambleWorkspace: { getTopBlocks(o: boolean): B[] } }).__ambleWorkspace
      .getTopBlocks(true)
      .filter((b) => b.type !== 'br_dial')
      .map((b) => `${b.type}${b.getFieldValue('STYLE') ? `: ${b.getFieldValue('STYLE')}` : ''}`);
  });

const PIXEL = 'pixel art: chunky pixels and a small palette, like a 16-bit console game';
const NEON = 'neon glow on dark: bright glowing outlines, synthwave colors';

test('the dial and the style knob say how the game is made, on the home screen and in the top bar', async ({ page }) => {
  const calls: Call[] = [];
  const games = () => calls.filter((c) => c.name === 'amble_pieces');
  await page.addInitScript(() => localStorage.setItem('amble:settings', JSON.stringify({ apiKey: 'sk-test' })));
  await mockModel(page, calls);
  await page.goto('/');
  const start = homePage(page);
  await start.getByLabel('What do you want to make?').fill('a T-rex on roller skates dodges meteors at a disco');

  // The dial: five stops, each explained as you point at it. The arrow keys move it; a click sets it.
  const dial = start.getByRole('radiogroup', { name: /^Dial/ });
  await expect(dial.getByRole('radio')).toHaveCount(5);
  await expect(dial.getByRole('radio', { name: 'Wild' })).toHaveAttribute('aria-checked', 'true');
  await dial.getByRole('radio', { name: 'Small' }).hover();
  await dial.getByRole('radio', { name: 'Wild' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(dial.getByRole('radio', { name: 'Full' })).toBeFocused();
  await expect(dial.getByRole('radio', { name: 'Full' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('End');
  await expect(dial.getByRole('radio', { name: 'Grand' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Home');
  await expect(dial.getByRole('radio', { name: 'My blocks' })).toHaveAttribute('aria-checked', 'true');
  await dial.getByRole('radio', { name: 'Grand' }).click();
  await expect(dial.getByRole('radio', { name: 'Grand' })).toHaveAttribute('aria-checked', 'true');

  // The style knob: the presets, your own words, or none. Escape closes its list, not the home screen.
  await start.getByRole('button', { name: 'Art style: none' }).click();
  const styles = page.getByRole('menu', { name: 'Art style' });
  await expect(styles.getByRole('menuitemradio')).toHaveText(['Cartoon', 'Pixel art', 'Paper cutout', 'Neon', 'Storybook', 'Doodle', 'Clay', 'Minimal', 'Custom…', 'None']);
  await page.keyboard.press('Escape');
  await expect(styles).toHaveCount(0);
  await expect(start).toBeVisible();
  await start.getByRole('button', { name: 'Art style: none' }).click();
  await styles.getByRole('menuitemradio', { name: 'Pixel art' }).click();
  await expect(start.getByRole('button', { name: 'Art style: Pixel art' })).toBeFocused();
  await start.getByRole('button', { name: 'Make my game' }).click();
  await expect(start).toHaveCount(0);

  // Both reach the compile request: the grand game's notes, and the style in the brief.
  const frame = await gameFrame(page);
  await expect.poll(async () => (await flags(frame)).game, { timeout: 40_000 }).toBe(true);
  expect(games()).toHaveLength(1);
  expect(games()[0].system).toContain('# Directing a game');
  expect(games()[0].system).toContain('## How much to invent: grand');
  expect(games()[0].system).toContain('four to six minutes');
  expect(games()[0].system).not.toContain('## How much to invent: go wild');
  expect(games()[0].user).toMatch(/- p1: game \(the whole game; imagination: grand\)/);
  expect(games()[0].user).toContain(`- art style: [${PIXEL}]`);
  // The project holds them: the dial itself (no imagination: block) and an art style: block on the stage.
  expect(await projectControls(page)).toEqual({ dial: 4, stage: ['br_game', `br_style: ${PIXEL}`] });

  // The open project shows both: the dial on the stage's size: block (not in the top bar), the style knob in the bar.
  const bar = page.locator('.menubar');
  await expect(bar.locator('.dial')).toHaveCount(0);
  await expect(bar.getByRole('button', { name: 'Art style: Pixel art' })).toBeVisible();
  await page.getByTitle('Stop').click();
  await page.locator('.stage-selector').click();
  const size = page.locator('.blocklyBlockCanvas .ambleDial');
  await expect(size.getByRole('radio')).toHaveCount(5);
  await expect(size.getByRole('radio', { name: 'Grand' })).toHaveAttribute('aria-checked', 'true');
  // It is always in the stage's code and never one of its blocks: it can't be deleted, and nothing of it is saved.
  expect(
    await page.evaluate(() => {
      type B = { type: string; isDeletable(): boolean };
      const ws = (window as unknown as { __ambleWorkspace: { getBlocksByType(t: string, o: boolean): B[] } }).__ambleWorkspace;
      return ws.getBlocksByType('br_dial', false).map((b) => b.isDeletable());
    }),
  ).toEqual([false]);
  expect((await projectControls(page)).stage).toEqual(['br_game', `br_style: ${PIXEL}`]);

  // Moving the dial: the game needs building (the flag says so), and moving it back keeps the game that's there.
  const flag = page.locator('.green-flag');
  await expect(flag).not.toHaveClass(/has-new/);
  await size.getByRole('radio', { name: 'Small' }).click();
  await expect(size.getByRole('radio', { name: 'Small' })).toHaveAttribute('aria-checked', 'true');
  await expect(flag).toHaveClass(/has-new/);
  expect((await projectControls(page)).dial).toBe(1);
  await size.getByRole('radio', { name: 'Grand' }).click();
  await expect(flag).not.toHaveClass(/has-new/);
  await size.getByRole('radio', { name: 'Small' }).click();
  await expect(size.getByRole('radio', { name: 'Small' })).toHaveAttribute('aria-checked', 'true');
  expect((await projectControls(page)).stage).toEqual(['br_game', `br_style: ${PIXEL}`]);
  expect(games()).toHaveLength(1);
  // A sprite's code has no size: block; back on the stage it shows where the dial stands.
  await page.locator('.sprite-tile.compiled', { hasText: 'Rex' }).click();
  await expect(size).toHaveCount(0);
  await page.locator('.stage-selector').click();
  await expect(size.getByRole('radio', { name: 'Small' })).toHaveAttribute('aria-checked', 'true');
  // The flag builds the small game.
  await flag.click();
  await expect.poll(() => games().length, { timeout: 30_000 }).toBe(2);
  expect(games()[1].system).toContain('## How much to invent: small');
  expect(games()[1].user).toMatch(/- p1: game \(the whole game; imagination: small\)/);
  await expect.poll(async () => (await flags(await gameFrame(page)).catch(() => ({ state: '' }))).state, { timeout: 30_000 }).toBe('running');
  await page.getByTitle('Stop').click();

  // The style knob writes the stage's art style: block. With the stage in the editor, the block on screen changes.
  await page.locator('.stage-selector').click();
  await expect.poll(() => blocksOnScreen(page)).toEqual(['br_game', `br_style: ${PIXEL}`]);
  await bar.getByRole('button', { name: 'Art style: Pixel art' }).click();
  await expect(styles.getByRole('menuitemradio', { name: 'Pixel art' })).toHaveAttribute('aria-checked', 'true');
  await styles.getByRole('menuitemradio', { name: 'Custom…' }).click();
  await page.getByLabel('Your own art style').fill('like a comic book, with BIG dots');
  await page.keyboard.press('Enter');
  await expect(bar.getByRole('button', { name: 'Art style: like a comic book, with BIG dots' })).toBeVisible();
  expect(await blocksOnScreen(page)).toEqual(['br_game', 'br_style: like a comic book, with BIG dots']);
  expect((await projectControls(page)).stage).toEqual(['br_game', 'br_style: like a comic book, with BIG dots']);
  await expect(flag).toHaveClass(/has-new/);
  // None takes the block away; a preset puts one back.
  await bar.getByRole('button', { name: /^Art style: like a comic book/ }).click();
  await expect(page.getByLabel('Your own art style')).toHaveValue('like a comic book, with BIG dots');
  await styles.getByRole('menuitemradio', { name: 'None' }).click();
  await expect(bar.getByRole('button', { name: 'Art style: none' })).toBeVisible();
  expect(await blocksOnScreen(page)).toEqual(['br_game']);
  expect((await projectControls(page)).stage).toEqual(['br_game']);
  await bar.getByRole('button', { name: 'Art style: none' }).click();
  await styles.getByRole('menuitemradio', { name: 'Neon' }).click();
  expect(await blocksOnScreen(page)).toEqual(['br_game', `br_style: ${NEON}`]);
  expect((await projectControls(page)).stage).toEqual(['br_game', `br_style: ${NEON}`]);

  // With a sprite in the editor instead, the stage's blocks change all the same, and show when the stage is opened.
  await page.locator('.sprite-tile.compiled', { hasText: 'Rex' }).click();
  await bar.getByRole('button', { name: 'Art style: Neon' }).click();
  await styles.getByRole('menuitemradio', { name: 'Pixel art' }).click();
  expect((await projectControls(page)).stage).toEqual(['br_game', `br_style: ${PIXEL}`]);
  await bar.getByRole('button', { name: 'Art style: Pixel art' }).click();
  await styles.getByRole('menuitemradio', { name: 'None' }).click();
  expect((await projectControls(page)).stage).toEqual(['br_game']);
  await bar.getByRole('button', { name: 'Art style: none' }).click();
  await styles.getByRole('menuitemradio', { name: 'Clay' }).click();
  await expect(bar.getByRole('button', { name: 'Art style: Clay' })).toBeVisible();
  await page.locator('.stage-selector').click();
  await expect.poll(() => blocksOnScreen(page)).toEqual(['br_game', 'br_style: claymation: chunky rounded shapes with soft shading and shiny highlights']);
  // Nothing was built meanwhile: the knob says what the next build makes, and the flag builds it.
  expect(games()).toHaveLength(2);
  await flag.click();
  await expect.poll(() => games().length, { timeout: 30_000 }).toBe(3);
  expect(games()[2].user).toContain('- art style: [claymation: chunky rounded shapes with soft shading and shiny highlights]');
});

/** The block editor as it stands: its workspace (another one would mean the editor was started again), where its scripts are, the game on the stage, and the build. */
const editorState = (page: Page) =>
  page.evaluate(() => {
    type Ws = { id: string; scrollX: number; scrollY: number };
    const w = window as unknown as { __ambleWorkspace: Ws; __ambleStore: { getState(): { run: { state: string }; compile: { status: string } } } };
    const s = w.__ambleStore.getState();
    return { workspace: w.__ambleWorkspace.id, at: `${Math.round(w.__ambleWorkspace.scrollX)},${Math.round(w.__ambleWorkspace.scrollY)}`, run: s.run.state, build: s.compile.status };
  });

test('the logo opens Home, and the editor is as it was on the way back', async ({ page }) => {
  await page.goto('/');
  const home = homePage(page);
  const replace = page.getByRole('dialog', { name: 'Replace Project' });
  // The first visit starts there, with nothing to lose: starting empty asks nothing.
  await expect(home).toBeVisible();
  await home.getByRole('button', { name: 'Empty project' }).click();
  await expect(home).toHaveCount(0);
  await expect(replace).toHaveCount(0);
  await expect(page.locator('.sprite-tile', { hasText: 'Amble' })).toBeVisible();
  await expect(page.locator('.blocklyMainBackground')).toBeVisible();
  // An empty project is on "My blocks", with no style: the stage's size: block and the knob in the top bar say so.
  const bar = page.locator('.menubar');
  await page.locator('.stage-selector').click();
  await expect(page.locator('.blocklyBlockCanvas .ambleDial').getByRole('radio', { name: 'My blocks' })).toHaveAttribute('aria-checked', 'true');
  await expect(bar.getByRole('button', { name: 'Art style: none' })).toBeVisible();

  // Something to find again: a name, a block added to the code, the scripts moved aside, and the game playing on the stage.
  await page.getByLabel('Project title').fill('Kept as it was');
  const before = await codeBlocks(page);
  await page.evaluate(() => {
    type Block = { initSvg(): void; render(): void; moveBy(x: number, y: number): void };
    type Ws = { newBlock(type: string): Block; scroll(x: number, y: number): void };
    const ws = (window as unknown as { __ambleWorkspace: Ws }).__ambleWorkspace;
    const block = ws.newBlock('fl_wait');
    block.initSvg();
    block.render();
    block.moveBy(420, 520);
    ws.scroll(-37, -53);
  });
  const blocks = [...before, 'fl_wait'].sort();
  await expect.poll(() => codeBlocks(page)).toEqual(blocks);
  await page.locator('.green-flag').click();
  await expect.poll(async () => (await editorState(page)).run, { timeout: 30_000 }).toBe('running');
  const { workspace, at } = await editorState(page);

  // The logo is the way home: a page with its own address, in place of the editor. The game stops.
  await page.getByRole('button', { name: 'Amble: home' }).click();
  await expect(home).toBeVisible();
  await expect(page).toHaveURL(/#home$/);
  await expect(page.locator('.menubar')).toBeHidden();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(async () => (await editorState(page)).run).toBe('stopped');
  // The idea box with the dial and the style knob, the demos, and the two ways to start without an idea.
  await expect(home.getByLabel('What do you want to make?')).toBeFocused();
  await expect(home.getByLabel('What do you want to make?')).toHaveValue('');
  await expect(home.getByRole('radiogroup', { name: /^Dial/ }).getByRole('radio', { name: 'Wild' })).toHaveAttribute('aria-checked', 'true');
  await expect(home.getByRole('button', { name: 'Art style: none' })).toBeVisible();
  await expect(home.getByRole('button', { name: 'Make my game' })).toBeDisabled();
  await expect(home.getByRole('button', { name: /^Demo: / })).toHaveCount(13);
  await expect(home.getByRole('button', { name: 'Empty project' })).toBeVisible();

  // Three plain ways back, choosing nothing: the button in the top bar, Escape, and the browser's Back button.
  // Each time the editor is the one that was left: the same workspace with the same blocks, the same project.
  const backInEditor = async () => {
    await expect(home).toHaveCount(0);
    await expect(page).not.toHaveURL(/#home$/);
    await expect(page.locator('.blocklyMainBackground')).toBeVisible();
    await expect(page.getByLabel('Project title')).toHaveValue('Kept as it was');
    expect(await editorState(page)).toMatchObject({ workspace, at });
    expect(await codeBlocks(page)).toEqual(blocks);
  };
  await home.getByRole('button', { name: 'Back to editor' }).click();
  await backInEditor();
  await page.getByRole('button', { name: 'Amble: home' }).click();
  await expect(home).toBeVisible();
  await page.keyboard.press('Escape');
  await backInEditor();
  await page.getByRole('button', { name: 'Amble: home' }).click();
  await expect(home).toBeVisible();
  await page.goBack();
  await backInEditor();
  // Forward is Home again, and a page loaded at Home's address starts there.
  await page.goForward();
  await expect(home).toBeVisible();
  await expect(page).toHaveURL(/#home$/);
  await page.reload();
  await expect(home).toBeVisible();
  await expect(page.locator('.menubar')).toBeHidden();
  await home.getByRole('button', { name: 'Back to editor' }).click();
  await expect(home).toHaveCount(0);
  await expect(page).not.toHaveURL(/#home$/);
  await expect(page.getByLabel('Project title')).toHaveValue('Kept as it was');
});

test('Home opens a demo, a saved game or an empty project, and asks before replacing a game', async ({ page }) => {
  await page.goto('/');
  const home = homePage(page);
  const replace = page.getByRole('dialog', { name: 'Replace Project' });
  const logo = page.getByRole('button', { name: 'Amble: home' });
  // A first visit has nothing to lose: a demo opens at once, in the editor.
  await expect(home).toBeVisible();
  await home.getByRole('button', { name: 'Demo: Star Catcher' }).click();
  await expect(home).toHaveCount(0);
  await expect(replace).toHaveCount(0);
  await expect(page.getByLabel('Project title')).toHaveValue('Star Catcher');
  await expect(page.locator('.sprite-tile', { hasText: 'Star' })).toBeVisible();
  await expect(page.locator('.blocklyMainBackground')).toBeVisible();
  await expect(page).not.toHaveURL(/#home$/);

  // From the editor there is a game to keep: an empty project asks first. Cancel (or Escape) keeps the game, and Home.
  await logo.click();
  await expect(home).toBeVisible();
  await home.getByRole('button', { name: 'Empty project' }).click();
  await expect(replace).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(replace).toHaveCount(0);
  await expect(home).toBeVisible();
  await home.getByRole('button', { name: 'Empty project' }).click();
  await replace.getByRole('button', { name: 'Replace' }).click();
  await expect(home).toHaveCount(0);
  await expect(page.getByLabel('Project title')).toHaveValue('Untitled game');
  await expect(page.locator('.sprite-tile', { hasText: 'Amble' })).toBeVisible();
  // An empty project is on "My blocks", with no style: the stage's size: block and the knob in the top bar say so.
  const bar = page.locator('.menubar');
  await page.locator('.stage-selector').click();
  await expect(page.locator('.blocklyBlockCanvas .ambleDial').getByRole('radio', { name: 'My blocks' })).toHaveAttribute('aria-checked', 'true');
  await expect(bar.getByRole('button', { name: 'Art style: none' })).toBeVisible();

  // Open a saved game: what File > Load from your computer does. It asks first too.
  await logo.click();
  const saved = await page.evaluate(() => JSON.stringify({ ...(window as unknown as StoreWindow).__ambleStore.getState().project, title: 'My saved game', dial: 2 }));
  const pick = async () => {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), home.getByRole('button', { name: 'Open a saved game' }).click()]);
    await chooser.setFiles({ name: 'saved.amble', mimeType: 'application/json', buffer: Buffer.from(saved) });
  };
  await pick();
  await expect(replace).toBeVisible();
  await replace.getByRole('button', { name: 'Cancel' }).click();
  await expect(home).toBeVisible();
  await pick();
  await replace.getByRole('button', { name: 'Replace' }).click();
  await expect(home).toHaveCount(0);
  await expect(page.getByLabel('Project title')).toHaveValue('My saved game');
  // The saved game's dial came with it.
  expect((await projectControls(page)).dial).toBe(2);
  await page.locator('.stage-selector').click();
  await expect(page.locator('.blocklyBlockCanvas .ambleDial').getByRole('radio', { name: 'Full' })).toHaveAttribute('aria-checked', 'true');

  // A file that isn't a game says so, and Home stays.
  await logo.click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), home.getByRole('button', { name: 'Open a saved game' }).click()]);
  await chooser.setFiles({ name: 'notes.amble', mimeType: 'application/json', buffer: Buffer.from('{"hello": 1}') });
  await expect(page.locator('.toast')).toContainText('not an Amble project');
  await expect(home).toBeVisible();
  // Escape goes back, and the game is still there.
  await page.keyboard.press('Escape');
  await expect(home).toHaveCount(0);
  await expect(page.getByLabel('Project title')).toHaveValue('My saved game');
});

test('a game being made carries on under Home, and waits there for the flag', async ({ page }) => {
  const calls: Call[] = [];
  await page.addInitScript(() => localStorage.setItem('amble:settings', JSON.stringify({ apiKey: 'sk-test' })));
  await mockModel(page, calls);
  // The model takes its time: its answers wait until they are let go.
  let letGo = () => {};
  const waiting = new Promise<void>((resolve) => (letGo = resolve));
  await page.route('https://api.openai.com/v1/**', async (route) => {
    await waiting;
    await route.fallback();
  });
  await page.goto('/');
  const home = homePage(page);
  await home.getByLabel('What do you want to make?').fill('a T-rex on roller skates dodges meteors at a disco');
  await home.getByRole('button', { name: 'Make my game' }).click();
  await expect(home).toHaveCount(0);
  await expect(page.locator('.making-game')).toBeVisible();

  // A look at Home meanwhile: the game is still made (nothing is asked for twice), but it doesn't play out of sight.
  await page.getByRole('button', { name: 'Amble: home' }).click();
  await expect(home).toBeVisible();
  expect((await editorState(page)).build).toBe('running');
  letGo();
  await expect.poll(async () => (await editorState(page)).build, { timeout: 40_000 }).toBe('done');
  await expect.poll(async () => (await editorState(page)).run, { timeout: 30_000 }).toBe('stopped');
  expect(calls.map((c) => c.name)).toEqual(['amble_pieces', 'svg_art']);

  // Back in the editor the game is there, and the flag plays it.
  await home.getByRole('button', { name: 'Back to editor' }).click();
  await expect(home).toHaveCount(0);
  await expect(page.locator('.sprite-tile.compiled', { hasText: 'Rex' })).toBeVisible();
  await expect(page.getByLabel('Project title')).toHaveValue('Meteor Disco Rex');
  await page.locator('.green-flag').click();
  await expect.poll(async () => (await flags(await gameFrame(page))).state, { timeout: 30_000 }).toBe('running');
  expect(await flags(await gameFrame(page))).toMatchObject({ game: true, rex: true });
  expect(calls).toHaveLength(2);
});

test('the style knob fits the top bar of a 1280-wide window, and the dial is in the code', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  // The fullest the bar gets: Settings, the sign-in button (Codex is on this computer) and the debug counter.
  await page.route('**/api/codex/status', (route) => route.fulfill({ json: { installed: true, version: '1.0.0', auth: 'none', login: { pending: false, url: null, error: null } } }));
  await page.goto('/');
  await expect(homePage(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(homePage(page)).toHaveCount(0);
  await expect(page.locator('.blocklyMainBackground')).toBeVisible();
  const bar = page.locator('.menubar');
  await expect(bar.getByRole('button', { name: 'Sign in' })).toBeVisible();
  // The longest stop name, a long style in the author's own words, and a long title.
  await page.getByLabel('Project title').fill('Meteor Disco Rex and the Very Long Name');
  await bar.getByRole('button', { name: 'Art style: none' }).click();
  await page.getByRole('menuitemradio', { name: 'Custom…' }).click();
  await page.getByLabel('Your own art style').fill('like a comic book from the fifties, with big dots and thick ink');
  await page.keyboard.press('Enter');
  await expect(bar.locator('.dial')).toHaveCount(0);
  await expect(bar.locator('.style-knob-name')).toBeVisible();

  const fit = () =>
    bar.evaluate((el) => {
      const boxes = [...el.querySelectorAll('.menubar-main > *, .menubar-build > *, .menubar-account > *')].map((child) => child.getBoundingClientRect());
      return {
        overflows: el.scrollWidth > el.clientWidth || document.documentElement.scrollWidth > window.innerWidth,
        overlaps: boxes.some((box, i) => i > 0 && box.left < boxes[i - 1].right - 0.5),
        inside: boxes.every((box) => box.left >= 0 && box.right <= window.innerWidth + 0.5),
      };
    });
  expect(await fit()).toEqual({ overflows: false, overlaps: false, inside: true });
  // Narrower windows (down to the 1024 the editor needs) still fit: the knob gives up its name.
  await page.setViewportSize({ width: 1024, height: 720 });
  expect(await fit()).toEqual({ overflows: false, overlaps: false, inside: true });
  // The dial is on the stage's size: block, in view in the code area.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator('.stage-selector').click();
  const size = page.locator('.blocklyBlockCanvas .ambleDial');
  await expect(size.getByRole('radio', { name: 'My blocks' })).toHaveAttribute('aria-checked', 'true');
  for (const name of ['Small', 'Full', 'Wild', 'Grand']) {
    await size.getByRole('radio', { name }).click();
    await expect(size.getByRole('radio', { name })).toHaveAttribute('aria-checked', 'true');
  }
  const box = (await size.boundingBox())!;
  const area = (await page.locator('.blockly-host').boundingBox())!;
  expect(box.x).toBeGreaterThan(area.x);
  expect(box.x + box.width).toBeLessThan(area.x + area.width);
  expect(box.y).toBeGreaterThan(area.y);
  expect(box.y + box.height).toBeLessThan(area.y + area.height);
});
