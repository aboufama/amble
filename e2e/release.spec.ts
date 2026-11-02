import { expect, test, type Frame, type Page, type Route } from '@playwright/test';

/**
 * Release checks: things that broke quietly before. A copy that copies itself can't freeze the page,
 * an exported game plays when another site shows it in an iframe, the flag never plays blocks older
 * than the ones on screen, and compiled art that was deleted is made again.
 */

function sse(content: string): string {
  return [
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
    'data: [DONE]\n\n',
  ].join('');
}

const moonSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60"><circle cx="30" cy="30" r="26" fill="#fff3b0"/></svg>';

/** Writes every piece, adds a Moon with a costume, and can take its time. */
async function mockOpenAI(page: Page, calls: string[], delayMs = 0) {
  await page.route('https://api.openai.com/v1/**', async (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const name: string = body.response_format?.json_schema?.name ?? 'unknown';
    calls.push(name);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const prompt: string = body.messages?.[1]?.content ?? '';
    const tasks = [...prompt.matchAll(/^- (p\d+): (\w+)/gm)].map((m) => ({ id: m[1], kind: m[2] }));
    const reply =
      name === 'amble_pieces'
        ? {
            pieces: tasks.map((t) => ({ id: t.id, code: t.kind === 'behavior' ? 'for (;;) { yield; }' : '' })),
            sprites: [{ name: 'Moon', description: 'A sleepy moon', x: 170, y: 130, size: 100, direction: 0, visible: true, code: 'class Moon extends Sprite {}' }],
            assets: [{ target: 'Moon', kind: 'costume', name: 'moon', description: 'a smiling crescent moon', width: 60, height: 60, reuse: false }],
            warnings: [],
            questions: [],
          }
        : name === 'svg_art'
          ? { svg: moonSvg }
          : {};
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: sse(JSON.stringify(reply)) });
  });
}

const withKey = (page: Page) => page.addInitScript(() => localStorage.setItem('amble:settings', JSON.stringify({ apiKey: 'sk-test' })));

async function gameFrame(page: Page): Promise<Frame> {
  const handle = await page.waitForSelector('iframe.player-frame');
  return (await handle.contentFrame())!;
}

async function openExample(page: Page, title: string, sprite: string) {
  await page.getByRole('button', { name: /File/ }).click();
  await page.getByRole('menuitem', { name: title }).click();
  await page.getByRole('dialog', { name: 'Replace Project' }).getByRole('button', { name: 'Replace' }).click();
  await expect(page.locator('.sprite-tile', { hasText: sprite })).toBeVisible();
}

test('a copy that makes a copy of itself stops at 300 copies, and the page keeps going', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.blocklyMainBackground')).toBeVisible();
  await page.evaluate(async () => {
    const d = await import('/src/project/defaults.ts' as string);
    const p = d.newProject();
    p.sprites[0].blocks = d.workspace(
      [d.block('ev_start'), d.block('cp_make', { WHO: 'me' })],
      [d.block('ev_created'), d.block('co_forever', {}, [d.block('cp_make', { WHO: 'me' }), d.block('mv_move', { STEPS: 1 })])],
    );
    (window as unknown as { __ambleStore: { getState(): { setProject(p: unknown): void } } }).__ambleStore.getState().setProject(p);
  });
  await page.locator('.green-flag').click();
  const frame = await gameFrame(page);
  await expect.poll(() => frame.evaluate(() => (window as unknown as { __ambleGame?: { time: number } }).__ambleGame?.time ?? 0), { timeout: 20_000 }).toBeGreaterThan(2);
  const count = await frame.evaluate(() => (window as unknown as { __ambleGame: { sprites: Array<{ isClone: boolean }> } }).__ambleGame.sprites.filter((s) => s.isClone).length);
  expect(count).toBe(300);
  // The editor still answers right away.
  const t0 = Date.now();
  await page.evaluate(() => document.title);
  expect(Date.now() - t0).toBeLessThan(1000);
});

