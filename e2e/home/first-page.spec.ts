/**
 * The First page (§2.3): a clean profile opens on the paper, pen strokes enable Bring it to life, the
 * doodle wakes up and keeps moving, the kind and name chips change it, and Boss fight opens a world with
 * the doodle as its hero. Drawing and waking never talk to the AI, even with a class's AI on.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, openAmble, test } from '../helpers/app';
import { mockAi } from '../helpers/mockAi';
import { ellipse, humanStroke, line, stroke } from '../helpers/pen';

type Amble = {
  store: { worlds: { get(id: string): Promise<{ cast: Record<string, { art: string | null }>; origin: Record<string, unknown> } | null> } };
  getState(): { library: { characters: Array<{ id: string; name: string; rig: string }> } };
};

/**
 * A little person with the big pen: head, body, arms out and legs apart, drawn with the pen like a hand
 * would (bold enough that its bones are found every time).
 */
async function drawPerson(page: Page, board: Locator): Promise<void> {
  await page.getByTestId('pen-size').click();
  await expect(page.getByTestId('pen-size')).toHaveAccessibleName(/big/i);
  const box = await board.boundingBox();
  if (!box) throw new Error('The paper is not on screen.');
  const cx = box.width * 0.45;
  const cy = box.height * 0.48;
  const strokes = [
    ellipse(cx, cy - 122, 40, 38, -90, 370),
    ellipse(cx, cy - 5, 56, 76, -90, 370),
    line(cx - 26, cy + 66, cx - 58, cy + 178, 3),
    line(cx + 26, cy + 66, cx + 58, cy + 178, -3),
    line(cx - 52, cy - 36, cx - 140, cy + 4, 5),
    line(cx + 52, cy - 36, cx + 140, cy + 4, -5),
  ];
  for (const [i, path] of strokes.entries()) await stroke(page, board, humanStroke(path, { seed: i + 1, speed: 900, p0: 0.5, p1: 0.9 }), { pointer: 'pen' });
}

test('a first doodle comes alive, gets a kind and a name, and walks into Boss fight', async ({ page }) => {
  // The rig worker starts cold in a fresh profile, and test machines are slow: generous waits.
  test.setTimeout(180_000);
  const ai = await mockAi(page);
  await openAmble(page, { ai: 'mock' });
  await expect(page.getByTestId('screen-home')).toHaveAttribute('data-home', 'first');
  const first = page.getByTestId('screen-first');
  await expect(first.getByRole('heading', { name: 'Draw a creature.' })).toBeVisible();

  // Everything from here on is drawing and waking: none of it may reach the AI.
  const aiBefore = ai.requests.length;
  const board = page.getByTestId('first-board');
  await expect(board.locator('canvas').first()).toBeVisible();
  const bring = page.getByTestId('bring-to-life');
  await expect(bring).toHaveAttribute('aria-disabled', 'true');

  await drawPerson(page, board);
  await expect(bring).not.toHaveAttribute('aria-disabled', 'true');

  const t0 = Date.now();
  await bring.click();
  await expect(first).toHaveAttribute('data-awake', 'true', { timeout: 60_000 });
  test.info().annotations.push({ type: 'alive', description: `awake ${Date.now() - t0} ms after the click` });

  // The creature keeps moving: its canvas changes between frames.
  const canvas = page.getByTestId('alive-canvas');
  await expect(canvas).toBeVisible();
  const moving = await canvas.evaluate(async (c: HTMLCanvasElement) => {
    const first = c.toDataURL();
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 150));
      if (c.toDataURL() !== first) return true;
    }
    return false;
  });
  expect(moving, 'the alive canvas changes between frames').toBe(true);

  // It is on the shelf, as a blob until told otherwise.
  const character = async () => page.evaluate(() => (window as unknown as { __amble: Amble }).__amble.getState().library.characters[0] ?? null);
  await expect.poll(character).not.toBeNull();
  const art = (await character())!;
  expect(art.rig).toBe('blob');

  // The kind chip: it's a person (the card stays open for the facing too; Esc closes it).
  const kindChip = page.getByTestId('kind-chip');
  await expect(kindChip).toContainText('A blob');
  await kindChip.getByRole('button').click();
  await page.getByRole('radio', { name: /person/i }).click();
  await expect(kindChip).toContainText('A person');
  await expect.poll(async () => (await character())?.rig, { timeout: 30_000 }).toBe('biped');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('radio', { name: /person/i })).toBeHidden();

  // The name chip.
  await page.getByTestId('name-chip').click();
  const nameInput = page.getByTestId('name-input');
  await nameInput.fill('Sir Hops');
  await nameInput.press('Enter');
  await expect(page.getByTestId('name-chip')).toContainText('Sir Hops');
  await expect.poll(async () => (await character())?.name).toBe('Sir Hops');

  // Boss fight, with Sir Hops as its hero.
  await page.getByRole('button', { name: /^Boss fight with Sir Hops/ }).click();
  await expect(page).toHaveURL(/#\/w\/w_[A-Za-z0-9_-]+$/);
  await expect(page.getByTestId('screen-world')).toBeVisible();
  const worldId = new URL(page.url()).hash.replace('#/w/', '');
  const world = await page.evaluate((id) => (window as unknown as { __amble: Amble }).__amble.store.worlds.get(id), worldId);
  expect(world?.cast.hero.art).toBe(art.id);
  expect(world?.origin).toMatchObject({ kind: 'starter', starter: 'moon-king', withArt: false });

  // Nothing went to the AI (a model list check is not a request with anything of the student's).
  expect(ai.requests.slice(aiBefore).filter((r) => r.kind !== 'models').map((r) => `${r.method} ${r.path}`)).toEqual([]);
});

