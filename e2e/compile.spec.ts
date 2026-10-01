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

  await page.locator('.green-flag').click();
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

  await page.locator('.green-flag').click();
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

  // Three blocks are written in words (the art style too): the flag shows new words waiting.
  await expect(page.locator('.green-flag')).toHaveClass(/has-new/);
  // While they are built, their blocks show it (and settle when the build lands).
  await page.evaluate(() => {
    const w = window as unknown as { __sawAssembly: boolean };
    w.__sawAssembly = false;
    new MutationObserver(() => {
      if (document.querySelector('.amble-building .amble-assembly')) w.__sawAssembly = true;
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  // The flag builds the new words first, then plays.
  await page.locator('.green-flag').click();
  const frame = await gameFrame(page);
  await expect.poll(async () => (await game(frame)).twinkles, { timeout: 30_000 }).toBeGreaterThan(5);
  // One request for the words, one for the art of the character the compiler added.
  expect(calls).toEqual(['amble_pieces', 'svg_art']);
  await expect(page.locator('.green-flag')).not.toHaveClass(/has-new/);
  expect(await page.evaluate(() => (window as unknown as { __sawAssembly: boolean }).__sawAssembly)).toBe(true);
  await expect(page.locator('.amble-assembly')).toHaveCount(0);

  // Playing again, or after moving scripts around, compiles instantly.
  await page.getByTitle('Stop').click();
  await page.evaluate(() => {
    const ws = (window as unknown as { __ambleWorkspace: { getTopBlocks(o: boolean): Array<{ moveBy(x: number, y: number): void }> } }).__ambleWorkspace;
    ws.getTopBlocks(false)[0].moveBy(160, 40);
  });
  await page.locator('.green-flag').click();
  await expect.poll(async () => (await game(frame)).state).toBe('running');
  await page.waitForTimeout(500);
  expect(calls).toEqual(['amble_pieces', 'svg_art']);

  // Edit > Build everything again starts over: every block in words is built again, and the art made again.
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Build everything again' })).toHaveAttribute('title', /built again.*last built with gpt-5/);
  await page.getByRole('menuitem', { name: 'Build everything again' }).click();
  await expect.poll(() => calls.length, { timeout: 30_000 }).toBe(4);
  expect(calls).toEqual(['amble_pieces', 'svg_art', 'amble_pieces', 'svg_art']);
  // The new game plays (in a new player frame).
  await expect.poll(async () => (await game(await gameFrame(page)).catch(() => ({ state: '' }))).state, { timeout: 30_000 }).toBe('running');

  // The compiler's character shows up as a compiled sprite, with its art.
  await expect(page.locator('.sprite-tile.compiled', { hasText: 'Moon' })).toBeVisible();
  await page.locator('.sprite-tile.compiled', { hasText: 'Moon' }).click();
  await page.getByRole('tab', { name: /Costumes/ }).click();
  await expect(page.locator('.asset-tile.compiled', { hasText: 'moon' })).toBeVisible();
  await expect(page.locator('.compiled-preview img')).toHaveAttribute('alt', 'moon');
  // What the art was asked for stays behind the scenes.
  await expect(page.locator('.asset-panel')).not.toContainText('a smiling crescent moon');

  // Keep it: it becomes one of the author's sprites.
  await page.getByRole('tab', { name: /Code/ }).first().click();
  await page.getByRole('button', { name: /Keep as my sprite/ }).click();
  await expect(page.locator('.sprite-tile:not(.compiled)', { hasText: 'Moon' })).toBeVisible();
});

test('words build quietly a moment after typing, without starting the game', async ({ page }) => {
  const calls: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('amble:settings', JSON.stringify({ apiKey: 'sk-test', model: 'gpt-5', assetModel: 'gpt-5-mini' }));
  });
  await mockOpenAI(page, calls);
  await page.goto('/');
  await openExample(page, 'Star Catcher (2D)');
  await expect(page.locator('.green-flag')).toHaveClass(/has-new/);

  // Typing new words in a block (here, through Blockly, like a finished edit)...
  const edited = await page.evaluate(() => {
    type Field = { constructor: { name: string }; getValue(): string; setValue(v: string): void };
    type Block = { inputList: Array<{ fieldRow: Field[] }> };
    const ws = (window as unknown as { __ambleWorkspace: { getAllBlocks(o: boolean): Block[] } }).__ambleWorkspace;
    for (const b of ws.getAllBlocks(false))
      for (const input of b.inputList)
        for (const f of input.fieldRow)
          if (f.constructor.name === 'FieldAmbleText') {
            f.setValue(`${f.getValue()} and sparkle a little`);
            return true;
          }
    return false;
  });
  expect(edited).toBe(true);
  // ...builds them on their own a moment later: no flag press, and the game doesn't start.
  await expect.poll(() => calls.filter((c) => c === 'amble_pieces').length, { timeout: 20_000 }).toBe(1);
  await expect(page.locator('.green-flag')).not.toHaveClass(/has-new/, { timeout: 30_000 });
  await expect(page.locator('.build-chip')).toHaveCount(0);
  const frame = await gameFrame(page);
  expect((await game(frame)).state).not.toBe('running');

  // The flag then plays at once, with nothing left to build.
  const before = calls.length;
  await page.locator('.green-flag').click();
  await expect.poll(async () => (await game(await gameFrame(page))).state, { timeout: 30_000 }).toBe('running');
  expect(calls.length).toBe(before);
});

