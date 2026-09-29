/**
 * Look inside (§2.12, §8.5 M9): change a number → Run it → the world reloads with the change and a
 * footstep, which survive a page reload; a syntax error shows a diagnostic on its line and the world keeps
 * its last version; teacher-locked lines are read-only.
 */
import type { Page } from '@playwright/test';
import { expect, gotoRoute, openAmble, test, waitForApp } from '../helpers/app';

interface Hook {
  store: { worlds: { get(id: string): Promise<{ code: Array<{ source: string; authors: Array<[string, number]>; locked: Array<[number, number]> }>; steps: Array<{ text: string; kind: string }> } | null> } };
  services: { player: { load(init: unknown): Promise<unknown> } };
}

/** Opens the starter world and waits for its game's first frame (the student sees it play first). */
async function openWorld(page: Page): Promise<string> {
  await openAmble(page);
  await gotoRoute(page, '#/starter/moon-king');
  await expect(page).toHaveURL(/#\/w\/[A-Za-z0-9_-]+$/);
  await expect(page.getByTestId('player-layer')).toHaveAttribute('data-first-frame', /\d/, { timeout: 60_000 });
  return new URL(page.url()).hash.replace('#/w/', '');
}

async function openCode(page: Page): Promise<string> {
  const id = await openWorld(page);
  // Record what the player is asked to run.
  await page.evaluate(() => {
    const w = window as unknown as { __amble: Hook; __loads: string[][] };
    const player = w.__amble.services.player;
    const load = player.load.bind(player);
    w.__loads = [];
    player.load = (init: unknown) => {
      w.__loads.push((init as { files: Array<{ source: string }> }).files.map((f) => f.source));
      return load(init);
    };
  });
  await gotoRoute(page, `#/w/${id}/code`);
  await expect(page.locator('.cm-content')).toBeVisible();
  return id;
}

/** Scrolls the editor until a line with `text` is rendered (CodeMirror draws only what is in view). */
async function revealLine(page: Page, text: string) {
  const line = page.locator('.cm-line', { hasText: text });
  if (!(await line.count())) {
    // The editor's own search brings the line into view (as a student would find it).
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+f');
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
  }
  await expect(line).toHaveCount(1);
  await line.scrollIntoViewIfNeeded();
  return line;
}

async function stored(page: Page, id: string) {
  return page.evaluate(async (worldId) => {
    const w = await (window as unknown as { __amble: Hook }).__amble.store.worlds.get(worldId);
    return { source: w!.code[0].source, authors: w!.code[0].authors, steps: w!.steps.map((s) => s.text) };
  }, id);
}

test('a changed number runs, leaves a footstep and survives a reload', async ({ page }) => {
  const id = await openCode(page);
  await expect(page.getByText('This is the real code of your world. Change a number and press Run it!')).toBeVisible();
  const runBar = page.getByTestId('run-bar');
  await expect(runBar).toContainText('This is the code your world is running.');

  await page.locator('.cm-content').getByText('1500', { exact: true }).dblclick();
  await page.keyboard.type('1200');
  await expect(runBar).toContainText('You changed game.js. Press Run it to play it.');
  await expect(page.locator('.cm-prov--student')).toHaveCount(1);
  await expect(page.getByRole('tab', { name: /game\.js/ })).toContainText('You changed this file');
  await expect(page.getByRole('button', { name: 'Undo my edits' })).toBeEnabled();

  await page.keyboard.press('Control+Enter');
  await expect(runBar).toContainText('Your changes are running!');
  const after = await stored(page, id);
  expect(after.source).toContain('gravity: 1200');
  expect(after.steps[after.steps.length - 1]).toBe('You changed game.js');
  expect(after.authors).toEqual([
    ['starter', 2],
    ['student', 1],
    ['starter', after.source.split('\n').length - 3],
  ]);
  const loads = await page.evaluate(() => (window as unknown as { __loads: string[][] }).__loads);
  expect(loads[loads.length - 1].join('\n')).toContain('gravity: 1200');

  await page.reload();
  await waitForApp(page);
  await expect(page.locator('.cm-content')).toContainText('gravity: 1200');
  await expect(page.getByTestId('run-bar')).toContainText('This is the code your world is running.');
  await expect(page.locator('.cm-prov--student')).toHaveCount(1);
});

test('a syntax error shows on its line and the world keeps its last version', async ({ page }) => {
  const id = await openCode(page);
  const before = await stored(page, id);
  const loadsBefore = await page.evaluate(() => (window as unknown as { __loads: string[][] }).__loads.length);

  await (await revealLine(page, 'this.rage = 0;')).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' )');
  const line = before.source.split('\n').findIndex((l) => l.includes('this.rage = 0;')) + 1;

  const problem = page.locator('.problem--error');
  await expect(problem).toHaveCount(1);
  await expect(problem).toContainText(`Line ${line}`);
  await expect(page.locator('.cm-line', { hasText: 'this.rage = 0; )' }).locator('.cm-lintRange-error')).toHaveCount(1);

  await page.getByTestId('run-it').click();
  await expect(page.getByTestId('run-bar')).toContainText(`Not running your changes yet: 1 problem on line ${line}.`);
  const after = await stored(page, id);
  expect(after.source).toBe(before.source);
  expect(after.steps).toEqual(before.steps);
  expect(await page.evaluate(() => (window as unknown as { __loads: string[][] }).__loads.length)).toBe(loadsBefore);

  // Show me puts the cursor on the problem line; Undo my edits brings the running version back.
  await page.getByRole('button', { name: 'Show me' }).click();
  await expect(page.locator('.cm-activeLine')).toContainText('this.rage = 0; )');
  await page.getByRole('button', { name: 'Undo my edits' }).click();
  await expect(page.locator('.cm-content')).not.toContainText('this.rage = 0; )');
  await expect(page.locator('.problem--error')).toHaveCount(0);
});

