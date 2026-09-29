/**
 * Captions and the text mirror (§3.9 rules 4 and 10, §6.7): a game that plays a sound with a caption and
 * scores points. Its caption shows under the world's game only with Settings → Sound → Captions on, stays
 * above the problem card and takes no clicks; the polite log beside the world always hears the score, at
 * most once every 2 s; axe finds nothing with captions showing. The Teacher desk's gallery and Present mode
 * show a game's captions too, although they play it muted.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, gotoRoute, openAmble, test } from '../helpers/app';
import { firstFrames, worldReady } from '../journeys/journey';
import { fakePickers } from '../school/school';

/** Plays a chime with its own caption and scores 10 points every 0.7 s of game time. */
const CHIME = `class Game extends Amble.Scene {
  static config = { physics: 'none', background: '#1b2a4a' };
  static sounds = { chime: { caption: '[chime rings]', segments: [{ wave: 'sine', startFreq: 880, endFreq: 660, duration: 0.12 }] } };
  create() {
    this.ui.score();
    this.every(700, () => { this.sfx('chime'); this.addScore(10); });
  }
}
`;

type Amble = {
  services: {
    starters: { open(id: string, o: { withArt: boolean }): Promise<{ world: Record<string, unknown> & { id: string } }> };
    store: { commit(c: unknown): Promise<void> };
    files: { write(world: unknown, kind: 'world'): Promise<Blob> };
  };
  setState(fn: (s: { session: { problems: unknown[] } }) => void): void;
};

/** The chime game as a world of the student's, stored (not opened). */
function chimeWorld(page: Page, title = 'Chime'): Promise<string> {
  return page.evaluate(
    async ({ code, title }) => {
      const a = (window as unknown as { __amble: Amble }).__amble;
      const { world } = await a.services.starters.open('moon-king', { withArt: false });
      const w = { ...world, title, code: [{ path: 'game.js', source: code, authors: [['student', code.split('\n').length]], locked: [] }], cast: {} };
      await a.services.store.commit({ worlds: [w] });
      return w.id;
    },
    { code: CHIME, title },
  );
}

/** Notes when each sentence reaches the text mirror (the log only keeps the last few). */
async function recordMirror(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __said: Array<{ text: string; at: number }>; __saidOff?: () => void };
    w.__saidOff?.();
    w.__said = [];
    const log = document.querySelector('[data-testid="game-mirror"]');
    if (!log) throw new Error('No text mirror.');
    const mo = new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) w.__said.push({ text: n.textContent ?? '', at: performance.now() });
    });
    mo.observe(log, { childList: true });
    w.__saidOff = () => mo.disconnect();
  });
}

function said(page: Page): Promise<Array<{ text: string; at: number }>> {
  return page.evaluate(() => (window as unknown as { __said: Array<{ text: string; at: number }> }).__said);
}

async function axe(page: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('iframe').analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}

