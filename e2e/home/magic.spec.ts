/**
 * The AI is invisible magic on the home screens: the Trail, the First page, New world and the Join card
 * never name it, badge it or sparkle (the "How wishes work" sheet, opened on purpose, is the only place
 * that explains it). The idea box is there only when wishes are available; otherwise the world cards are
 * the whole choice, with no "AI is off" card and no "Set up AI" button.
 */
import type { Page } from '@playwright/test';
import { classLinkPayload, expect, gotoRoute, openAmble, TEST_CLASS, test } from '../helpers/app';
import { mockAi } from '../helpers/mockAi';

/** The sparkle icon's first stroke (the icon set's `sparkle`). */
const SPARKLE = 'M11.6 3.4c.8 3.9';

/** Everything a student can read on the screen: its words, placeholders, names and tooltips. */
async function readable(page: Page): Promise<{ words: string; sparkles: number }> {
  return page.evaluate((sparkle) => {
    const attrs = [...document.querySelectorAll('[placeholder], [aria-label], [title]')]
      .map((el) => ['placeholder', 'aria-label', 'title'].map((a) => el.getAttribute(a) ?? '').join(' '))
      .join(' ');
    const sparkles = [...document.querySelectorAll('svg path')].filter((p) => (p.getAttribute('d') ?? '').startsWith(sparkle)).length;
    return { words: `${document.body.innerText} ${attrs}`, sparkles };
  }, SPARKLE);
}

async function expectNoMachine(page: Page, where: string): Promise<void> {
  const seen = await readable(page);
  expect(seen.words, `${where}: the word AI`).not.toMatch(/\bAI\b/);
  expect(seen.words, `${where}: machine words`).not.toMatch(/AI helper|\bprompt\b|generating|robot tester/i);
  expect(seen.sparkles, `${where}: sparkle icons`).toBe(0);
}

test('with no wishes, the home screens show world cards only, and never name the AI', async ({ page }) => {
  await openAmble(page, { clean: true });
  await expect(page.getByTestId('screen-first')).toBeVisible();
  await expect(page.getByTestId('first-column').locator('.seed-card')).toHaveCount(4);
  await expect(page.getByTestId('idea-box')).toHaveCount(0);
  await expect(page.getByTestId('idea-box-off')).toHaveCount(0);
  await expectNoMachine(page, 'First page');

  await gotoRoute(page, '#/new');
  await expect(page.getByTestId('screen-new').getByRole('radio')).toHaveCount(5);
  await expect(page.getByTestId('idea-box')).toHaveCount(0);
  await expectNoMachine(page, 'New world');

  await gotoRoute(page, '#/trail');
  await expect(page.getByTestId('trail-sign').first()).toBeVisible();
  await expect(page.getByTestId('ai-chip')).toHaveCount(0);
  await expectNoMachine(page, 'Trail');
  await expect(page.locator('.trail-copy__lede')).toContainText('The art is always yours.');
});

test('with wishes, the idea box is there, plain and unlabelled, and the Join card speaks of wishes', async ({ page }) => {
  await mockAi(page);
  await page.goto(`./#class=${classLinkPayload(TEST_CLASS as unknown as Record<string, unknown>)}`);
  const join = page.getByRole('dialog');
  await expect(join).toBeVisible();
  await expect(join).toContainText('wishes');
  await expectNoMachine(page, 'Join card');
  await join.getByRole('button', { name: 'Join', exact: true }).click();

  await expect(page.getByTestId('screen-first')).toBeVisible();
  await expect(page.getByTestId('idea-box')).toBeVisible();
  await expect(page.getByTestId('how-wishes')).toBeVisible();
  await expectNoMachine(page, 'First page with wishes');

  await gotoRoute(page, '#/new');
  await expect(page.getByTestId('idea-box')).toBeVisible();
  await expectNoMachine(page, 'New world with wishes');
});