test('an exported game plays inside another page, with no network access', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.blocklyMainBackground')).toBeVisible();
  const html = await page.evaluate(async () => {
    const { buildGameHtml } = await import('/src/project/exportHtml.ts' as string);
    const { compileProject } = await import('/src/compiler/compile.ts' as string);
    const { starCatcher } = await import('/src/project/examples.ts' as string);
    const { DEFAULT_SETTINGS } = await import('/src/compiler/openai.ts' as string);
    const p = starCatcher();
    p.compiled = await compileProject(p, { settings: DEFAULT_SETTINGS, offline: true });
    return buildGameHtml(p);
  });
  expect(html).toMatch(/Content-Security-Policy" content="default-src 'none'; script-src 'sha256-[A-Za-z0-9+/=]+'/);
  expect(html).toContain("connect-src data: blob:");

  // As itch.io or a blog would show it: in an iframe.
  const host = await page.context().newPage();
  await host.setContent('<!doctype html><body style="margin:0"><iframe id="g" style="width:640px;height:480px;border:0"></iframe></body>');
  await host.evaluate((src) => ((document.getElementById('g') as HTMLIFrameElement).srcdoc = src), html);
  const frame = host.frameLocator('#g');
  await frame.getByRole('button', { name: '▶ Play' }).click();
  const inner = host.frames().find((f) => f !== host.mainFrame())!;
  await expect.poll(() => inner.evaluate(() => (window as unknown as { __ambleGame?: { state: string } }).__ambleGame?.state ?? ''), { timeout: 20_000 }).toBe('running');
  // Its engine script ran under the CSP (the hash matched), and fetches are blocked by it.
  const blocked = await inner.evaluate(() =>
    fetch('https://example.com/').then(
      () => false,
      () => true,
    ),
  );
  expect(blocked).toBe(true);
});

test('the flag plays the blocks on screen, even when they changed during a build', async ({ page }) => {
  const calls: string[] = [];
  await withKey(page);
  await mockOpenAI(page, calls, 2500);
  await page.goto('/');
  await openExample(page, 'Star Catcher', 'Star');
  // Amble's script is on screen; its words start building quietly.
  await page.locator('.sprite-tile', { hasText: 'Amble' }).click();
  await page.evaluate(async () => {
    const actions = await import('/src/actions.ts' as string);
    actions.buildQuietly();
  });
  await expect(page.locator('.green-flag')).toHaveClass(/has-new|building/, { timeout: 5_000 }).catch(() => undefined);
  // Mid-build: walk faster (typed into the block), then press the flag right away.
  await page.evaluate(() => {
    type B = { type: string; getInputTargetBlock(n: string): { setFieldValue(v: string, f: string): void } };
    const ws = (window as unknown as { __ambleWorkspace: { getAllBlocks(o: boolean): B[] } }).__ambleWorkspace;
    ws.getAllBlocks(false).find((b) => b.type === 'kit_walk')!.getInputTargetBlock('SPEED').setFieldValue('999', 'NUM');
  });
  await page.locator('.green-flag').click();
  const frame = await gameFrame(page);
  await expect.poll(() => frame.evaluate(() => (window as unknown as { __ambleGame?: { state: string } }).__ambleGame?.state ?? ''), { timeout: 30_000 }).toBe('running');
  const built = await page.evaluate(async () => {
    const { needsCompile } = await import('/src/actions.ts' as string);
    const s = (window as unknown as { __ambleStore: { getState(): { project: { compiled: { code: Array<{ targetName: string; source: string }> } } } } }).__ambleStore.getState();
    return { stale: needsCompile(s.project as never), amble: s.project.compiled.code.find((c) => c.targetName === 'Amble')!.source };
  });
  expect(built.stale).toBe(false);
  expect(built.amble).toContain('999');
  expect(calls.filter((c) => c === 'amble_pieces')).toHaveLength(1);
});

test('deleted compiled art is made again by the next build', async ({ page }) => {
  const calls: string[] = [];
  await withKey(page);
  await mockOpenAI(page, calls);
  await page.goto('/');
  await openExample(page, 'Star Catcher', 'Star');
  await page.locator('.green-flag').click();
  await expect(page.locator('.sprite-tile.compiled', { hasText: 'Moon' })).toBeVisible({ timeout: 30_000 });
  expect(calls).toEqual(['amble_pieces', 'svg_art']);

  await page.evaluate(async () => {
    const actions = await import('/src/actions.ts' as string);
    const s = (window as unknown as { __ambleStore: { getState(): { project: { compiled: { assets: Array<{ id: string; name: string }> } } } } }).__ambleStore.getState();
    actions.deleteCompiledAsset(s.project.compiled.assets.find((a) => a.name === 'moon')!.id);
  });
  await page.locator('.sprite-tile.compiled', { hasText: 'Moon' }).click();
  await page.getByRole('tab', { name: /Costumes/ }).click();
  await expect(page.locator('.asset-tile.compiled', { hasText: 'moon' })).toHaveCount(0);

  await page.getByTitle('Stop').click();
  await page.locator('.green-flag').click();
  await expect.poll(() => calls.length, { timeout: 30_000 }).toBe(3);
  expect(calls[2]).toBe('svg_art');
  await expect(page.locator('.asset-tile.compiled', { hasText: 'moon' })).toBeVisible();
});
