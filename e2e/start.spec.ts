import { expect, test, type Frame, type Page } from '@playwright/test';

/**
 * The start screen, the simple palette, and a game made from an idea: say what you want in a
 * sentence and Amble makes the whole game (answered here by a mock of the OpenAI API), then
 * change it by saying so.
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

test('the palette starts simple: five groups, and More blocks shows them all', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Escape');
  await expect(page.locator('.blocklyMainBackground')).toBeVisible();
  const groups = page.locator('.blocklyToolboxCategory .blocklyTreeLabel, .blocklyToolboxCategoryLabel');
  await expect(groups).toHaveText(['Idea', 'When', 'Do', 'Check', 'Memory']);
  const simple = await paletteBlocks(page);
  expect(simple.length).toBeLessThanOrEqual(32);
  expect(simple).toEqual(expect.arrayContaining(['ga_rule', 'ru_always', 'ev_start', 'ga_do', 'kit_walk', 'cd_words']));
  expect(simple).not.toContain('mv_turn');

  // More blocks: every category, and the choice is kept.
  await page.evaluate(() => (window as unknown as { __ambleStore: { getState(): { setPalette(m: string): void } } }).__ambleStore.getState().setPalette('all'));
  await expect(groups).toHaveCount(11);
  const all = await paletteBlocks(page);
  expect(all.length).toBeGreaterThan(simple.length * 2);
  expect(all).toContain('mv_turn');
  expect(await page.evaluate(() => localStorage.getItem('amble:palette'))).toBe('all');
  await page.reload();
  await expect(page.locator('.blocklyMainBackground')).toBeVisible();
  await expect(groups).toHaveCount(11);
});

test('a sentence makes a whole game, and "Change something" changes it', async ({ page }) => {
  const calls: Call[] = [];
  await page.addInitScript(() => localStorage.setItem('amble:settings', JSON.stringify({ apiKey: 'sk-test' })));
  await mockModel(page, calls);
  await page.goto('/');
  const start = page.getByRole('dialog', { name: 'Make a game' });
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
  expect(stageBlocks).toEqual(['br_game', 'ga_rule']);
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
    return (window as unknown as { __ambleWorkspace: { getTopBlocks(o: boolean): B[] } }).__ambleWorkspace.getTopBlocks(true).map((b) => `${b.type}${b.getFieldValue('STYLE') ? `: ${b.getFieldValue('STYLE')}` : ''}`);
  });

const PIXEL = 'pixel art: chunky pixels and a small palette, like a 16-bit console game';
const NEON = 'neon glow on dark: bright glowing outlines, synthwave colors';

test('the dial and the style knob say how the game is made, on the home screen and in the top bar', async ({ page }) => {
  const calls: Call[] = [];
  const games = () => calls.filter((c) => c.name === 'amble_pieces');
  await page.addInitScript(() => localStorage.setItem('amble:settings', JSON.stringify({ apiKey: 'sk-test' })));
  await mockModel(page, calls);
  await page.goto('/');
  const start = page.getByRole('dialog', { name: 'Make a game' });
  await start.getByLabel('What do you want to make?').fill('a T-rex on roller skates dodges meteors at a disco');

  // The dial: five stops, each explained as you point at it. The arrow keys move it; a click sets it.
  const dial = start.getByRole('radiogroup', { name: /^Dial/ });
  await expect(dial.getByRole('radio')).toHaveCount(5);
  await expect(start.locator('.start-hint')).toContainText('Wild. Your whole idea, plus surprises');
  await dial.getByRole('radio', { name: 'Small' }).hover();
  await expect(start.locator('.start-hint')).toContainText('Small. A small, simple game');
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

  // The top bar shows the same two controls, for the open project.
  const bar = page.locator('.menubar');
  await expect(bar.getByRole('radio', { name: 'Grand' })).toHaveAttribute('aria-checked', 'true');
  await expect(bar.getByRole('button', { name: 'Art style: Pixel art' })).toBeVisible();
  await expect(bar.locator('.dial-name')).toHaveText('Grand');
  // Pointing at a stop explains it.
  await bar.getByRole('radio', { name: 'Small' }).hover();
  await expect(bar.getByRole('tooltip')).toContainText('Small');
  await expect(bar.getByRole('tooltip')).toContainText('only what your idea needs');
  await page.getByTitle('Stop').click();

  // Moving the dial: the game needs building (the flag says so), and moving it back keeps the game that's there.
  const flag = page.locator('.green-flag');
  await expect(flag).not.toHaveClass(/has-new/);
  await bar.getByRole('radio', { name: 'Small' }).click();
  await expect(bar.locator('.dial-name')).toHaveText('Small');
  await expect(flag).toHaveClass(/has-new/);
  expect((await projectControls(page)).dial).toBe(1);
  await bar.getByRole('radio', { name: 'Small' }).focus();
  await page.keyboard.press('End');
  await expect(flag).not.toHaveClass(/has-new/);
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await expect(bar.getByRole('radio', { name: 'Small' })).toHaveAttribute('aria-checked', 'true');
  expect(games()).toHaveLength(1);
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

test('the logo opens the home screen: make a game, play a demo, open a saved game or start empty', async ({ page }) => {
  await page.goto('/');
  const start = page.getByRole('dialog', { name: 'Make a game' });
  const replace = page.getByRole('dialog', { name: 'Replace Project' });
  // The first visit starts there, with nothing to lose: starting empty asks nothing.
  await expect(start).toBeVisible();
  await start.getByRole('button', { name: 'Start with an empty project' }).click();
  await expect(start).toHaveCount(0);
  await expect(replace).toHaveCount(0);
  await expect(page.locator('.sprite-tile', { hasText: 'Amble' })).toBeVisible();
  await expect(page.locator('.blocklyMainBackground')).toBeVisible();
  // An empty project is on "My blocks", with no style: the two controls in the top bar say so.
  const bar = page.locator('.menubar');
  await expect(bar.getByRole('radio', { name: 'My blocks' })).toHaveAttribute('aria-checked', 'true');
  await expect(bar.getByRole('button', { name: 'Art style: none' })).toBeVisible();

  // The logo is the way home: the idea box with the dial and the style knob, the demos, and the two ways to start without an idea.
  await page.getByRole('button', { name: 'Amble: home' }).click();
  await expect(start).toBeVisible();
  await expect(start.getByLabel('What do you want to make?')).toBeFocused();
  await expect(start.getByRole('radiogroup', { name: /^Dial/ }).getByRole('radio', { name: 'Wild' })).toHaveAttribute('aria-checked', 'true');
  await expect(start.getByRole('button', { name: 'Art style: none' })).toBeVisible();
  await expect(start.getByRole('button', { name: 'Make my game' })).toBeDisabled();
  await expect(start.getByRole('button', { name: /^Demo: / })).toHaveCount(13);
  await expect(start.getByRole('button', { name: 'Start with an empty project' })).toBeVisible();

  // Open a saved game: what File > Load from your computer does. There is a project now, so it asks first.
  const saved = await page.evaluate(() => JSON.stringify({ ...(window as unknown as StoreWindow).__ambleStore.getState().project, title: 'My saved game', dial: 2 }));
  const pick = async () => {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), start.getByRole('button', { name: 'Open a saved game' }).click()]);
    await chooser.setFiles({ name: 'saved.amble', mimeType: 'application/json', buffer: Buffer.from(saved) });
  };
  await pick();
  await expect(replace).toBeVisible();
  await replace.getByRole('button', { name: 'Cancel' }).click();
  await expect(start).toBeVisible();
  await expect(page.getByLabel('Project title')).toHaveValue('Untitled game');
  await pick();
  await replace.getByRole('button', { name: 'Replace' }).click();
  await expect(start).toHaveCount(0);
  await expect(page.getByLabel('Project title')).toHaveValue('My saved game');
  // The saved game's dial came with it.
  await expect(bar.getByRole('radio', { name: 'Full' })).toHaveAttribute('aria-checked', 'true');

  // A file that isn't a game says so, and the home screen stays.
  await page.getByRole('button', { name: 'Amble: home' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), start.getByRole('button', { name: 'Open a saved game' }).click()]);
  await chooser.setFiles({ name: 'notes.amble', mimeType: 'application/json', buffer: Buffer.from('{"hello": 1}') });
  await expect(page.locator('.toast')).toContainText('not an Amble project');
  await expect(start).toBeVisible();
  // Escape closes it, and the game is still there.
  await page.keyboard.press('Escape');
  await expect(start).toHaveCount(0);
  await expect(page.getByLabel('Project title')).toHaveValue('My saved game');
});

test('the dial and the style knob fit the top bar of a 1280-wide window', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  // The fullest the bar gets: Settings, the sign-in button (Codex is on this computer) and the debug counter.
  await page.route('**/api/codex/status', (route) => route.fulfill({ json: { installed: true, version: '1.0.0', auth: 'none', login: { pending: false, url: null, error: null } } }));
  await page.goto('/');
  await expect(page.getByRole('dialog', { name: 'Make a game' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Make a game' })).toHaveCount(0);
  await expect(page.locator('.blocklyMainBackground')).toBeVisible();
  const bar = page.locator('.menubar');
  await expect(bar.getByRole('button', { name: 'Sign in' })).toBeVisible();
  // The longest stop name, a long style in the author's own words, and a long title.
  await page.getByLabel('Project title').fill('Meteor Disco Rex and the Very Long Name');
  await bar.getByRole('button', { name: 'Art style: none' }).click();
  await page.getByRole('menuitemradio', { name: 'Custom…' }).click();
  await page.getByLabel('Your own art style').fill('like a comic book from the fifties, with big dots and thick ink');
  await page.keyboard.press('Enter');
  await expect(bar.locator('.dial-name')).toHaveText('My blocks');
  await expect(bar.locator('.dial-name')).toBeVisible();
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
  // Every stop keeps the bar as it is (the name's place is as wide as the longest).
  const left = (await bar.locator('.dial').boundingBox())!.x;
  for (const name of ['Small', 'Full', 'Wild', 'Grand']) {
    await bar.getByRole('radio', { name }).click();
    await expect(bar.locator('.dial-name')).toHaveText(name);
    expect((await bar.locator('.dial').boundingBox())!.x).toBe(left);
    expect(await fit()).toEqual({ overflows: false, overlaps: false, inside: true });
  }
  // Narrower windows (down to the 1024 the editor needs) still fit: the two controls give up their names.
  await page.setViewportSize({ width: 1024, height: 720 });
  await expect(bar.locator('.dial-name')).toBeHidden();
  await expect(bar.getByRole('radio', { name: 'Grand' })).toHaveAttribute('aria-checked', 'true');
  expect(await fit()).toEqual({ overflows: false, overlaps: false, inside: true });
});
