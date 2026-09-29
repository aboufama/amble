/**
 * The school screens in Scratch's look: axe finds no WCAG 2.1 A/AA problem on Look inside, Hand in, the
 * Join card, the Teacher desk's four tabs, every Settings section and every in-app page, in the Original
 * colours and in High contrast (the accessibility statement says so); every button on the AI instructions
 * page and What Amble sends has a name of its own; and the teacher's link card never shows a made-up class
 * name, and says when its QR code is dense, offering a shorter link.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { classLinkPayload, expect, gotoRoute, openAmble, test, TEST_CLASS } from '../helpers/app';
import { AI_BASE, CLASS_CODE, mockAi } from '../helpers/mockAi';
import { worldWithAssignment } from './school';

/** axe's WCAG 2.1 A and AA problems on the page as it is (game frames left out). */
async function axe(page: Page, where: string): Promise<string[]> {
  // Let finite animations (a dialog fading in) finish: axe reads colours mid-fade as low contrast.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || (a.effect?.getComputedTiming().endTime ?? 0) === Infinity), null, { timeout: 5_000 }).catch(() => undefined);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('iframe').analyze();
  return r.violations.map((v) => `${where} → ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}

async function settle(page: Page, hash: string): Promise<void> {
  await gotoRoute(page, hash);
  // Entrances and lazy chunks settle before axe reads the page.
  await page.waitForTimeout(400);
}

for (const theme of ['original', 'contrast'] as const) {
  test(`Look inside, Hand in, Join, the Teacher desk, Settings and the pages pass axe (${theme})`, async ({ page }) => {
    test.setTimeout(300_000);
    // The Original colours are the default; High contrast is a setting.
    await openAmble(page, { clean: true, ...(theme === 'contrast' ? { prefs: { theme: 'contrast' } } : {}) });
    if (theme === 'contrast') await expect(page.locator('html')).toHaveAttribute('data-theme', 'contrast');
    const found: string[] = [];

    for (const section of ['ai', 'sound', 'reading', 'drawing', 'keys', 'storage', 'about']) {
      await settle(page, `#/settings/${section}`);
      found.push(...(await axe(page, `#/settings/${section}`)));
    }
    for (const p of ['privacy', 'terms', 'ai', 'it', 'parents', 'accessibility', 'poster', 'sent', 'whatsnew']) {
      await settle(page, `#/${p}`);
      found.push(...(await axe(page, `#/${p}`)));
    }
    for (const tab of ['link', 'assignments', 'gallery', 'help']) {
      await settle(page, `#/teacher/${tab}`);
      found.push(...(await axe(page, `#/teacher/${tab}`)));
    }

    const id = await worldWithAssignment(page);
    await settle(page, `#/w/${id}/code`);
    await expect(page.locator('.cm-content')).toBeVisible();
    found.push(...(await axe(page, 'Look inside')));
    await settle(page, `#/w/${id}/handin`);
    await expect(page.getByRole('dialog', { name: /^Hand in your world/ })).toBeVisible();
    found.push(...(await axe(page, 'Hand in')));

    await page.goto(`./#class=${classLinkPayload(TEST_CLASS as unknown as Record<string, unknown>)}`);
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.waitForTimeout(400);
    found.push(...(await axe(page, 'Join card')));
    expect(found).toEqual([]);
  });
}