test('captions show only with Captions on, and the text mirror hears the score', async ({ page }) => {
  test.setTimeout(240_000);
  await openAmble(page, { clean: true });
  const id = await chimeWorld(page);
  const before = await firstFrames(page);
  await gotoRoute(page, `#/w/${id}`);
  await worldReady(page, before);

  // The text mirror: a polite log beside the world, apart from the app's live regions.
  const mirror = page.getByTestId('game-mirror');
  await expect(mirror).toHaveAttribute('role', 'log');
  await expect(mirror).toHaveAttribute('aria-live', 'polite');
  await expect(page.getByRole('log', { name: 'What happens in the game' })).toHaveCount(1);
  await recordMirror(page);
  await expect(mirror).toContainText(/Score: \d+\./, { timeout: 30_000 });

  // Captions off (the default): the chime keeps playing, but no words show.
  const captions = page.getByTestId('game-captions');
  await expect.poll(async () => (await said(page)).filter((s) => s.text.startsWith('Score:')).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  await expect(captions).toBeHidden();

  // The score is said at most once every 2 s, and it goes up.
  const scores = (await said(page)).filter((s) => s.text.startsWith('Score:'));
  for (let i = 1; i < scores.length; i++) {
    expect(scores[i].at - scores[i - 1].at).toBeGreaterThanOrEqual(1900);
    expect(Number(/\d+/.exec(scores[i].text)?.[0])).toBeGreaterThan(Number(/\d+/.exec(scores[i - 1].text)?.[0]));
  }

  // Settings → Sound → Captions on, then back to the world.
  await gotoRoute(page, '#/settings/sound');
  await page.getByRole('switch', { name: /^Captions/ }).click();
  await expect(page.getByRole('switch', { name: /^Captions/ })).toBeChecked();
  await gotoRoute(page, `#/w/${id}`);
  await expect(page.getByTestId('screen-world')).toBeVisible();
  await expect(captions).toBeVisible({ timeout: 30_000 });
  await expect(captions).toContainText('[chime rings]');
  // The mirror never reads captions out: a listener hears the sound itself.
  await expect(mirror).not.toContainText('[chime rings]');

  // At the bottom edge of the game, inside the world view, and never in the way of a click.
  const view = (await page.getByTestId('world-view').boundingBox())!;
  const strip = (await captions.boundingBox())!;
  expect(strip.y + strip.height).toBeLessThanOrEqual(view.y + view.height);
  expect(strip.y + strip.height).toBeGreaterThan(view.y + view.height - 60);
  expect(strip.x).toBeGreaterThanOrEqual(view.x);
  expect(await captions.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
  expect(await axe(page)).toEqual([]);

  // A problem card at the bottom: the captions move up above it.
  await page.evaluate(() =>
    (window as unknown as { __amble: Amble }).__amble.setState((s) => {
      s.session.problems.push({ phase: 'update', message: 'A test problem', file: 'game.js', line: 5, count: 1, fatal: true });
    }),
  );
  const card = page.getByTestId('problem-card');
  await expect(card).toBeVisible();
  await expect
    .poll(
      async () => {
        const c = await card.boundingBox();
        const s = (await captions.isVisible()) ? await captions.boundingBox() : null;
        return !s || !c || s.y + s.height <= c.y;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  await expect(captions).toContainText('[chime rings]', { timeout: 20_000 });

  // Captions off again: the strip empties at once.
  await gotoRoute(page, '#/settings/sound');
  await page.getByRole('switch', { name: /^Captions/ }).click();
  await gotoRoute(page, `#/w/${id}`);
  await expect(page.getByTestId('screen-world')).toBeVisible();
  await page.waitForTimeout(3000);
  await expect(captions).toBeHidden();
});

test('a web page shared with Captions on shows the words too', async ({ page, context }) => {
  test.setTimeout(180_000);
  await openAmble(page, { clean: true });
  const id = await chimeWorld(page);
  const share = (captions: boolean) =>
    page.evaluate(
      async ({ wid, captions }) => {
        const a = (window as unknown as { __amble: Amble & { setPrefs(p: unknown): void; services: { store: { worlds: { get(id: string): Promise<unknown> } }; files: { sharePage(w: unknown): Promise<Blob> } } } }).__amble;
        a.setPrefs({ captions });
        return (await a.services.files.sharePage(await a.services.store.worlds.get(wid))).text();
      },
      { wid: id, captions },
    );

  const shown = await context.newPage();
  await shown.setContent(await share(true));
  await shown.getByRole('button', { name: /Play/ }).click();
  await expect(shown.locator('.amble-captions')).toContainText('[chime rings]', { timeout: 60_000 });
  await shown.close();

  const quiet = await context.newPage();
  await quiet.setContent(await share(false));
  await quiet.getByRole('button', { name: /Play/ }).click();
  await quiet.waitForFunction(() => (window as unknown as { __ambleGame?: { state?: string } }).__ambleGame?.state === 'running', null, { timeout: 60_000 });
  await quiet.waitForTimeout(3000);
  await expect(quiet.locator('.amble-captions')).toHaveCount(0);
  await quiet.close();
});

test('the gallery and Present mode show captions, though they play muted', async ({ page }) => {
  test.setTimeout(240_000);
  await fakePickers(page);
  await openAmble(page, { clean: true, prefs: { captions: true } });
  await page.evaluate(async (code) => {
    const a = (window as unknown as { __amble: Amble }).__amble;
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('class', { create: true });
    const { world } = await a.services.starters.open('moon-king', { withArt: false });
    const w = { ...world, title: 'Chime', credits: { madeBy: 'J.R.' }, code: [{ path: 'game.js', source: code, authors: [['student', code.split('\n').length]], locked: [] }], cast: {} };
    const out = await (await dir.getFileHandle('Chime - J.R.amble', { create: true })).createWritable();
    await out.write(await a.services.files.write(w, 'world'));
    await out.close();
  }, CHIME);

  await gotoRoute(page, '#/teacher/gallery');
  const gallery = page.getByTestId('teacher-gallery');
  await gallery.getByTestId('open-folder').click();
  await gallery.getByTestId('gallery-card').filter({ hasText: 'Chime' }).click();
  const detail = page.getByTestId('gallery-detail');
  await expect(detail.getByTestId('game-captions')).toContainText('[chime rings]', { timeout: 60_000 });
  await expect(detail.getByTestId('game-mirror')).toContainText(/Score: \d+\./);

  await gotoRoute(page, '#/teacher/present');
  const present = page.getByTestId('gallery-slot');
  await expect(present.getByTestId('game-captions')).toContainText('[chime rings]', { timeout: 60_000 });
  await expect(present.getByTestId('game-mirror')).toContainText(/Score: \d+\./);
});