test('catching a star runs "when I touch Star", and every burst shows and clears', async ({ page }) => {
  const calls: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('amble:settings', JSON.stringify({ apiKey: 'sk-test', model: 'gpt-5', assetModel: 'gpt-5-mini' }));
  });
  await mockOpenAI(page, calls);
  await page.goto('/');
  await openExample(page, 'Star Catcher (2D)');
  await page.locator('.green-flag').click();
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

test('a speech bubble at the edge of the stage stays on it, without breaking its words', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.blocklyMainBackground')).toBeVisible();
  await page.locator('.green-flag').click();
  const frame = await gameFrame(page);
  // After Amble's greeting (it says hello for 3 seconds), so this bubble stays up.
  await expect.poll(async () => (await game(frame)).time, { timeout: 30_000 }).toBeGreaterThan(3.5);

  type Talker = { __ambleGame: { find(n: string): { x: number; say(s: string): void } } };
  await frame.evaluate(() => {
    const amble = (window as unknown as Talker).__ambleGame.find('Amble');
    amble.x = 225;
    amble.say('Thanks, Dad.');
  });
  await frame.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  // In stage pixels (the stage's UI layer is 480 wide, scaled to the player).
  const box = await frame.evaluate(() => {
    const stage = document.querySelector('.amble-ui')!.getBoundingClientRect();
    const b = document.querySelector('.amble-ui__bubble')!.getBoundingClientRect();
    const k = 480 / stage.width;
    return { left: (b.left - stage.left) * k, right: (b.right - stage.left) * k, width: b.width * k, height: b.height * k };
  });
  expect(box.width).toBeGreaterThan(0);
  expect(box.left).toBeGreaterThanOrEqual(0);
  expect(box.right).toBeLessThanOrEqual(480);
  // One line: its words are not broken up to fit beside the edge.
  expect(box.height).toBeLessThan(40);
});

test('without an account the flag still plays; words wait', async ({ page }) => {
  const calls: string[] = [];
  await mockOpenAI(page, calls);
  await page.goto('/');
  await openExample(page, 'Star Catcher (2D)');
  await page.locator('.green-flag').click();
  const frame = await gameFrame(page);
  await expect.poll(async () => (await game(frame)).time, { timeout: 30_000 }).toBeGreaterThan(0.3);
  // No red message: the words' blocks say they wait for an account.
  await expect(page.locator('.code-note[data-kind="waiting"]').first()).toContainText(/This builds once you (sign in|add a key in Settings)\./);
  expect((await game(frame)).twinkles).toBe(0);
  expect(calls).toEqual([]);
  await page.locator('.problems-btn').click();
  await expect(page.getByRole('dialog', { name: 'Problems' })).toContainText("3 blocks in your own words aren't built yet");
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

  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Continue in your browser to finish signing in')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the sign-in page' })).toHaveAttribute('href', /auth\.openai\.com/);
  codex.finishSignIn();
  await expect(page.locator('.menu-btn.account')).toContainText('Signed in');
  // The account says so in plain words; the model is named only under Advanced.
  await expect(page.locator('.account-card')).toContainText("You're signed in");
  await expect(page.locator('.account-card')).not.toContainText('GPT');
  await page.locator('.settings summary', { hasText: 'Advanced' }).click();
  await expect(page.locator('.advanced-fields')).toContainText('GPT-6 Astra Light');
  await page.keyboard.press('Escape');

  await openExample(page, 'Star Catcher (2D)');
  await page.locator('.green-flag').click();
  const frame = await gameFrame(page);
  await expect.poll(async () => (await game(frame)).twinkles, { timeout: 30_000 }).toBeGreaterThan(5);
  expect(requests).toEqual([
    { model: 'gpt-6-astra', reasoningEffort: 'low', kind: 'pieces' },
    { model: 'gpt-6-astra', reasoningEffort: 'low', kind: 'svg' },
  ]);
  expect(direct).toEqual([]);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Build everything again' })).toHaveAttribute('title', /last built with GPT-6 Astra Light/);
  await page.keyboard.press('Escape');

  // Signing out offers to sign in again (an API key goes under Advanced).
  await page.locator('.menu-btn.account').click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.locator('.menu-btn.sign-in')).toHaveText('Sign in');
});

test('3D world mode renders and runs', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('radio', { name: '3D' }).click();
  await page.getByRole('dialog', { name: 'Switch to 3D' }).getByRole('button', { name: 'Switch' }).click();
  await expect(page.getByRole('radio', { name: '3D' })).toBeChecked();
  const frame = await gameFrame(page);
  // The player reports loading and idle; start it with the green flag.
  await page.locator('.green-flag').click();
  await expect
    .poll(async () => frame.evaluate(() => (window as unknown as { __ambleGame?: { state: string; mode: string } }).__ambleGame?.mode ?? ''))
    .toBe('3d');
  await expect.poll(async () => frame.evaluate(() => (window as unknown as { __ambleGame?: { state: string } }).__ambleGame?.state ?? '')).toBe('running');
});
