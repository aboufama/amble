import { expect, test } from '@playwright/test';

/**
 * The Sounds tab's library: search thousands of generated sounds by everyday words, listen,
 * and add one to the sprite. Nothing is downloaded: each sound is made in the page when asked for.
 */

test('the sound library finds sounds by everyday words, and adds them to the sprite', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.blocklyMainBackground')).toBeVisible();
  await page.getByRole('tab', { name: 'Sounds' }).click();
  // A new project starts with two sounds from the library.
  await expect(page.locator('.sound-tile')).toHaveCount(2);

  await page.getByRole('button', { name: 'Choose a Sound' }).click();
  const library = page.getByRole('dialog', { name: 'Choose a Sound' });
  await expect(library).toBeVisible();
  const search = library.getByLabel('Search sounds');
  await expect(search).toBeFocused();
  // Thousands on offer; browsing shows one of each, a page at a time.
  expect(Number(((await search.getAttribute('placeholder')) ?? '').replace(/\D/g, ''))).toBeGreaterThanOrEqual(3000);
  await expect(library.locator('.sound-card')).toHaveCount(60);
  await library.getByRole('button', { name: /Show more/ }).click();
  await expect(library.locator('.sound-card')).toHaveCount(180);

  // "boing" finds jumps and bounces.
  await search.fill('boing');
  const names = library.locator('.sound-card-name');
  await expect(names.first()).toHaveText(/Jump|Bounce/);
  expect((await names.allTextContents()).slice(0, 5).every((n) => /Jump|Bounce|Twang|Spring/.test(n))).toBe(true);

  // Listening makes the sound on the spot; listening to another stops the first.
  const first = (await names.first().textContent()) ?? '';
  await library.getByRole('button', { name: `Play ${first}`, exact: true }).click();
  await expect(library.getByRole('button', { name: `Stop ${first}`, exact: true }).or(library.getByRole('button', { name: `Play ${first}`, exact: true }))).toBeVisible();

  // Add puts it on the sprite, selected, and closes the library.
  await library.getByRole('button', { name: `Add ${first}`, exact: true }).click();
  await expect(library).toBeHidden();
  await expect(page.locator('.sound-tile')).toHaveCount(3);
  await expect(page.locator('.sound-tile.selected')).toContainText(first);
  await expect(page.getByLabel('Sound name')).toHaveValue(first);

  // Music: kinds narrow the search, and a loop is several seconds long.
  await page.getByRole('button', { name: 'Choose a Sound' }).click();
  await library.getByRole('button', { name: 'Music', exact: true }).click();
  await library.getByLabel('Search sounds').fill('spooky');
  await expect(library.locator('.sound-card-name').first()).toHaveText(/^Spooky Loop: /);
  const loop = (await library.locator('.sound-card-name').first().textContent()) ?? '';
  await library.getByRole('button', { name: `Add ${loop}`, exact: true }).click();
  await expect(page.locator('.sound-tile.selected')).toContainText(loop);
  const seconds = Number(((await page.locator('.sound-tile.selected').textContent()) ?? '').match(/(\d+\.\d\d)/)?.[1]);
  expect(seconds).toBeGreaterThan(7);
  expect(seconds).toBeLessThan(15);

  // Nothing found says so; Escape closes.
  await page.getByRole('button', { name: 'Choose a Sound' }).click();
  await library.getByLabel('Search sounds').fill('qzxv');
  await expect(library.getByText(/No sounds match/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(library).toBeHidden();

  // Surprise adds some effect from the library.
  // (The menu opens on hover; the click goes straight to its button.)
  await page.locator('.add-asset').getByRole('button', { name: 'Surprise' }).dispatchEvent('click');
  await expect(page.locator('.sound-tile')).toHaveCount(5);
  expect(errors).toEqual([]);
});
