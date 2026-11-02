import { expect, test, type Frame, type Page } from '@playwright/test';

/**
 * Building in the cloud: a hosted Amble (Vercel, api/amble.ts) has the OpenAI key on its server,
 * so a visitor with no key or sign-in presses the flag and the words build. Answered here by a
 * mock of the server's /api/config and /api/openai. Also: the Best / Efficient switch, and the
 * debug spend counter.
 */

/** Writes each piece the compile request asks for, with code that runs. */
function piecesReply(prompt: string) {
  const tasks = [...prompt.matchAll(/^- (p\d+): (\w+)/gm)].map((m) => ({ id: m[1], kind: m[2] }));
  const code: Record<string, string> = {
    action: 'window.__actions = (window.__actions ?? 0) + 1;',
    timed: 'yield* this.wait(Math.min(seconds, 0.1));',
    condition: 'return false;',
    value: 'return 1;',
    message: 'return "";',
    behavior: 'for (;;) {\n  window.__behaviors = (window.__behaviors ?? 0) + 1;\n  yield;\n}',
    rule: 'window.__rules = (window.__rules ?? 0) + 1;',
  };
  return { pieces: tasks.map((t) => ({ id: t.id, code: code[t.kind] ?? '' })), sprites: [], assets: [], warnings: [], questions: [] };
}

function sse(content: string, usage: object): string {
  const chunks = [
    { choices: [{ index: 0, delta: { content }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    { choices: [], usage },
  ];
  return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
}

interface Sent {
  url: string;
  model: string;
  reasoning: string;
  usage: boolean;
  auth: string | undefined;
}

/** The hosted server: it has a key, and runs the two models Amble builds with. */
async function mockHostedServer(page: Page, sent: Sent[]) {
  await page.route('**/api/config', (route) => route.fulfill({ json: { serverKey: true, codex: false, hosted: true, models: ['gpt-6.1-terra', 'gpt-6-luna'] } }));
  await page.route('**/api/openai/**', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    sent.push({ url: new URL(route.request().url()).pathname, model: body.model, reasoning: body.reasoning_effort, usage: Boolean(body.stream_options?.include_usage), auth: route.request().headers().authorization });
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      // 20k prompt tokens and 5k generated: $0.045 on GPT-6.1 Terra, $0.0045 on GPT-6 Luna.
      body: sse(JSON.stringify(piecesReply(body.messages[1].content)), { prompt_tokens: 20_000, completion_tokens: 5_000, completion_tokens_details: { reasoning_tokens: 3_000 } }),
    });
  });
  // Nothing may go to OpenAI directly: there's no key in this browser.
  await page.route('https://api.openai.com/**', (route) => route.abort());
}

async function gameFrame(page: Page): Promise<Frame> {
  const handle = await page.waitForSelector('iframe.player-frame');
  return (await handle.contentFrame())!;
}

const played = (frame: Frame) =>
  frame.evaluate(() => {
    const w = window as unknown as { __ambleGame?: { state: string }; __behaviors?: number; __rules?: number };
    return { state: w.__ambleGame?.state ?? '', behaviors: w.__behaviors ?? 0, rules: w.__rules ?? 0 };
  });

async function openExample(page: Page, title: string, sprite: string) {
  await page.getByRole('button', { name: /File/ }).click();
  await page.getByRole('menuitem', { name: title }).click();
  await page.getByRole('dialog', { name: 'Replace Project' }).getByRole('button', { name: 'Replace' }).click();
  await expect(page.locator('.sprite-tile', { hasText: sprite })).toBeVisible();
}