test('"Or play one first." opens a starter, and leaving it untouched keeps the First page', async ({ page }) => {
  await openAmble(page);
  await expect(page.getByTestId('screen-home')).toHaveAttribute('data-home', 'first');
  const starters = page.getByTestId('first-column').getByRole('button', { name: /Play it\.$/ });
  await expect(starters).toHaveCount(4);
  await starters.first().click();
  await expect(page).toHaveURL(/#\/w\/w_[A-Za-z0-9_-]+$/);
  await expect(page.getByTestId('screen-world')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('screen-home')).toHaveAttribute('data-home', 'first');
  await expect(page.getByTestId('screen-first')).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await (window as unknown as { __amble: { store: { worlds: { list(): Promise<unknown[]> } } } }).__amble.store.worlds.list()).length)).toBe(0);
});

test('a pen on the paper while it slides in lands it at once, so the line stays under the pen', async ({ page }) => {
  await openAmble(page, { clean: true });
  const first = page.getByTestId('screen-first');
  await expect(first).toHaveClass(/first--entered/);
  // Hold the entrance where it is, as if the student were quicker than the paper.
  const sliding = await page.evaluate(() => {
    const anims = document.querySelector('.first__paper-cell')?.getAnimations() ?? [];
    anims.forEach((a) => a.pause());
    return anims.length;
  });
  test.skip(sliding === 0, 'the paper had already landed on this machine');
  const board = page.getByTestId('first-board');
  const box = (await board.boundingBox())!;
  await stroke(page, board, humanStroke(line(box.width * 0.2, box.height * 0.4, box.width * 0.8, box.height * 0.4), { wobble: 0, tremor: 0, jitter: 0 }), { pointer: 'pen' });
  // The paper landed on the pen-down, so nothing moved it under the stroke.
  expect(await page.evaluate(() => document.querySelector('.first__paper-cell')?.getAnimations().length)).toBe(0);
  const ink = await board.locator('canvas').first().evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let top = Infinity;
    let bottom = -1;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 200 || d[i] + d[i + 1] + d[i + 2] > 200) continue;
      const y = Math.floor(i / 4 / c.width);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
    return { rows: bottom - top + 1, scale: c.height / c.getBoundingClientRect().height };
  });
  expect(ink.rows / ink.scale, 'a straight line, not a hook').toBeLessThan(24);
});
