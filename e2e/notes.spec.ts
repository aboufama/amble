import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Notes pinned to the code: a question about words the compiler had to guess at (answering it
 * joins the words and builds them again), a block that doesn't work where it is, a problem from the
 * last run (with Fix it), words that didn't build (Try again), and words waiting for an account.
 */

type Reply = { pieces?: (prompt: string) => Array<{ id: string; code: string }>; questions?: (prompt: string) => Array<{ piece: string; question: string }>; fail?: boolean };

/** The pieces the request asks for: id, kind and the request line ("- p1: action, ... particles: [...]"). */
const tasksOf = (prompt: string) => [...prompt.matchAll(/^- (p\d+): (\w+).*$/gm)].map((m) => ({ id: m[1], kind: m[2], line: m[0] }));

const CODE: Record<string, string> = {
  action: 'this.game.effects.burst({ x: this.x, y: this.y, color: "#ffd84d", count: 12 });',
  behavior: 'for (;;) {\n  this.turn(4);\n  yield;\n}',
};

function sse(content: string): string {
  return [
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
    'data: [DONE]\n\n',
  ].join('');
}

/** Answers compile requests; `next` decides each reply (the last one stays). */
async function mockOpenAI(page: Page, calls: string[], next: () => Reply) {
  await page.route('https://api.openai.com/v1/**', async (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const name: string = body.response_format?.json_schema?.name ?? 'unknown';
    calls.push(name);
    const how = next();
    if (how.fail) return route.fulfill({ status: 500, headers: { 'access-control-allow-origin': '*' }, body: 'The build service is busy.' });
    const prompt: string = body.messages?.[1]?.content ?? '';
    const reply =
      name === 'amble_pieces'
        ? {
            pieces: how.pieces ? how.pieces(prompt) : tasksOf(prompt).map((t) => ({ id: t.id, code: CODE[t.kind] ?? '' })),
            sprites: [],
            assets: [],
            warnings: [],
            questions: how.questions ? how.questions(prompt) : [],
          }
        : { parts: [] };
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: sse(JSON.stringify(reply)) });
  });
}

const withKey = (page: Page) =>
  page.addInitScript(() => {
    localStorage.setItem('amble:settings', JSON.stringify({ apiKey: 'sk-test', model: 'gpt-5', assetModel: 'gpt-5-mini' }));
  });

async function openExample(page: Page, title: string) {
  await page.getByRole('button', { name: /File/ }).click();
  await page.getByRole('menuitem', { name: title }).click();
  await page.getByRole('dialog', { name: 'Replace Project' }).getByRole('button', { name: 'Replace' }).click();
  await expect(page.locator('.sprite-tile', { hasText: 'Star' })).toBeVisible();
}

const wordsOf = (page: Page) =>
  page.evaluate(() => {
    type Field = { constructor: { name: string }; getValue(): string };
    const ws = (window as unknown as { __ambleWorkspace: { getAllBlocks(o: boolean): Array<{ inputList: Array<{ fieldRow: Field[] }> }> } }).__ambleWorkspace;
    return ws
      .getAllBlocks(false)
      .flatMap((b) => b.inputList.flatMap((i) => i.fieldRow))
      .filter((f) => f.constructor.name === 'FieldAmbleText')
      .map((f) => f.getValue());
  });

test('a question about words shows on their block; the answer joins the words and they build again', async ({ page }) => {
  const calls: string[] = [];
  let asked = false;
  await withKey(page);
  await mockOpenAI(page, calls, () => ({
    questions: (prompt) => {
      const sparkle = tasksOf(prompt).find((t) => /particles/.test(t.line));
      if (!sparkle || asked) return [];
      asked = true;
      return [{ piece: sparkle.id, question: 'I made a quick burst of 12 yellow sparkles. How long should they last?' }];
    },
  }));
  await page.goto('/');
  await openExample(page, 'Star Catcher');
  await page.locator('.green-flag').click();

  const note = page.locator('.code-note[data-kind="question"]');
  await expect(note).toContainText('How long should they last?', { timeout: 30_000 });
  // Beside its block, with a line to it.
  await expect(page.locator('.code-note-line[data-kind="question"]')).toHaveAttribute('d', /^M/);

  await note.getByRole('textbox', { name: 'Your answer' }).fill('about half a second');
  await note.getByRole('textbox', { name: 'Your answer' }).press('Enter');
  await expect(note).toHaveCount(0);
  expect((await wordsOf(page)).some((w) => w.endsWith('sparkles, about half a second'))).toBe(true);
  // The changed words build again on their own (no flag press).
  await expect.poll(() => calls.filter((c) => c === 'amble_pieces').length, { timeout: 20_000 }).toBe(2);
  await expect(page.locator('.code-note[data-kind="question"]')).toHaveCount(0);
});