test('on a hosted Amble, demos play at once, and words build with no key or sign-in', async ({ page }) => {
  const sent: Sent[] = [];
  await mockHostedServer(page, sent);
  await page.goto('/');
  await expect(page.locator('.blocklyMainBackground')).toBeVisible();

  // Best is the mode to start with, and nothing has been spent yet.
  await expect(page.locator('.mode-switch').getByRole('radio', { name: 'Best' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.spend-total')).toHaveText('$0.00');

  // The demo ships built: the flag plays it at once, with no request at all.
  await openExample(page, 'Neon Drift', 'Asteroid');
  await page.locator('.green-flag').click();
  const shipped = await gameFrame(page);
  await expect.poll(async () => (await played(shipped)).state, { timeout: 20_000 }).toBe('running');
  await page.waitForTimeout(1500);
  expect(sent).toEqual([]);
  await expect(page.locator('.spend-total')).toHaveText('$0.00');

  // Building it again goes through the site's server.
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Build everything again' }).click();
  await expect.poll(() => sent.length, { timeout: 30_000 }).toBe(1);
  const frame = await gameFrame(page);
  await expect.poll(async () => (await played(frame).catch(() => ({ behaviors: 0 }))).behaviors, { timeout: 40_000 }).toBeGreaterThan(10);
  expect((await played(frame)).state).toBe('running');
  expect((await played(frame)).rules).toBeGreaterThan(0);

  // One request, through the site's server (no key from this browser), with GPT-6.1 Terra at high reasoning.
  expect(sent).toEqual([{ url: '/api/openai/chat/completions', model: 'gpt-6.1-terra', reasoning: 'high', usage: true, auth: undefined }]);
  await expect(page.locator('.problems-btn')).toHaveCount(0);

  // The spend counter adds it up: 20k × $1 + 5k × $5 per million.
  await expect(page.locator('.spend-total')).toHaveText('$0.045');
  await page.locator('.spend-chip').click();
  const panel = page.getByRole('dialog', { name: 'Spend' });
  await expect(panel).toContainText('gpt-6.1-terra');
  await expect(panel).toContainText('20.0k');
  await expect(panel).toContainText('(3.0k)');
  await page.keyboard.press('Escape');

  // Settings says the site builds for you.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toContainText('This site builds blocks written in your own words for you.');
});

test('Efficient builds with GPT-6 Luna at high reasoning, and the spend counter resets', async ({ page }) => {
  const sent: Sent[] = [];
  await mockHostedServer(page, sent);
  await page.goto('/');
  await expect(page.locator('.blocklyMainBackground')).toBeVisible();

  await page.locator('.mode-switch').getByRole('radio', { name: 'Efficient' }).click();
  await expect(page.locator('.mode-switch').getByRole('radio', { name: 'Efficient' })).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('amble:settings') ?? '{}'))).toMatchObject({ model: 'gpt-6-luna', reasoningEffort: 'high', assetModel: 'gpt-6-luna' });

  await openExample(page, 'Sky Whale', 'Whale');
  await page.locator('.green-flag').click();
  await expect.poll(async () => (await played(await gameFrame(page))).state, { timeout: 20_000 }).toBe('running');
  expect(sent).toEqual([]);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Build everything again' }).click();
  await expect.poll(() => sent.length, { timeout: 30_000 }).toBe(1);
  const frame = await gameFrame(page);
  await expect.poll(async () => (await played(frame).catch(() => ({ behaviors: 0 }))).behaviors, { timeout: 40_000 }).toBeGreaterThan(10);
  expect(sent.map((s) => [s.model, s.reasoning])).toEqual([['gpt-6-luna', 'high']]);
  await expect(page.locator('.spend-total')).toHaveText('$0.0045');

  // Picking a model by hand makes the mode custom.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.locator('summary', { hasText: 'Advanced' }).click();
  await settings.getByLabel(/^Model/).fill('gpt-6.1-sol');
  await expect(page.locator('.mode-custom')).toHaveText('Custom');
  await settings.getByRole('radio', { name: /^Best/ }).check();
  await expect(page.locator('.mode-switch').getByRole('radio', { name: 'Best' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');

  await page.locator('.spend-chip').click();
  await page.getByRole('dialog', { name: 'Spend' }).getByRole('button', { name: 'Reset' }).click();
  await expect(page.locator('.spend-total')).toHaveText('$0.00');
});