test('teacher-locked lines are read-only', async ({ page }) => {
  const id = await openWorld(page);
  // The teacher locked line 3 (the game's config).
  await page.evaluate(async (worldId) => {
    type Amble = { store: { worlds: { get(id: string): Promise<{ code: Array<{ locked: unknown }> }> }; commit(c: unknown): Promise<void> }; setState(fn: (s: { session: { world: { code: Array<{ locked: unknown }> } | null } }) => void): void };
    const a = (window as unknown as { __amble: Amble }).__amble;
    const world = await a.store.worlds.get(worldId);
    world.code[0].locked = [[3, 3]];
    await a.store.commit({ worlds: [world] });
    a.setState((s) => {
      if (s.session.world) s.session.world.code[0].locked = [[3, 3]];
    });
  }, id);
  await gotoRoute(page, `#/w/${id}/code`);
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.locator('.cm-lock--first')).toHaveCount(1);

  const locked = page.locator('.cm-line', { hasText: 'static config' });
  const text = await locked.textContent();
  await locked.click();
  await page.keyboard.type('oops');
  await expect(page.locator('.cm-locked-note')).toHaveText('Your teacher locked these lines.');
  await expect(locked).toHaveText(text ?? '');
  await page.keyboard.press('Backspace');
  await expect(locked).toHaveText(text ?? '');

  // The line after it takes typing.
  await page.locator('.cm-line', { hasText: 'static art = {' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' // mine');
  await expect(page.locator('.cm-line', { hasText: 'static art = { // mine' })).toHaveCount(1);
  await expect(page.getByTestId('run-bar')).toContainText('You changed game.js');
});

test('Explain this shows kit docs with the AI helper off, and its note when on', async ({ page }) => {
  await openCode(page);
  await (await revealLine(page, 'this.ui.bossBar(')).click();
  await page.getByRole('button', { name: 'Explain this' }).click();
  const docs = page.locator('.cm-explain--docs');
  await expect(docs).toContainText('What these do');
  await expect(docs).toContainText('bossBar(');
  await docs.getByRole('button', { name: 'Close this note' }).click();
  await expect(docs).toHaveCount(0);

  // A stand-in AI helper that answers on the device.
  await page.evaluate(() => {
    type Ai = { status(): string; explain(w: unknown, q: { from: number; to: number }): Promise<unknown> };
    const ai = (window as unknown as { __amble: { services: { ai: Ai } } }).__amble.services.ai;
    ai.status = () => 'ready';
    ai.explain = async (_w, q) => ({
      kind: 'explained',
      reply: { answer: 'This line puts the boss health bar at the top.', lines: [{ from: q.from, to: q.to, note: 'The name shows above the bar.' }], safetyNote: '' },
    });
  });
  await (await revealLine(page, 'this.ui.bossBar(')).click();
  await page.getByRole('button', { name: 'Explain this' }).click();
  const note = page.locator('.cm-explain--ai');
  await expect(note).toContainText('AI helper');
  await expect(note).toContainText('This line puts the boss health bar at the top.');
  await expect(note).toContainText('The name shows above the bar.');
});

test('other screens open Look inside at a line, or with an explanation beside it', async ({ page }) => {
  const id = await openWorld(page);
  const source = await page.evaluate(async (worldId) => (await (window as unknown as { __amble: Hook }).__amble.store.worlds.get(worldId))!.code[0].source, id);
  const line = source.split('\n').findIndex((l) => l.includes('this.ui.bossBar(')) + 1;
  // What the world's problem card and the explain-only Ask card call (src/screens/code/open.ts).
  await page.evaluate(
    async ({ worldId, from }) => {
      const url = '/src/screens/code/open.ts';
      const { lookInside } = (await import(url)) as { lookInside(r: unknown): void };
      lookInside({ worldId, file: 'game.js', explain: { from, to: from, reply: { answer: 'This puts the boss health bar at the top.', lines: [], safetyNote: '' } } });
    },
    { worldId: id, from: line },
  );
  await expect(page.getByTestId('screen-code')).toBeVisible();
  await expect(page.locator('.cm-explain--ai')).toContainText('This puts the boss health bar at the top.');
  await expect(page.locator('.cm-activeLine')).toContainText('this.ui.bossBar(');
  await expect(page).toHaveURL(new RegExp(`#/w/${id}/code/game\\.js$`));
});

test('kit calls have hover docs and autocomplete', async ({ page }) => {
  await openCode(page);
  const line = await revealLine(page, 'this.ui.bossBar(');
  await line.getByText('bossBar', { exact: true }).hover();
  await expect(page.locator('.cm-kit-doc')).toContainText('this.ui.bossBar(');
  await line.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' this.fx.sha');
  const menu = page.locator('.cm-tooltip-autocomplete');
  await expect(menu).toContainText('shake');
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  await expect(page.locator('.cm-line', { hasText: 'this.fx.shake' })).toHaveCount(1);

  // Tab indents inside the editor; Esc then Tab leaves it (no keyboard trap).
  await page.keyboard.press('Tab');
  await expect(page.locator('.cm-content')).toBeFocused();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('.cm-editor')))).toBe(false);
});
