import { expect, test, type Frame, type Page, type Route } from '@playwright/test';

/**
 * End-to-end compiling. Exact blocks compile instantly when the green flag is clicked, with no
 * request. Blocks in the author's own words are compiled once, in one request (answered here by
 * a mock of the OpenAI API or of the Codex bridge), and reused after that.
 */

const moonSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60"><path d="M40 6a26 26 0 1 0 14 40A22 22 0 0 1 40 6z" fill="#fff3b0" stroke="#c9a400" stroke-width="3"/></svg>';

/** Writes each piece the compile request asks for (listed under "## Write these pieces"). */
function piecesReply(prompt: string) {
  const tasks = [...prompt.matchAll(/^- (p\d+): (\w+)/gm)].map((m) => ({ id: m[1], kind: m[2] }));
  const code: Record<string, string> = {
    action: 'window.__actions = (window.__actions ?? 0) + 1;\nthis.game.effects.burst({ x: this.x, y: this.y, color: "#ffd84d", count: 12 });',
    behavior: 'for (;;) {\n  this.turn(4);\n  window.__twinkles = (window.__twinkles ?? 0) + 1;\n  yield;\n}',
  };
  return {
    pieces: tasks.map((t) => ({ id: t.id, code: code[t.kind] ?? '' })),
    sprites: [{ name: 'Moon', description: 'A sleepy moon in the corner', x: 170, y: 130, z: 0, size: 100, direction: 0, visible: true, code: 'class Moon extends Sprite {\n  start() {\n    this.setPosition(170, 130);\n  }\n}' }],
    assets: [{ target: 'Moon', kind: 'costume', name: 'moon', description: 'a smiling crescent moon', width: 60, height: 60, reuse: false }],
    warnings: [],
  };
}