test('every button on the AI instructions page and What Amble sends has a name of its own', async ({ page }) => {
  await mockAi(page);
  await openAmble(page, { clean: true, route: '#/ai' });
  const ai = page.locator('[data-page="ai"]');
  await expect(ai.getByRole('button', { name: 'Hide Building and changing a world' })).toBeVisible();
  for (const title of ['Building and changing a world', 'Planning a new world', 'Explaining code', 'Finding joints (optional)']) {
    await expect(ai.getByRole('button', { name: `Copy ${title}`, exact: true })).toHaveCount(1);
  }
  for (const title of ['Planning a new world', 'Explaining code', 'Finding joints (optional)']) {
    await expect(ai.getByRole('button', { name: `Show ${title}`, exact: true })).toHaveCount(1);
  }
  for (const bare of ['Copy', 'Show', 'Hide']) await expect(ai.getByRole('button', { name: bare, exact: true })).toHaveCount(0);

  // Two connection tests from the Teacher desk make two entries in What Amble sends.
  await gotoRoute(page, '#/teacher/link');
  const tab = page.getByTestId('teacher-classlink');
  await tab.getByLabel('AI address').fill(AI_BASE);
  const logged = () => page.evaluate(async () => (await (window as unknown as { __amble: { store: { ailog: { list(): Promise<unknown[]> } } } }).__amble.store.ailog.list()).length);
  await tab.getByLabel('Class code').fill(CLASS_CODE);
  await expect.poll(logged).toBe(1);
  await page.waitForTimeout(1100);
  await tab.getByLabel('Class code').fill(`${CLASS_CODE}-2`);
  await expect.poll(logged).toBe(2);
  await gotoRoute(page, '#/sent');
  await expect(page.getByTestId('sent-entry')).toHaveCount(2);
  const toggles = page.getByRole('button', { name: /^Show exactly: Connection test, / });
  await expect(toggles).toHaveCount(2);
  const names = await toggles.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  expect(new Set(names).size).toBe(2);
});

test('the link card shows no made-up class name, and a dense code says so and offers a shorter link', async ({ page }) => {
  await mockAi(page);
  await openAmble(page, { clean: true, route: '#/teacher/link' });
  const tab = page.getByTestId('teacher-classlink');
  const card = tab.locator('.linkcard');
  // Before the teacher names the class, the card has a blank to fill in, not an example set as if real.
  await expect(card.getByTestId('class-name-slot')).toHaveText('Your class name goes here');
  await expect(card).not.toContainText('Room 12');
  await expect(page.getByText('Join your class?')).toBeVisible();

  await tab.getByLabel('AI address').fill(AI_BASE);
  await tab.getByLabel('Class code').fill(CLASS_CODE);
  await tab.getByLabel('Name students see').fill('Room 12 · Period 3');
  await expect(card.getByTestId('class-name-slot')).toHaveCount(0);
  await expect(card).toContainText('Room 12 · Period 3');
  await expect(card.getByRole('img', { name: /QR code/ })).toBeVisible();
  // A plain class link makes a code a phone reads from the card.
  await expect(card.getByTestId('dense-qr')).toHaveCount(0);

  // An assignment makes the link long: the card says the code is dense and offers the shorter link.
  await gotoRoute(page, '#/teacher/assignments');
  await page.getByRole('button', { name: 'New assignment' }).first().click();
  const editor = page.getByTestId('assignment-editor');
  await editor.getByLabel('Title').fill('Boss Battle Week');
  await editor.getByLabel('Instructions').fill('Draw your own hero and a giant boss, then give the boss two attacks and a way to lose.');
  await editor.getByLabel('Due', { exact: true }).fill('Friday');
  await editor.getByRole('checkbox', { name: /^The Moon King/ }).check();
  for (const goal of [/^Hero drawn/, /^Boss has 2\+ attacks/, /^Runs without errors/, /^Has a win and a lose/]) await editor.getByRole('checkbox', { name: goal }).check();
  await page.getByRole('button', { name: 'Put it in the class link' }).click();
  await expect(tab).toBeVisible();
  await expect(card.getByTestId('dense-qr')).toBeVisible();
  await card.getByRole('button', { name: 'Make a shorter link' }).click();
  await expect(card.getByTestId('dense-qr')).toHaveCount(0);
  await expect(tab.getByLabel('Assignment').locator('option:checked')).toHaveText('None');
  await expect(card.getByRole('img', { name: /QR code/ })).toBeVisible();
});
