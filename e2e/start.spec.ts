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