function sse(content: string): string {
  const chunks: string[] = [];
  for (let i = 0; i < content.length; i += 400) {
    chunks.push(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: content.slice(i, i + 400) }, finish_reason: null }] })}\n\n`);
  }
  chunks.push(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
  chunks.push('data: [DONE]\n\n');
  return chunks.join('');
}

async function mockOpenAI(page: Page, calls: string[]) {
  await page.route('https://api.openai.com/v1/**', async (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const name: string = body.response_format?.json_schema?.name ?? 'unknown';
    calls.push(name);
    const reply = name === 'amble_pieces' ? piecesReply(body.messages[1].content) : name === 'svg_art' ? { svg: moonSvg } : { parts: [] };
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' },
      body: sse(JSON.stringify(reply)),
    });
  });
}

/** Stands in for the dev server's Codex bridge (server/codexBridge.ts): sign-in state and structured replies. */
async function mockCodex(page: Page, requests: Array<{ model: string; reasoningEffort: string; kind: string }>) {
  const state = { auth: 'none' as 'none' | 'chatgpt', pending: false };
  const status = () => ({
    installed: true,
    version: '0.157.1',
    auth: state.auth,
    login: { pending: state.pending, url: state.pending ? 'https://auth.openai.com/oauth/authorize?test' : null, error: null },
  });
  await page.route('**/api/codex/status', (route) => route.fulfill({ json: status() }));
  await page.route('**/api/codex/login', (route) => {
    state.pending = true;
    return route.fulfill({ json: status() });
  });
  await page.route('**/api/codex/run', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const props = Object.keys(body.schema?.properties ?? {});
    const kind = props.includes('pieces') ? 'pieces' : props.includes('svg') ? 'svg' : 'other';
    requests.push({ model: body.model, reasoningEffort: body.reasoningEffort, kind });
    const reply = kind === 'pieces' ? piecesReply(body.user) : kind === 'svg' ? { svg: moonSvg } : { parts: [] };
    const lines = [{ type: 'progress', phase: 'thinking' }, { type: 'result', text: JSON.stringify(reply) }];
    await route.fulfill({ status: 200, headers: { 'content-type': 'application/x-ndjson' }, body: lines.map((l) => JSON.stringify(l)).join('\n') + '\n' });
  });
  return {
    /** What Codex's `login` does once you finish in the browser. */
    finishSignIn() {
      state.auth = 'chatgpt';
      state.pending = false;
    },
  };
}

async function gameFrame(page: Page): Promise<Frame> {
  const handle = await page.waitForSelector('iframe.player-frame');
  return (await handle.contentFrame())!;
}

const game = (frame: Frame) =>
  frame.evaluate(() => {
    const g = (window as unknown as { __ambleGame?: { state: string; time: number; findAll(name: string): unknown[] } }).__ambleGame;
    return { state: g?.state ?? '', time: g?.time ?? 0, twinkles: (window as unknown as { __twinkles?: number }).__twinkles ?? 0 };
  });

async function openExample(page: Page, title: string) {
  await page.getByRole('button', { name: /File/ }).click();
  await page.getByRole('menuitem', { name: title }).click();
  await page.getByRole('dialog', { name: 'Replace Project' }).getByRole('button', { name: 'Replace' }).click();
  await expect(page.locator('.sprite-tile', { hasText: 'Star' })).toBeVisible();
}

test('exact blocks compile instantly with the green flag, without any request', async ({ page }) => {
  const calls: string[] = [];
  await mockOpenAI(page, calls);
  await page.goto('/');
  await expect(page.locator('.blocklyMainBackground')).toBeVisible();

  await page.getByTitle('Start (green flag)').click();
  const frame = await gameFrame(page);
  await expect.poll(async () => (await game(frame)).time, { timeout: 30_000 }).toBeGreaterThan(0.3);
  // Amble falls with gravity and walks with the arrow keys.
  await page.keyboard.down('ArrowRight');
  await expect
    .poll(() => frame.evaluate(() => (window as unknown as { __ambleGame: { find(n: string): { x: number } } }).__ambleGame.find('Amble').x), { timeout: 10_000 })
    .toBeGreaterThan(40);
  await page.keyboard.up('ArrowRight');
  expect(calls).toEqual([]);
  await expect(page.locator('.problems-btn')).toHaveCount(0);
});

test('the Edit menu shows the JavaScript the blocks compiled to', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.blocklyMainBackground')).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Show compiled code' })).toBeDisabled();
  await page.keyboard.press('Escape');

  await page.getByTitle('Start (green flag)').click();
  const frame = await gameFrame(page);
  await expect.poll(async () => (await game(frame)).state, { timeout: 30_000 }).toBe('running');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Show compiled code' }).click();
  const code = page.getByRole('dialog', { name: 'Compiled Code' }).locator('.code-view');
  await expect(code).toContainText('extends Sprite');
  await expect(code).toContainText('walkWith(');
});

test('words are compiled once, in one request, and reused after', async ({ page }) => {
  const calls: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('amble:settings', JSON.stringify({ apiKey: 'sk-test', model: 'gpt-5', assetModel: 'gpt-5-mini' }));
  });
  await mockOpenAI(page, calls);
  await page.goto('/');
  await openExample(page, 'Star Catcher (2D)');

  // Two blocks are written in words: Compile is marked.
  await expect(page.locator('.compile-btn')).toHaveClass(/dirty/);
  await page.getByRole('button', { name: 'Compile' }).click();
  const frame = await gameFrame(page);
  await expect.poll(async () => (await game(frame)).twinkles, { timeout: 30_000 }).toBeGreaterThan(5);
  // One request for the words, one for the art of the character the compiler added.
  expect(calls).toEqual(['amble_pieces', 'svg_art']);
  await expect(page.locator('.compile-btn')).not.toHaveClass(/dirty/);

  // Playing again, or after moving scripts around, compiles instantly.
  await page.getByTitle('Stop').click();
  await page.evaluate(() => {
    const ws = (window as unknown as { __ambleWorkspace: { getTopBlocks(o: boolean): Array<{ moveBy(x: number, y: number): void }> } }).__ambleWorkspace;
    ws.getTopBlocks(false)[0].moveBy(160, 40);
  });
  await page.getByTitle('Start (green flag)').click();
  await expect.poll(async () => (await game(frame)).state).toBe('running');
  await page.waitForTimeout(500);
  expect(calls).toEqual(['amble_pieces', 'svg_art']);

  // The compiled code is there to read.
  await page.getByRole('button', { name: 'Compile' }).hover();
  await expect(page.getByRole('button', { name: 'Compile' })).toHaveAttribute('title', /last compiled with gpt-5/);

  // The compiler's character shows up as a compiled sprite, with its art.
  await expect(page.locator('.sprite-tile.compiled', { hasText: 'Moon' })).toBeVisible();
  await page.locator('.sprite-tile.compiled', { hasText: 'Moon' }).click();
  await page.getByRole('tab', { name: /Costumes/ }).click();
  await expect(page.locator('.asset-tile.compiled', { hasText: 'moon' })).toBeVisible();
  await expect(page.locator('.compiled-preview')).toContainText('a smiling crescent moon');

  // Keep it: it becomes one of the author's sprites.
  await page.getByRole('tab', { name: /Code/ }).first().click();
  await page.getByRole('button', { name: /Keep as my sprite/ }).click();
  await expect(page.locator('.sprite-tile:not(.compiled)', { hasText: 'Moon' })).toBeVisible();
});

test('catching a star runs "when I touch Star", and every burst shows and clears', async ({ page }) => {
  const calls: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('amble:settings', JSON.stringify({ apiKey: 'sk-test', model: 'gpt-5', assetModel: 'gpt-5-mini' }));
  });
  await mockOpenAI(page, calls);
  await page.goto('/');
  await openExample(page, 'Star Catcher (2D)');
  await page.getByRole('button', { name: 'Compile' }).click();
  const frame = await gameFrame(page);
  await expect.poll(async () => (await game(frame)).state, { timeout: 30_000 }).toBe('running');

  type Star = { x: number; y: number; isClone: boolean; visible: boolean };
  type Player = { __actions?: number; __ambleGame: { vars: Record<string, number>; find(n: string): Star; findAll(n: string): Star[]; scene: { particleSystems: unknown[] } } };
  // Amble stands under the lowest star. Each star deletes itself the moment it touches Amble.
  await expect
    .poll(
      () =>
        frame.evaluate(() => {
          const g = (window as unknown as Player).__ambleGame;
          const lowest = g.findAll('Star').filter((s) => s.isClone && s.visible).sort((a, b) => a.y - b.y)[0];
          if (lowest) g.find('Amble').x = lowest.x;
          return g.vars.score;
        }),
      { timeout: 30_000, intervals: [50] },
    )
    .toBeGreaterThanOrEqual(3);
  // Amble's "when I touch Star" still ran for each catch, and each burst showed and cleared.
  expect(await frame.evaluate(() => (window as unknown as Player).__actions ?? 0)).toBeGreaterThanOrEqual(3);
  await expect.poll(() => frame.evaluate(() => (window as unknown as Player).__ambleGame.scene.particleSystems.length)).toBe(0);
});

test('without an account the flag still plays; words wait', async ({ page }) => {
  const calls: string[] = [];
  await mockOpenAI(page, calls);
  await page.goto('/');
  await openExample(page, 'Star Catcher (2D)');
  await page.getByTitle('Start (green flag)').click();
  const frame = await gameFrame(page);
  await expect.poll(async () => (await game(frame)).time, { timeout: 30_000 }).toBeGreaterThan(0.3);
  await expect(page.getByText('Blocks in your own words need a ChatGPT sign-in or an API key')).toBeVisible();
  expect((await game(frame)).twinkles).toBe(0);
  expect(calls).toEqual([]);
  await page.locator('.problems-btn').click();
  await expect(page.getByRole('dialog', { name: 'Problems' })).toContainText("2 blocks in your own words aren't compiled yet");
});

test('signs in with ChatGPT and compiles with GPT-6 Astra Light through Codex', async ({ page }) => {
  const requests: Array<{ model: string; reasoningEffort: string; kind: string }> = [];
  const codex = await mockCodex(page, requests);
  const direct: string[] = [];
  await page.route('https://api.openai.com/**', (route) => {
    direct.push(route.request().url());
    return route.abort();
  });
  await page.goto('/');

  await page.getByRole('button', { name: 'Sign in with ChatGPT' }).click();
  await expect(page.getByText('Finish signing in to ChatGPT in your browser')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the sign-in page' })).toHaveAttribute('href', /auth\.openai\.com/);
  codex.finishSignIn();
  await expect(page.locator('.menu-btn.account')).toContainText('Signed in');
  await expect(page.locator('.account-card')).toContainText('GPT-6 Astra Light');
  await page.keyboard.press('Escape');

  await openExample(page, 'Star Catcher (2D)');
  await page.getByRole('button', { name: 'Compile' }).click();
  const frame = await gameFrame(page);
  await expect.poll(async () => (await game(frame)).twinkles, { timeout: 30_000 }).toBeGreaterThan(5);
  expect(requests).toEqual([
    { model: 'gpt-6-astra', reasoningEffort: 'low', kind: 'pieces' },
    { model: 'gpt-6-astra', reasoningEffort: 'low', kind: 'svg' },
  ]);
  expect(direct).toEqual([]);
  await expect(page.getByRole('button', { name: 'Compile' })).toHaveAttribute('title', /last compiled with GPT-6 Astra Light/);

  // Signing out goes back to the API key settings.
  await page.locator('.menu-btn.account').click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'OpenAI API key' })).toBeVisible();
  await expect(page.locator('.menu-btn.sign-in')).toHaveText('Sign in with ChatGPT');
});

test('3D world mode renders and runs', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('radio', { name: '3D' }).click();
  await page.getByRole('dialog', { name: 'Switch to 3D' }).getByRole('button', { name: 'Switch' }).click();
  await expect(page.locator('.mode-badge')).toHaveText('3D');
  const frame = await gameFrame(page);
  // The player reports loading and idle; start it with the green flag.
  await page.getByTitle('Start (green flag)').click();
  await expect
    .poll(async () => frame.evaluate(() => (window as unknown as { __ambleGame?: { state: string; mode: string } }).__ambleGame?.mode ?? ''))
    .toBe('3d');
  await expect.poll(async () => frame.evaluate(() => (window as unknown as { __ambleGame?: { state: string } }).__ambleGame?.state ?? '')).toBe('running');
});