test('a block that does not work where it is shows a note until it is fixed', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.sprite-tile')).toHaveCount(1);
  await expect(page.locator('.blocklyMainBackground')).toBeVisible();
  await expect(page.locator('.blocklyBlockCanvas .blocklyDraggable').first()).toBeVisible();
  await page.waitForTimeout(500);
  // A "when < >" with nothing in its slot.
  await page.evaluate(() => {
    const ws = (window as unknown as { __ambleWorkspace: { newBlock(t: string): { id: string; initSvg(): void; render(): void; moveBy(x: number, y: number): void } } }).__ambleWorkspace;
    const b = ws.newBlock('ev_when');
    b.initSvg();
    b.render();
    b.moveBy(40, 520);
    (window as unknown as { __whenId: string }).__whenId = b.id;
  });
  // Saved (the flag builds what is saved).
  await expect
    .poll(() =>
      page.evaluate(() => {
        const s = (window as unknown as { __ambleStore: { getState(): { project: { sprites: Array<{ blocks: unknown }> } } } }).__ambleStore.getState();
        return JSON.stringify(s.project.sprites[0].blocks).includes('ev_when');
      }),
    )
    .toBe(true);
  await page.locator('.green-flag').click();
  const note = page.locator('.code-note[data-kind="issue"]');
  await expect(note).toContainText('needs a condition in its slot');
  // Deleting the block takes its note away at once.
  await page.evaluate(() => {
    const w = window as unknown as { __whenId: string; __ambleWorkspace: { getBlockById(id: string): { dispose(): void } } };
    w.__ambleWorkspace.getBlockById(w.__whenId).dispose();
  });
  await expect(note).toHaveCount(0);
});

test('a problem in the last run shows on its script, with Fix it', async ({ page }) => {
  const calls: string[] = [];
  await withKey(page);
  let first = true;
  await mockOpenAI(page, calls, () => ({
    pieces: (prompt) =>
      tasksOf(prompt).map((t) => ({ id: t.id, code: t.kind === 'behavior' && first ? 'yield;\nthrow new Error("the star has nowhere to fall");' : (CODE[t.kind] ?? '') })),
  }));
  await page.goto('/');
  await openExample(page, 'Star Catcher');
  await page.locator('.green-flag').click();
  await page.locator('.sprite-tile', { hasText: 'Star' }).click();
  const note = page.locator('.code-note[data-kind="problem"]');
  await expect(note).toContainText('the star has nowhere to fall', { timeout: 30_000 });
  first = false;
  await note.getByRole('button', { name: 'Fix it' }).click();
  await expect.poll(() => calls.filter((c) => c === 'amble_pieces').length, { timeout: 20_000 }).toBe(2);
  // The fixed game runs without the problem.
  await expect(note).toHaveCount(0, { timeout: 20_000 });
});

test('words that did not build say so on their blocks, and Try again builds them', async ({ page }) => {
  const calls: string[] = [];
  let fail = true;
  await withKey(page);
  await mockOpenAI(page, calls, () => ({ fail }));
  await page.goto('/');
  await openExample(page, 'Star Catcher');
  await page.locator('.green-flag').click();
  const note = page.locator('.code-note[data-kind="problem"]');
  await expect(note).toContainText("This didn't build", { timeout: 30_000 });
  await expect(page.locator('.build-chip.failed')).toHaveText("Didn't build");
  // Nothing pops open.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  fail = false;
  await note.getByRole('button', { name: 'Try again' }).click();
  await expect(note).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('.build-chip.failed')).toHaveCount(0);
});

test('without an account words wait with a note; adding a key builds them, without pressing the flag', async ({ page }) => {
  const calls: string[] = [];
  await mockOpenAI(page, calls, () => ({}));
  await page.goto('/');
  await openExample(page, 'Star Catcher');
  await page.locator('.green-flag').click();
  const waiting = page.locator('.code-note[data-kind="waiting"]');
  await expect(waiting.first()).toContainText(/This builds once you (sign in|add a key in Settings)\./, { timeout: 30_000 });
  expect(calls).toEqual([]);
  // Pressing the flag again doesn't try again until something changed.
  await page.locator('.green-flag').click();
  await page.waitForTimeout(800);
  expect(calls).toEqual([]);

  // A key arrives (as from Settings): the waiting words build on their own.
  await page.evaluate(() => {
    const store = (window as unknown as { __ambleStore: { getState(): { setSettings(p: Record<string, unknown>): void } } }).__ambleStore;
    store.getState().setSettings({ apiKey: 'sk-test', model: 'gpt-5' });
  });
  await expect.poll(() => calls.filter((c) => c === 'amble_pieces').length, { timeout: 20_000 }).toBe(1);
  await expect(waiting).toHaveCount(0);
  await expect(page.locator('.amble-assembly')).toHaveCount(0, { timeout: 20_000 });
});
